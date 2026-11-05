import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canRemoveOpenedAttachment, createAttachmentWritebackManager, replaceAttachmentResource } from "./attachment-writeback.mjs";

const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const hash = value => createHash("sha256").update(value).digest("hex");
const fixture = async (overrides = {}, localFilename = "budget.xlsx") => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-writeback-"));
  directories.push(directory);
  const folder = join(directory, "open-fixture");
  await mkdir(folder);
  const path = join(folder, localFilename);
  await writeFile(path, "original");
  let now = Date.now();
  let context = { key: "account-a", directory };
  let cloud = "original";
  let unavailable = false;
  const requests = [];
  const saved = [];
  const options = {
    getContext: () => context,
    now: () => now,
    resolveResourceId: async () => "res_1",
    replace: async input => {
      requests.push(input);
      if (unavailable) throw Object.assign(new Error("Offline"), { code: "unavailable", retryable: true });
      if (input.expectedContentHash !== hash(cloud)) throw Object.assign(new Error("Conflict"), { code: "resource_conflict" });
      cloud = Buffer.from(input.bytes).toString();
      return { id: "res_1", sha256: hash(cloud), filename: "budget.xlsx", mimeType: "application/test", byteSize: input.bytes.length };
    },
    onSaved: async input => saved.push(input),
    ...overrides,
  };
  let manager = createAttachmentWritebackManager(options);
  await manager.track({ folder, url: "edgeever-resource://resource/res_1", filename: "budget.xlsx", localFilename, mimeType: "application/test" });
  return {
    directory, folder, path, requests, saved, options,
    get manager() { return manager; },
    restart() { manager.suspend(); manager = createAttachmentWritebackManager(options); },
    advance(ms = 2000) { now += ms; },
    setContext(value) { context = value; },
    setCloud(value) { cloud = value; },
    setOffline(value) { unavailable = value; },
    get cloud() { return cloud; },
    async settle() { await manager.tick(); now += 2000; await manager.tick(); },
  };
};

test("status distinguishes numbered local copies without renaming uploads", async () => {
  const f = await fixture({}, "budget (2).xlsx");
  expect((await f.manager.list())[0].filename).toBe("budget (2).xlsx");
  await writeFile(f.path, "edited"); await f.settle();
  expect(f.requests[0].filename).toBe("budget.xlsx");
});

for (const scenario of ["abort", "replace-during-snapshot", "retry-persistence", "scope-during-acknowledgement", "cleanup-after-acknowledgement", "acknowledgement-commit-failure", "pending-lock"]) {
  test(`real file/DOM failure recovery: ${scenario}`, async () => {
    // Built-in filesystem fault injection stays in its own Node process so it
    // cannot affect other tests or turn a timing race into a production hook.
    await promisify(execFile)("node", [fileURLToPath(new URL("../../../../tests/fixtures/attachment-writeback-races.mjs", import.meta.url)), scenario]);
  });
}

test("unchanged opened files never upload; a stable save replaces the same resource", async () => {
  const f = await fixture();
  await f.settle(); expect(f.requests).toHaveLength(0);
  await writeFile(f.path, "edited");
  await f.manager.tick(); expect(f.requests).toHaveLength(0);
  f.advance(); await f.manager.tick();
  expect(f.cloud).toBe("edited");
  expect(f.requests[0].resourceId).toBe("res_1");
  expect(f.requests[0].expectedContentHash).toBe(hash("original"));
  expect((await f.manager.list())[0].status).toBe("saved");
  await f.settle(); expect(f.requests).toHaveLength(1);
});

test("atomic Excel-style replacement and chunked writes wait for a stable file", async () => {
  const f = await fixture();
  await writeFile(join(f.folder, "office-temp"), "partial");
  await rm(f.path); await f.manager.tick();
  await rename(join(f.folder, "office-temp"), f.path);
  await f.manager.tick(); f.advance();
  await writeFile(f.path, "complete workbook");
  await f.manager.tick(); expect(f.requests).toHaveLength(0);
  f.advance(); await f.manager.tick();
  expect(f.cloud).toBe("complete workbook");
});

test("another device's version is not overwritten and the conflict survives restart", async () => {
  const f = await fixture(); f.setCloud("other device");
  await writeFile(f.path, "local edit"); await f.settle();
  expect(f.cloud).toBe("other device");
  expect((await f.manager.list())[0].status).toBe("conflict");
  expect(await readFile(f.path, "utf8")).toBe("local edit");
  f.restart(); f.advance(60_000); await f.settle();
  expect(f.requests).toHaveLength(1);
  expect((await f.manager.list())[0].status).toBe("conflict");
});

