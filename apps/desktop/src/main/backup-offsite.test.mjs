import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OffsiteBackup, normalizeOffsiteConfig, offsiteErrorInfo } from "./backup-offsite.mjs";

const SET = "11111111-2222-3333-4444-555555555555";
const secureStorage = (available = true) => ({
  isEncryptionAvailable: () => available, isAsyncEncryptionAvailable: async () => available,
  encryptStringAsync: async (s) => Buffer.from(`sealed:${s}`), decryptStringAsync: async (b) => ({ result: b.toString().slice(7), shouldReEncrypt: false }),
});

// In-memory WebDAV server with hooks to fail or hold individual calls.
const fakeServer = () => {
  const files = new Map(); const calls = []; const hooks = {};
  const fail = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
  const run = async (name, ...args) => { calls.push([name, args[0]]); if (hooks[name]) await hooks[name](...args); };
  const client = {
    createDirectory: async (path, options) => run("createDirectory", path, options),
    stat: async (path, options) => { await run("stat", path, options); if (path.endsWith("/backups") || !path.includes(".")) return { type: "directory" }; if (!files.has(path)) throw fail(404); return { size: files.get(path).length }; },
    putFileContents: async (path, stream, options) => {
      calls.push(["putFileContents:options", path, options]);
      await run("putFileContents", path, options);
      const chunks = []; for await (const chunk of stream) { if (options.signal?.aborted) throw options.signal.reason ?? new Error("aborted"); chunks.push(chunk); }
      files.set(path, Buffer.concat(chunks));
    },
    moveFile: async (from, to, options) => { await run("moveFile", from, to, options); files.set(to, files.get(from)); files.delete(from); },
    deleteFile: async (path) => { await run("deleteFile", path); if (!files.has(path)) throw fail(404); files.delete(path); },
  };
  return { files, calls, hooks, client, fail, factory: async (url, options) => { calls.push(["connect", url, options.username, options.password]); return client; } };
};

const setup = async ({ secure = true } = {}) => {
  const root = await mkdtemp(join(tmpdir(), "edgeever-offsite-"));
  const userData = join(root, "private"); const backups = join(root, "backups");
  await mkdir(join(userData, "scheduled-backups"), { recursive: true }); await mkdir(join(backups, SET), { recursive: true });
  const server = fakeServer(); const changes = []; let clock = Date.parse("2026-10-29T10:00:00Z");
  const offsite = new OffsiteBackup({ userData, secureStorage: secureStorage(secure), clientFactory: server.factory, onChange: (status) => changes.push(status), now: () => clock, stallTimeoutMs: 50 });
  await offsite.setScope("scope-a", SET);
  const archive = async (name, body = "archive") => { await writeFile(join(backups, SET, name), body); return { name, directory: backups, size: Buffer.byteLength(body), completedAt: new Date(clock).toISOString() }; };
  const enable = () => offsite.save({ enabled: true, url: "https://dav.example.com/remote.php/dav/files/me/", username: "me", folder: "/EdgeEver/backups" }, "app-password");
  const settle = async () => { for (let i = 0; i < 50 && (offsite.upload || offsite.queued); i += 1) await new Promise((r) => setTimeout(r, 5)); };
  return { root, userData, backups, offsite, server, changes, archive, enable, settle, advance: (ms) => { clock += ms; }, cleanup: () => rm(root, { recursive: true, force: true }) };
};

