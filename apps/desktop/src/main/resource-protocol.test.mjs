import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createResourceProtocolHandler } from "./resource-protocol.mjs";

const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const fixture = async ({ status = 503, cached = true, fetch: fetchOverride } = {}) => {
  const root = await mkdtemp(join(tmpdir(), "edgeever-resource-protocol-")); directories.push(root);
  const directory = join(root, "account-a"); await mkdir(directory);
  if (cached) {
    await writeFile(join(directory, "res_1.bin"), "current account bytes");
    await writeFile(join(directory, "res_1.json"), JSON.stringify({ contentType: "application/pdf" }));
  }
  let cancelled = false, requests = 0;
  const options = {
    getDirectory: () => directory, getApiBaseUrl: () => "http://local.test",
    getRequestHeaders: async () => new Headers(),
    fetch: async (...args) => {
      requests++;
      if (fetchOverride) return fetchOverride(...args);
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status });
    },
  };
  const handler = createResourceProtocolHandler(options);
  return { root, directory, options, handler, get cancelled() { return cancelled; }, get requests() { return requests; } };
};
const reload = () => new Request("edgeever-resource://resource/res_1", { cache: "reload" });

test("HTTP 502/503 preserves current-account cached opening and cancels the error body", async () => {
  for (const status of [502, 503]) {
    const f = await fixture({ status });
    const response = await f.handler(reload());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(await response.text()).toBe("current account bytes");
    expect(f.requests).toBe(1); expect(f.cancelled).toBe(true);
  }
});

test("non-5xx authorization and deletion failures never fall back to cached bytes", async () => {
  for (const status of [401, 403, 404]) {
    const f = await fixture({ status }); const response = await f.handler(reload());
    expect(response.status).toBe(status); await response.body?.cancel();
  }
});

test("a cache miss retains 503 and cannot use another account's cache", async () => {
  const f = await fixture({ cached: false });
  const other = join(f.root, "account-b"); await mkdir(other);
  await writeFile(join(other, "res_1.bin"), "other account private bytes");
  const response = await f.handler(reload());
  expect(response.status).toBe(503); await response.body?.cancel();
});

test("account changes during a failed request abort before cached fallback", async () => {
  let scope = "a";
  const f = await fixture({ fetch: async () => { scope = "b"; return new Response("Unavailable", { status: 503 }); } });
  await expect(f.handler(reload(), () => { if (scope !== "a") throw new Error("Account changed"); })).rejects.toThrow("Account changed");
});

test("account changes after opening the cached response close its abandoned file stream", async () => {
  await promisify(execFile)("node", [fileURLToPath(new URL("../../../../tests/fixtures/resource-protocol-scope.mjs", import.meta.url))]);
});

test("existing cached range reads do not fetch, while fresh bytes replace the same cache", async () => {
  const f = await fixture({ fetch: async () => new Response("fresh server bytes", { headers: { "Content-Type": "application/pdf" } }) });
  const ranged = await f.handler(new Request("edgeever-resource://resource/res_1", { headers: { Range: "bytes=0-6" } }));
  expect(ranged.status).toBe(206); expect(await ranged.text()).toBe("current"); expect(f.requests).toBe(0);
  const fresh = await f.handler(reload()); expect(await fresh.text()).toBe("fresh server bytes");
  expect(await readFile(join(f.directory, "res_1.bin"), "utf8")).toBe("fresh server bytes");
  expect((await readdir(f.directory)).sort()).toEqual(["res_1.bin", "res_1.json"]);
});

test("network failures retain existing cached opening", async () => {
  const f = await fixture({ fetch: async () => { throw new TypeError("Offline"); } });
  expect(await (await f.handler(reload())).text()).toBe("current account bytes");
});
