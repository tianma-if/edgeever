import { createHash } from "node:crypto";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createResourceCacheWrites, createResourceProtocolHandler } from "./resource-protocol.mjs";

const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const fixture = async ({ status = 503, cached = true, fetch: fetchOverride } = {}) => {
  const root = await mkdtemp(join(tmpdir(), "edgeever-resource-protocol-")); directories.push(root);
  const directory = join(root, "account-a"); await mkdir(directory);
  if (cached) {
    await writeFile(join(directory, "res_1.bin"), "current account bytes");
    await writeFile(join(directory, "res_1.json"), JSON.stringify({ contentType: "application/pdf", byteSize: 21, sha256: createHash("sha256").update("current account bytes").digest("hex") }));
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

const opening = () => new Request("edgeever-resource://resource/res_1");
const sha256 = value => createHash("sha256").update(value).digest("hex");

test("legacy truncated cache automatically downloads the full resource using catalog integrity", async () => {
  const full = "complete server image";
  const f = await fixture({ fetch: async () => new Response(full, { headers: { "Content-Length": String(full.length) } }) });
  await writeFile(join(f.directory, "res_1.bin"), full.slice(0, 3));
  await writeFile(join(f.directory, "res_1.json"), JSON.stringify({ contentType: "image/png" }));
  f.options.getIntegrity = async () => ({ byteSize: full.length, sha256: sha256(full) });
  expect(await (await f.handler(opening())).text()).toBe(full);
  expect(f.requests).toBe(1);
  expect(await (await f.handler(opening())).text()).toBe(full);
  expect(f.requests).toBe(1);
  expect(JSON.parse(await readFile(join(f.directory, "res_1.json"), "utf8"))).toMatchObject({ byteSize: full.length, sha256: sha256(full) });
});

test("legacy checksum promotion during writeback preserves the acknowledged offline version", async () => {
  const f = await fixture({ fetch: async () => { throw new TypeError("Offline"); } });
  const bytesPath = join(f.directory, "res_1.bin");
  const metadataPath = join(f.directory, "res_1.json");
  await writeFile(metadataPath, JSON.stringify({ contentType: "text/plain" }));
  const writes = createResourceCacheWrites();
  const promoting = Promise.withResolvers();
  const handler = createResourceProtocolHandler({
    ...f.options,
    getIntegrity: () => ({ byteSize: 21, sha256: sha256("current account bytes") }),
    cacheWrites: {
      observe(path) {
        const read = writes.observe(path);
        return { ...read, publish(write) {
          const published = read.publish(write);
          promoting.resolve();
          return published;
        } };
      },
    },
  });
  const updated = "the edited attachment";
  const save = writes.replace(bytesPath, async () => {
    // Both old files remain visible until the in-progress replacement installs its bytes.
    await promoting.promise;
    await writeFile(bytesPath, updated);
    await writeFile(metadataPath, JSON.stringify({ byteSize: updated.length, sha256: sha256(updated) }));
  });
  const legacyRead = handler(opening());
  await save;
  await (await legacyRead).arrayBuffer();
  expect(JSON.parse(await readFile(metadataPath, "utf8")).sha256).toBe(sha256(updated));
  expect(await (await handler(reload())).text()).toBe(updated);
});

test("valid legacy cache remains available offline using synced size and checksum", async () => {
  const f = await fixture();
  await writeFile(join(f.directory, "res_1.json"), JSON.stringify({ contentType: "application/pdf" }));
  f.options.getIntegrity = async () => ({ byteSize: 21, sha256: sha256("current account bytes") });
  expect(await (await f.handler(opening())).text()).toBe("current account bytes");
  expect(f.requests).toBe(0);
});

test("legacy files absent from the catalog are validated by HEAD once, then work offline", async () => {
  const f = await fixture({ fetch: async (_url, init) => {
    expect(init.method).toBe("HEAD");
    expect(init.cache).toBe("no-store");
    return new Response(null, { headers: { "Content-Length": "21" } });
  } });
  await writeFile(join(f.directory, "res_1.json"), JSON.stringify({ contentType: "application/pdf" }));
  expect(await (await f.handler(opening())).text()).toBe("current account bytes");
  f.options.fetch = async () => { throw new Error("offline"); };
  expect(await (await f.handler(opening())).text()).toBe("current account bytes");
  expect(f.requests).toBe(1);
});

test("a legacy prefix absent from the catalog is repaired after HEAD discovers its full length", async () => {
  const full = "current account bytes";
  const methods = [];
  const f = await fixture({ fetch: async (_url, init) => {
    methods.push(init.method ?? "GET");
    return new Response(init.method === "HEAD" ? null : full, { headers: { "Content-Length": "21" } });
  } });
  await writeFile(join(f.directory, "res_1.json"), JSON.stringify({ contentType: "application/pdf" }));
  await writeFile(join(f.directory, "res_1.bin"), full.slice(0, 3));
  expect(await (await f.handler(opening())).text()).toBe(full);
  expect(methods).toEqual(["HEAD", "GET"]);
});

test("offline legacy files without any integrity information are retained for later validation", async () => {
  const f = await fixture({ fetch: async () => { throw new Error("offline"); } });
  await writeFile(join(f.directory, "res_1.json"), JSON.stringify({ contentType: "application/pdf" }));
  expect((await f.handler(opening())).status).toBe(504);
  expect(await readFile(join(f.directory, "res_1.bin"), "utf8")).toBe("current account bytes");
});

test("same-size corruption repairs the whole cache before subsequent range reads", async () => {
  const full = "current account bytes";
  const f = await fixture({ fetch: async (_url, init) => {
    expect(init.headers.get("range")).toBeNull();
    expect(init.cache).toBe("no-store");
    return new Response(full, { headers: { "Content-Length": String(full.length) } });
  } });
  await writeFile(join(f.directory, "res_1.bin"), "x".repeat(full.length));
  const ranged = () => new Request(opening(), { headers: { Range: "bytes=0-6" } });
  const result = await f.handler(ranged());
  expect(result.status).toBe(200);
  expect(await result.text()).toBe(full);
  expect(await readFile(join(f.directory, "res_1.bin"), "utf8")).toBe(full);
  const cached = await f.handler(ranged());
  expect(cached.status).toBe(206);
  expect(await cached.text()).toBe("current");
  expect(f.requests).toBe(1);
});

test("short and oversized downloads never replace an existing valid cache", async () => {
  for (const size of [3, 100]) {
    const f = await fixture({ fetch: async () => new Response("incomplete", { headers: { "Content-Length": String(size) } }) });
    const result = await f.handler(reload());
    await expect(result.text()).rejects.toThrow();
    expect(await readFile(join(f.directory, "res_1.bin"), "utf8")).toBe("current account bytes");
    expect((await readdir(f.directory)).sort()).toEqual(["res_1.bin", "res_1.json"]);
  }
});

test("a file changed after successful verification is checked again", async () => {
  const f = await fixture({ fetch: async () => new Response("current account bytes") });
  expect(await (await f.handler(opening())).text()).toBe("current account bytes");
  await writeFile(join(f.directory, "res_1.bin"), "x".repeat(21));
  expect(await (await f.handler(opening())).text()).toBe("current account bytes");
  expect(f.requests).toBe(1);
});

test("a network error after the first chunk removes temporary bytes and preserves the verified cache", async () => {
  let pulls = 0;
  const f = await fixture({ fetch: async () => new Response(new ReadableStream({
    pull(controller) {
      if (pulls++ === 0) controller.enqueue(new TextEncoder().encode("prefix"));
      else throw new Error("connection lost");
    },
  })) });
  await expect((await f.handler(reload())).text()).rejects.toThrow("connection lost");
  expect(await readFile(join(f.directory, "res_1.bin"), "utf8")).toBe("current account bytes");
  expect((await readdir(f.directory)).sort()).toEqual(["res_1.bin", "res_1.json"]);
});

test("cancelling during a pending source read never promotes a partial cache", async () => {
  let waiting, resolveRead, reads = 0;
  const sourceWaiting = new Promise(resolve => { waiting = resolve; });
  // Web Streams cancellation resolves an outstanding read with done=true.
  // Control the reader explicitly so cancellation occurs during that read,
  // rather than between pulls (where the old code also appeared to work).
  const sourceReader = {
    read() {
      if (reads++ === 0) return Promise.resolve({ value: new TextEncoder().encode("prefix"), done: false });
      const result = new Promise(resolve => { resolveRead = resolve; });
      waiting();
      return result;
    },
    async cancel() { resolveRead?.({ done: true }); },
  };
  const f = await fixture({ cached: false, fetch: async () => ({
    ok: true, status: 200, headers: new Headers({ "Content-Length": "100000" }),
    body: { getReader: () => sourceReader },
  }) });
  const reader = (await f.handler(opening())).body.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("prefix");
  const pending = reader.read();
  await sourceWaiting;
  await reader.cancel();
  await pending;
  expect(await readdir(f.directory)).toEqual([]);
});