describe("off-site settings", () => {
  test("requires https except on a local network and rejects unsafe folders", () => {
    expect(normalizeOffsiteConfig(undefined)).toEqual({ enabled: false, url: "", username: "", folder: "/EdgeEver/backups" });
    expect(normalizeOffsiteConfig({ enabled: true, url: " https://dav.example.com/dav/ ", username: " me ", folder: "Backups//EdgeEver/" })).toEqual({ enabled: true, url: "https://dav.example.com/dav", username: "me", folder: "/Backups/EdgeEver" });
    for (const url of ["http://nas.local:5005", "http://192.168.1.10/dav", "http://nas/dav", "http://[fd00::1]/dav", "http://localhost:8080"]) {
      expect(normalizeOffsiteConfig({ enabled: true, url, username: "u", folder: "/" }).url).toBe(new URL(url).href.replace(/\/+$/, ""));
    }
    const code = (input) => { try { normalizeOffsiteConfig(input); return null; } catch (error) { return error.code; } };
    expect(code({ enabled: true, url: "http://dav.example.com", username: "u", folder: "/" })).toBe("offsite_insecure_url");
    expect(code({ enabled: true, url: "https://u:p@dav.example.com", username: "u", folder: "/" })).toBe("offsite_invalid_url");
    expect(code({ enabled: true, url: "ftp://dav.example.com", username: "u", folder: "/" })).toBe("offsite_insecure_url");
    expect(code({ enabled: true, url: "https://dav.example.com", username: "u", folder: "/a/../b" })).toBe("offsite_invalid_folder");
    expect(code({ enabled: true, url: "", username: "u", folder: "/" })).toBe("offsite_invalid_configuration");
  });

  test("stores the password only through secure storage and never in the state file", async () => {
    const f = await setup();
    try {
      await f.enable();
      const state = await readFile(join(f.userData, "scheduled-backups", "scope-a.offsite.json"), "utf8");
      expect(state).not.toContain("app-password");
      expect(JSON.stringify(f.offsite.status())).not.toContain("app-password");
      expect(f.offsite.status().passwordSet).toBe(true);
      // Saving again without a password keeps the stored one.
      await f.offsite.save({ ...f.offsite.status().config, folder: "/Other" });
      expect(f.offsite.status().passwordSet).toBe(true);
    } finally { await f.cleanup(); }
  });

  test("never sends the saved password to a different address or username", async () => {
    const f = await setup();
    try {
      await f.enable();
      const saved = f.offsite.status().config;
      const secrets = async () => (await readdir(join(f.userData, "scheduled-backups"))).filter((name) => name.endsWith(".secret"));
      expect(await secrets()).toHaveLength(1);
      // Testing another server without typing a password does not use the saved one.
      for (const changed of [{ url: "https://attacker.example.com/dav" }, { username: "someone-else" }]) {
        await expect(f.offsite.test({ ...saved, ...changed })).rejects.toMatchObject({ code: "offsite_password_required" });
      }
      expect(f.server.calls.some(([name]) => name === "connect")).toBe(false);
      // Saving a new address without a password is refused while enabled, and forgets the password when disabled.
      await expect(f.offsite.save({ ...saved, url: "https://attacker.example.com/dav" })).rejects.toMatchObject({ code: "offsite_password_required" });
      expect(f.offsite.status()).toMatchObject({ config: saved, passwordSet: true });
      await f.offsite.save({ ...saved, enabled: false, url: "https://attacker.example.com/dav" });
      expect(f.offsite.status().passwordSet).toBe(false);
      expect(await secrets()).toHaveLength(0);
      // The same address keeps working with its saved password.
      await f.enable();
      expect(await f.offsite.test(f.offsite.status().config)).toEqual({ ok: true });
      expect(f.server.calls.find(([name]) => name === "connect").slice(1)).toEqual(["https://dav.example.com/remote.php/dav/files/me", "me", "app-password"]);
    } finally { await f.cleanup(); }
  });

  test("refuses to save a password without usable secure storage", async () => {
    const f = await setup({ secure: false });
    try {
      await expect(f.enable()).rejects.toMatchObject({ code: "offsite_secure_storage_unavailable" });
      expect(f.offsite.status().config.enabled).toBe(false);
    } finally { await f.cleanup(); }
  });

  test("maps server answers to actionable errors", () => {
    expect(offsiteErrorInfo({ status: 401 }).code).toBe("offsite_auth_failed");
    expect(offsiteErrorInfo({ response: { status: 413 } }).code).toBe("offsite_file_too_large");
    expect(offsiteErrorInfo({ status: 507 }).code).toBe("offsite_storage_full");
    expect(offsiteErrorInfo({ cause: { code: "ENOTFOUND" } }).code).toBe("offsite_unreachable");
    expect(offsiteErrorInfo(new Error("x")).code).toBe("offsite_upload_failed");
  });
});

