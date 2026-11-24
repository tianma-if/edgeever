import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAcpIpc } from "./acp-host.mjs";
import { createAcpPathStore, validateTrustedAcpPath } from "./acp-path-store.mjs";
import { resourceResponseHeaders } from "./resource-url.mjs";
import { isAllowedAppNavigation } from "./window-open-policy.mjs";
import { credentialForUrl, decodeSessionCredential, encodeSessionCredential } from "./session-credential.mjs";
import { validateAiProviderUrl } from "./ai-direct.mjs";
import { createPublicLookup } from "@edgeever/public-network/node";

test("ACP ignores caller paths on all execution channels and preserves main-owned choices across registration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-acp-boundary-"));
  try {
    const filename = join(directory, "chosen.json");
    const sender = { isFocused: () => true };
    const calls = [];
    const runtime = {
      listAdapters: () => [{ id: "antigravity" }],
      probeAdapter: (input) => calls.push(input),
      authenticateAdapter: (input) => calls.push(input),
      prepare: (input) => calls.push(input),
      prompt: (input) => calls.push(input),
    };
    const register = () => {
      const handlers = new Map();
      registerAcpIpc({ handle: (name, handler) => handlers.set(name, handler) }, runtime, {
        allowInstall: (value) => value === sender,
        adapterPathStore: createAcpPathStore(filename),
        chooseAdapterPath: async () => "/user/chosen/acp",
        validateAdapterPath: async value => value,
      });
      return handlers;
    };
    const channels = ["desktop:acp-probe", "desktop:acp-authenticate", "desktop:acp-prepare", "desktop:acp-prompt"];
    const handlers = register();
    for (const channel of channels) {
      const input = { id: "antigravity", adapterId: "antigravity", path: "/attacker/payload" };
      await expect(handlers.get(channel)({ sender: {} }, input)).rejects.toThrow(/forbidden/);
      await handlers.get(channel)({ sender }, input);
      expect(calls.at(-1).path).toBeUndefined();
    }
    sender.isFocused = () => false;
    expect(await handlers.get("desktop:acp-choose-path")({ sender }, "antigravity")).toBeNull();
    sender.isFocused = () => true;
    await handlers.get("desktop:acp-choose-path")({ sender }, "antigravity");
    expect(JSON.parse(await readFile(filename, "utf8")).antigravity).toBe("/user/chosen/acp");
    if (process.platform !== "win32") expect((await stat(filename)).mode & 0o777).toBe(0o600);
    const restarted = register();
    for (const channel of channels) {
      await restarted.get(channel)({ sender }, { id: "antigravity", adapterId: "antigravity", path: "/attacker/payload" });
      expect(calls.at(-1).path).toBe("/user/chosen/acp");
    }
    await restarted.get(channels[0])({ sender }, { id: "codex", path: "/attacker/payload" });
    expect(calls.at(-1).path).toBeUndefined();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("privileged window cannot navigate to resource documents or origin-prefix spoofs", () => {
  for (const app of ["http://127.0.0.1:5173/", "edgeever-app://app/index.html", "file:///app/web/index.html"]) {
    expect(isAllowedAppNavigation(app, app)).toBe(true);
    for (const target of ["http://127.0.0.1:5173@evil.example/", "http://127.0.0.1:51730/", "edgeever-app://app.evil/index.html", "edgeever-resource://resource/html", "edgeever-staged://html", "file:///etc/passwd"]) {
      expect(isAllowedAppNavigation(target, app)).toBe(false);
    }
  }
});

test("ACP chooser permits one focused request and cancelled selection records nothing", async () => {
  const handlers = new Map();
  const sender = { isFocused: () => true };
  let finish;
  let choices = 0;
  let writes = 0;
  registerAcpIpc({ handle: (name, handler) => handlers.set(name, handler) }, {}, {
    allowInstall: (value) => value === sender,
    chooseAdapterPath: () => { choices++; return new Promise((resolve) => { finish = resolve; }); },
    adapterPathStore: { get: async () => null, set: async () => { writes++; } },
  });
  const choose = handlers.get("desktop:acp-choose-path");
  const pending = choose({ sender }, "antigravity");
  expect(await choose({ sender }, "antigravity")).toBeNull();
  expect(choices).toBe(1);
  finish(null);
  expect(await pending).toBeNull();
  expect(writes).toBe(0);
});

test("stored ACP programs are revalidated before the runtime can execute them", async () => {
  const handlers = new Map();
  let executed = false;
  registerAcpIpc({ handle: (name, handler) => handlers.set(name, handler) }, {
    probeAdapter: () => { executed = true; },
  }, {
    allowInstall: () => true,
    adapterPathStore: { get: async () => "/missing/previous-choice", set: async () => {} },
  });
  await expect(handlers.get("desktop:acp-probe")({ sender: {} }, { id: "antigravity", path: "/attacker" })).rejects.toThrow();
  expect(executed).toBe(false);
});

test("resource responses never inline HTML documents, including MIME variants", () => {
  for (const type of ["text/html", "Text/HTML; charset=utf-8", "application/xhtml+xml", "text/plain", "application/octet-stream"]) {
    const headers = resourceResponseHeaders(type);
    expect(headers.get("content-type")).toBe("application/octet-stream");
    expect(headers.get("content-disposition")).toBe("attachment");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toContain("sandbox");
  }
  for (const type of ["image/png", "application/pdf", "video/mp4", "audio/mpeg"]) {
    expect(resourceResponseHeaders(type).get("content-type")).toBe(type);
    expect(resourceResponseHeaders(type).get("content-disposition")).toBeNull();
    expect(resourceResponseHeaders(type, 'attachment; filename="test"').get("content-disposition")).toContain("test");
  }
});

test("legacy credentials migrate to an origin-bound record and cannot follow an instance switch", () => {
  const previous = decodeSessionCredential("legacy-test-token", "https://notes.example.org");
  expect(credentialForUrl(previous.token, previous.origin, "https://notes.example.org/api/v1")).toBe("legacy-test-token");
  const restored = decodeSessionCredential(encodeSessionCredential(previous.token, previous.origin), "https://attacker.example.org");
  expect(credentialForUrl(restored.token, restored.origin, "https://attacker.example.org/blob")).toBe("");
  expect(credentialForUrl(restored.token, restored.origin, "http://notes.example.org/blob")).toBe("");
  expect(credentialForUrl(restored.token, restored.origin, "https://notes.example.org:8443/blob")).toBe("");
  expect(decodeSessionCredential('{"version":99}', previous.origin).token).toBe("");
});

test("AI accepts configured private endpoints while plugin DNS remains public-only", async () => {
  for (const host of ["[::ffff:127.0.0.1]", "[::ffff:169.254.169.254]", "[::ffff:10.0.0.5]", "localhost.", "service.internal", "service.local", "localhost", "127.0.0.1"]) {
    expect(validateAiProviderUrl(`https://${host}/v1`).protocol).toBe("https:");
  }
  const lookup = createPublicLookup((_host, _options, callback) => callback(null, [{ address: "127.0.0.1", family: 4 }]));
  await expect(new Promise((resolve, reject) => lookup("provider.example.org", {}, (error, address) => error ? reject(error) : resolve(address))))
    .rejects.toThrow(/public addresses/);
  const mixed = createPublicLookup((_host, _options, callback) => callback(null, [{ address: "8.8.8.8", family: 4 }, { address: "::ffff:127.0.0.1", family: 6 }]));
  await expect(new Promise((resolve, reject) => mixed("provider.example.org", {}, (error, address) => error ? reject(error) : resolve(address))))
    .rejects.toThrow(/public addresses/);
});

test("custom ACP executables cannot be anchored in renderer-writable client storage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-acp-storage-"));
  try {
    const filename = join(directory, "..payload.bin");
    await writeFile(filename, "test", { mode: 0o700 });
    await expect(validateTrustedAcpPath(filename, { excludedRoot: directory })).rejects.toThrow(/client data directory/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test("SVG previews retain MIME and sandbox scripts and external resources", () => {
  for (const type of ["image/svg+xml", "IMAGE/SVG+XML; charset=utf-8"]) {
    const headers = resourceResponseHeaders(type);
    expect(headers.get("content-type")).toBe("image/svg+xml");
    expect(headers.get("content-disposition")).toBeNull();
    expect(headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(resourceResponseHeaders(type, 'attachment; filename="original.svg"').get("content-disposition")).toContain("original.svg");
  }
});