test("offline snapshots survive restart and save later edits after the original pending upload", async () => {
  const f = await fixture(); f.setOffline(true);
  await writeFile(f.path, "first edit"); await f.settle();
  expect((await f.manager.list())[0].status).toBe("error");
  await writeFile(f.path, "second edit");
  f.restart(); f.setOffline(false); f.advance(31_000);
  await f.settle(); await f.settle();
  expect(f.cloud).toBe("second edit");
  expect(f.requests.map(r => Buffer.from(r.bytes).toString())).toEqual(["first edit", "first edit", "second edit"]);
});

test("saving during an upload is serialized against the acknowledged version", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture();
  const originalReplace = f.options.replace;
  f.options.replace = async input => { await gate; return originalReplace(input); };
  await writeFile(f.path, "first"); await f.manager.tick(); f.advance();
  const sending = f.manager.tick();
  await Bun.sleep(30);
  await writeFile(f.path, "second"); release(); await sending;
  await f.settle();
  expect(f.cloud).toBe("second");
  expect(f.requests[1].expectedContentHash).toBe(hash("first"));
});

test("account changes suspend in-flight work; returning to the account recovers its pending copy", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture();
  const originalReplace = f.options.replace;
  f.options.replace = async input => { await gate; input.assertCurrent(); return originalReplace(input); };
  await writeFile(f.path, "private edit"); await f.manager.tick(); f.advance();
  const sending = f.manager.tick(); await Bun.sleep(30);
  f.setContext(null); f.manager.suspend(); release(); await sending;
  expect(f.requests).toHaveLength(0); expect(f.saved).toHaveLength(0);
  expect(await f.manager.list()).toEqual([]);
  f.setContext({ key: "account-a", directory: f.directory }); f.advance(31_000); await f.settle();
  expect(f.cloud).toBe("private edit");
});

test("staged attachments wait for their existing upload mapping", async () => {
  let resourceId = null;
  const f = await fixture({ resolveResourceId: async () => resourceId });
  await writeFile(f.path, "offline edit"); await f.settle();
  expect(f.requests).toHaveLength(0);
  resourceId = "res_1"; f.advance(31_000); await f.settle();
  expect(f.cloud).toBe("offline edit");
});

test("manual retry preserves the pending snapshot and does not force conflicting content", async () => {
  const f = await fixture(); f.setOffline(true);
  await writeFile(f.path, "local edit"); await f.settle();
  f.setOffline(false);
  await f.manager.retry("open-fixture"); await f.manager.tick();
  expect(f.cloud).toBe("local edit");
});

test("a lost success response is reconciled by content before accepting a no-op conditional replacement", async () => {
  let cloud = "original"; let loseResponse = true;
  const calls = [];
  const request = async (path, init) => {
    if (path === "/resources/writeback-capabilities") { calls.push("CAP"); return Response.json({ preserveFilename: true }); }
    calls.push(init.method);
    if (init.method === "GET") return new Response(cloud);
    const expected = init.body.get("expectedContentHash");
    if (expected !== hash(cloud)) return Response.json({ error: { code: "resource_conflict" } }, { status: 409 });
    cloud = await init.body.get("file").text();
    if (loseResponse) { loseResponse = false; throw new Error("Response lost"); }
    return Response.json({ resource: { id: "res_1", sha256: hash(cloud) } });
  };
  const input = { resourceId: "res_1", bytes: Buffer.from("edited"), expectedContentHash: hash("original"), filename: "a.txt", mimeType: "text/plain", assertCurrent() {} };
  await expect(replaceAttachmentResource(request, input)).rejects.toThrow("Response lost");
  expect(await replaceAttachmentResource(request, input)).toMatchObject({ id: "res_1", sha256: hash("edited") });
  expect(calls).toEqual(["CAP", "PUT", "CAP", "PUT", "GET", "PUT"]);
});