describe("off-site upload", () => {
  test("uploads to a .part file, moves it into place and checks the size", async () => {
    const f = await setup();
    try {
      await f.enable();
      f.offsite.enqueue(await f.archive("one.zip", "hello archive"), 3); await f.settle();
      const final = `/EdgeEver/backups/${SET}/one.zip`;
      expect(f.server.files.get(final)?.toString()).toBe("hello archive");
      const put = f.server.calls.find(([name]) => name === "putFileContents");
      expect(put[1]).toMatch(new RegExp(`^/EdgeEver/backups/${SET}/one\\.zip\\.[a-f0-9-]+\\.part$`));
      // Streams are sent with an explicit length; some servers reject chunked uploads.
      expect(f.server.calls.find(([name]) => name === "putFileContents:options")[2].headers).toEqual({ "Content-Length": "13" });
      expect([...f.server.files.keys()].some((path) => path.endsWith(".part"))).toBe(false);
      expect(f.server.calls.find(([name]) => name === "connect").slice(2)).toEqual(["me", "app-password"]);
      const status = f.offsite.status();
      expect(status.lastUploaded).toMatchObject({ name: "one.zip", size: 13 });
      expect(status.error).toBeNull(); expect(status.task).toBeNull();
    } finally { await f.cleanup(); }
  });

  test("a failed upload removes the .part file, records the error and keeps nothing as uploaded", async () => {
    const f = await setup();
    try {
      await f.enable();
      f.server.hooks.moveFile = async () => { throw f.server.fail(507); };
      f.offsite.enqueue(await f.archive("one.zip"), 3); await f.settle();
      expect([...f.server.files.keys()]).toEqual([]);
      expect(f.offsite.status().error.code).toBe("offsite_storage_full");
      expect(f.offsite.status().lastSuccessAt).toBeNull();
    } finally { await f.cleanup(); }
  });

  test("a size mismatch after the move is reported and the archive is retried later", async () => {
    const f = await setup();
    try {
      await f.enable();
      const entry = await f.archive("one.zip", "12345");
      f.server.hooks.moveFile = async (from) => { f.server.files.set(from, Buffer.from("123")); };
      f.offsite.enqueue(entry, 3); await f.settle();
      expect(f.offsite.status().error.code).toBe("offsite_size_mismatch");
      delete f.server.hooks.moveFile;
      // Hourly retry waits for an hour after the failed attempt.
      expect(f.offsite.tick(entry, 3)).toBe(false);
      f.advance(3600001);
      expect(f.offsite.tick(entry, 3)).toBe(true); await f.settle();
      expect(f.offsite.status().error).toBeNull();
      expect(f.offsite.tick(entry, 3, { force: true })).toBe(false);
    } finally { await f.cleanup(); }
  });

  test("a stalled server is aborted and reported", async () => {
    const f = await setup();
    try {
      await f.enable();
      f.server.hooks.putFileContents = (_path, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason)));
      f.offsite.enqueue(await f.archive("one.zip"), 3);
      for (let i = 0; i < 100 && f.offsite.upload; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(f.offsite.status().error.code).toBe("offsite_stalled");
    } finally { await f.cleanup(); }
  });

  test("switching account cancels the running upload without touching the new account", async () => {
    const f = await setup();
    try {
      await f.enable();
      let release;
      f.server.hooks.putFileContents = () => new Promise((resolve) => { release = resolve; });
      f.offsite.enqueue(await f.archive("one.zip"), 3);
      for (let i = 0; i < 50 && !release; i += 1) await new Promise((r) => setTimeout(r, 5));
      await f.offsite.setScope("scope-b", SET);
      release();
      await new Promise((r) => setTimeout(r, 30));
      expect(f.offsite.status()).toMatchObject({ config: { enabled: false }, error: null, lastUploaded: null, task: null });
      expect(f.offsite.upload).toBeNull();
      expect([...f.server.files.keys()].filter((path) => path.endsWith("one.zip"))).toEqual([]);
    } finally { await f.cleanup(); }
  });

  test("retention deletes only copies this device uploaded, after a newer upload succeeded", async () => {
    const f = await setup();
    try {
      await f.enable();
      f.server.files.set(`/EdgeEver/backups/${SET}/manual.zip`, Buffer.from("keep"));
      for (const name of ["a.zip", "b.zip", "c.zip"]) { f.offsite.enqueue(await f.archive(name), 2); await f.settle(); f.advance(1000); }
      const remaining = [...f.server.files.keys()].sort();
      expect(remaining).toEqual([`/EdgeEver/backups/${SET}/b.zip`, `/EdgeEver/backups/${SET}/c.zip`, `/EdgeEver/backups/${SET}/manual.zip`]);
      // A failed upload never deletes the older copies.
      f.server.hooks.putFileContents = async () => { throw f.server.fail(500); };
      f.offsite.enqueue(await f.archive("d.zip"), 1); await f.settle();
      expect([...f.server.files.keys()]).toHaveLength(3);
      // Copies under another address or folder are never deleted.
      delete f.server.hooks.putFileContents;
      await f.offsite.save({ ...f.offsite.status().config, folder: "/Elsewhere" });
      f.offsite.enqueue(await f.archive("e.zip"), 1); await f.settle();
      expect(f.server.files.has(`/EdgeEver/backups/${SET}/c.zip`)).toBe(true);
      expect(f.server.files.has(`/Elsewhere/${SET}/e.zip`)).toBe(true);
    } finally { await f.cleanup(); }
  });

  test("a cleanup failure is a warning and does not fail the upload", async () => {
    const f = await setup();
    try {
      await f.enable();
      f.offsite.enqueue(await f.archive("a.zip"), 1); await f.settle(); f.advance(1000);
      f.server.hooks.deleteFile = async () => { throw f.server.fail(403); };
      f.offsite.enqueue(await f.archive("b.zip"), 1); await f.settle();
      expect(f.offsite.status()).toMatchObject({ error: null, warning: { code: "offsite_cleanup_failed" }, lastUploaded: { name: "b.zip" } });
    } finally { await f.cleanup(); }
  });

  test("skips archives that local retention already removed or that changed size", async () => {
    const f = await setup();
    try {
      await f.enable();
      f.offsite.enqueue({ name: "gone.zip", directory: f.backups, size: 3 }, 3); await f.settle();
      expect(f.server.calls.some(([name]) => name === "putFileContents")).toBe(false);
      expect(f.offsite.status().error).toBeNull();
      const entry = await f.archive("changed.zip", "abc");
      f.offsite.enqueue({ ...entry, size: 99 }, 3); await f.settle();
      expect(f.offsite.status().error.code).toBe("offsite_source_changed");
    } finally { await f.cleanup(); }
  });

  test("does nothing while the option is off", async () => {
    const f = await setup();
    try {
      f.offsite.enqueue(await f.archive("one.zip"), 3); await f.settle();
      expect(f.server.calls).toEqual([]);
      expect(f.offsite.tick({ name: "one.zip", directory: f.backups, size: 7 }, 3, { force: true })).toBe(false);
    } finally { await f.cleanup(); }
  });

  test("test connection uses the entered password without saving it", async () => {
    const f = await setup();
    try {
      await expect(f.offsite.test({ url: "https://dav.example.com/dav", username: "me", folder: "/EdgeEver/backups" }, "typed")).resolves.toEqual({ ok: true });
      expect(f.server.calls[0]).toEqual(["connect", "https://dav.example.com/dav", "me", "typed"]);
      expect(f.offsite.status().passwordSet).toBe(false);
      f.server.hooks.createDirectory = async () => { throw f.server.fail(401); };
      await expect(f.offsite.test({ url: "https://dav.example.com/dav", username: "me", folder: "/x" }, "wrong")).rejects.toMatchObject({ code: "offsite_auth_failed" });
    } finally { await f.cleanup(); }
  });

  test("removes a .part left by an interrupted upload on the next start", async () => {
    const f = await setup();
    try {
      await f.enable();
      const part = `/EdgeEver/backups/${SET}/one.zip.abc.part`;
      f.server.files.set(part, Buffer.from("partial"));
      f.offsite.record.activePart = { path: part, target: JSON.stringify(["https://dav.example.com/remote.php/dav/files/me", "me", "/EdgeEver/backups"]) };
      await f.offsite.persist();
      await f.offsite.setScope("scope-a", SET);
      for (let i = 0; i < 50 && f.server.files.has(part); i += 1) await new Promise((r) => setTimeout(r, 5));
      expect(f.server.files.has(part)).toBe(false);
    } finally { await f.cleanup(); }
  });
});

describe("review regressions", () => {
  test("a connection test keeps the password of the account it started in", async () => {
    const f = await setup();
    try {
      // Account A saves its password; account B saves a different one.
      await f.enable();
      await f.offsite.setScope("scope-b", SET);
      await f.offsite.save({ enabled: true, url: "https://dav.example.com/remote.php/dav/files/me/", username: "me", folder: "/EdgeEver/backups" }, "password-of-b");
      await f.offsite.setScope("scope-a", SET);
      // Hold decryption so the account can switch while the test reads A's password.
      let release; const storage = f.offsite.secureStorage; const decrypt = storage.decryptStringAsync;
      storage.decryptStringAsync = async (bytes) => { await new Promise((resolve) => { release = resolve; }); return decrypt(bytes); };
      const pending = f.offsite.test(f.offsite.status().config);
      for (let i = 0; i < 50 && !release; i += 1) await new Promise((r) => setTimeout(r, 5));
      await f.offsite.setScope("scope-b", SET);
      release();
      await expect(pending).rejects.toMatchObject({ code: "backup_account_changed" });
      storage.decryptStringAsync = decrypt;
      // No request went out, and B's password was never read for A's test.
      expect(f.server.calls.filter(([name]) => name === "connect")).toEqual([]);
    } finally { await f.cleanup(); }
  });

  test("turning the copy off stops a running upload before it publishes", async () => {
    const f = await setup();
    try {
      await f.enable();
      let started = false;
      f.server.hooks.putFileContents = (_path, options) => { started = true; return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason))); };
      f.offsite.enqueue(await f.archive("one.zip"), 3);
      for (let i = 0; i < 50 && !started; i += 1) await new Promise((r) => setTimeout(r, 5));
      await f.offsite.save({ ...f.offsite.status().config, enabled: false });
      await f.settle();
      expect(f.offsite.upload).toBeNull();
      expect(f.server.calls.some(([name]) => name === "moveFile")).toBe(false);
      expect([...f.server.files.keys()].filter((path) => path.endsWith("one.zip"))).toEqual([]);
      expect(f.offsite.status()).toMatchObject({ config: { enabled: false }, error: null, lastUploaded: null });
      // A copy queued while the option was off never starts.
      delete f.server.hooks.putFileContents;
      f.offsite.enqueue(await f.archive("two.zip"), 3); await f.settle();
      expect(f.server.calls.filter(([name]) => name === "putFileContents")).toHaveLength(1);
    } finally { await f.cleanup(); }
  });

  for (const name of ["createDirectory", "moveFile", "stat"]) {
    test(`a stuck ${name} request is bounded and later copies still run`, async () => {
      const f = await setup();
      try {
        await f.enable();
        // The request never settles and ignores its signal.
        f.server.hooks[name] = () => new Promise(() => {});
        f.offsite.enqueue(await f.archive("one.zip"), 3);
        for (let i = 0; i < 100 && (f.offsite.upload || f.offsite.queued); i += 1) await new Promise((r) => setTimeout(r, 10));
        expect(f.offsite.upload).toBeNull();
        expect(f.offsite.status().error.code).toBe("offsite_stalled");
        delete f.server.hooks[name];
        f.offsite.enqueue(await f.archive("two.zip"), 3); await f.settle();
        expect(f.offsite.status()).toMatchObject({ error: null, lastUploaded: { name: "two.zip" } });
      } finally { await f.cleanup(); }
    });
  }

  test("stuck cleanup and connection-test requests are bounded too", async () => {
    const f = await setup();
    try {
      await f.enable();
      f.server.hooks.moveFile = async () => { throw f.server.fail(500); };
      f.server.hooks.deleteFile = () => new Promise(() => {});
      f.offsite.enqueue(await f.archive("one.zip"), 3);
      for (let i = 0; i < 100 && f.offsite.upload; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(f.offsite.upload).toBeNull();
      expect(f.offsite.status().error.code).toBe("offsite_upload_failed");
      f.server.hooks.stat = () => new Promise(() => {});
      await expect(f.offsite.test(f.offsite.status().config)).rejects.toMatchObject({ code: "offsite_stalled" });
    } finally { await f.cleanup(); }
  });
});