test("unsupported servers retain pending edits without automatic probes, and manual retry resumes after upgrading", async () => {
  let supported = false, probes = 0;
  const writes = [];
  const f = await fixture({ replace: input => replaceAttachmentResource(async (path, init) => {
    if (path === "/resources/writeback-capabilities") { probes++; return Response.json({ preserveFilename: supported }); }
    expect(path).toBe("/resources/res_1/blob/writeback");
    const bytes = await init.body.get("file").text(); writes.push(bytes);
    return Response.json({ resource: { id: "res_1", sha256: hash(bytes), byteSize: bytes.length } });
  }, input) });
  await writeFile(f.path, "pending edit"); await f.settle();
  expect((await f.manager.list())[0]).toMatchObject({ status: "error", errorCode: "writeback_unsupported" });
  expect(await readFile(join(f.folder, ".edgeever-writeback.pending"), "utf8")).toBe("pending edit");
  await writeFile(f.path, "later edit"); f.advance(60_000); await f.settle();
  expect(probes).toBe(1); expect(writes).toEqual([]);
  supported = true; await f.manager.retry("open-fixture"); await f.manager.tick(); await f.settle();
  expect(writes).toEqual(["pending edit", "later edit"]);
  expect((await f.manager.list())[0].status).toBe("saved");
});

test("temporary capability failures remain retryable without sending attachment bytes", async () => {
  const calls = [];
  const input = { resourceId: "res_1", bytes: Buffer.from("edit"), expectedContentHash: hash("original"), filename: "a.txt", mimeType: "text/plain", assertCurrent() {} };
  await expect(replaceAttachmentResource(async (path, init) => {
    calls.push([path, init.method]); return Response.json({ error: { code: "temporarily_unavailable" } }, { status: 503 });
  }, input)).rejects.toMatchObject({ code: "temporarily_unavailable", retryable: true });
  expect(calls).toEqual([["/resources/writeback-capabilities", "GET"]]);
});

test("missing resources on a supported server remain deletion errors, not unsupported-server errors", async () => {
  await expect(replaceAttachmentResource(async path => path === "/resources/writeback-capabilities"
    ? Response.json({ preserveFilename: true })
    : Response.json({ error: { code: "not_found" } }, { status: 404, headers: { "X-EdgeEver-Writeback": "preserve-filename" } }), {
    resourceId: "res_1", bytes: Buffer.from("edit"), expectedContentHash: hash("original"), filename: "a.txt", mimeType: "text/plain", assertCurrent() {},
  })).rejects.toMatchObject({ code: "not_found", retryable: false });
});


test("zero-byte truncation waits, oversized replacements retain edits without an upload", async () => {
  const f = await fixture();
  await truncate(f.path, 0); await f.settle(); expect(f.requests).toHaveLength(0);
  await writeFile(f.path, "complete"); await f.settle(); expect(f.cloud).toBe("complete");
  await truncate(f.path, 100 * 1024 * 1024 + 1); await f.settle();
  expect(f.requests).toHaveLength(1);
  expect((await f.manager.list())[0]).toMatchObject({ status: "error", errorCode: "upload_too_large" });
});

test("managed unsynced copies are never eligible for retention cleanup", async () => {
  const f = await fixture();
  expect(await canRemoveOpenedAttachment(f.folder)).toBe(true);
  await writeFile(f.path, "unobserved edit");
  expect(await canRemoveOpenedAttachment(f.folder)).toBe(false);
  f.setOffline(true); await f.settle();
  expect(await canRemoveOpenedAttachment(f.folder)).toBe(false);
});

test("a replaced symbolic link is never read or uploaded", async () => {
  if (process.platform === "win32") return; // Creating symlinks needs a Windows-specific privilege.
  const f = await fixture();
  const privateFile = join(f.directory, "private.txt"); await writeFile(privateFile, "private content");
  await rm(f.path); await symlink(privateFile, f.path); await f.settle();
  expect(f.requests).toHaveLength(0);
  expect(await canRemoveOpenedAttachment(f.folder)).toBe(false);
});

test("a restored authenticated session resumes auth failures without retrying the rejected session", async () => {
  const f = await fixture();
  const replace = f.options.replace;
  let attempts = 0;
  f.options.replace = async () => { attempts++; throw Object.assign(new Error("Login expired"), { code: "unauthorized", retryable: false }); };
  await writeFile(f.path, "pending login"); await f.settle();
  f.advance(60_000); await f.manager.tick(); expect(attempts).toBe(1);
  f.options.replace = replace;
  f.setContext({ key: "account-a-new-session", directory: f.directory });
  await f.settle(); expect(f.cloud).toBe("pending login");
});
