import { expect, test } from "bun:test";
import { createPluginPublicNetworkRuntime } from "./plugin-public-network.mjs";
const input = { url: "https://example.org/feed", method: "GET", headers: { Accept: "text/plain" } };

test("desktop public requests stay local, preserve safe metadata, and release their slot", async () => {
  let received;
  const runtime = createPluginPublicNetworkRuntime({ fetchPublic: async (url, init) => {
    received = { url, init };
    return new Response("desktop", { status: 202, headers: { "Content-Type": "text/plain", "Set-Cookie": "hidden" } });
  } });
  const result = await runtime.fetch("one", input);
  expect(received.url).toBe(input.url); expect(received.init.headers["User-Agent"]).toBe("EdgeEver-Plugins/1.0");
  expect(result.status).toBe(202); expect(new TextDecoder().decode(result.body)).toBe("desktop");
  expect(result.headers).toEqual({ "content-type": "text/plain" }); expect(runtime.activeCount).toBe(0);
});

test("desktop public requests enforce validation, concurrency, timeout and cancellation", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const runtime = createPluginPublicNetworkRuntime({ maxConcurrent: 1, timeoutMs: 10_000, fetchPublic: async () => { await gate; return new Response("ok"); } });
  const pending = runtime.fetch("one", input).catch(error => error);
  const busy = await runtime.fetch("two", input).catch(error => error); expect(busy.message).toContain("Too many");
  expect(runtime.cancel("one")).toBe(true); const cancelled = await pending; expect(cancelled.message).toContain("cancelled"); expect(runtime.activeCount).toBe(0); release();
  await expect(runtime.fetch("private", { ...input, url: "https://127.0.0.1" })).rejects.toThrow();
  await expect(runtime.fetch("post", { ...input, method: "POST" })).rejects.toThrow();
});

test("desktop preload and main process expose the local transport pair", async () => {
  const [main, preload] = await Promise.all([
    Bun.file(new URL("./index.mjs", import.meta.url)).text(),
    Bun.file(new URL("../preload/index.cjs", import.meta.url)).text(),
  ]);
  expect(main).toContain('ipcMain.handle("desktop:public-network-fetch"');
  expect(main).toContain('ipcMain.on("desktop:cancel-public-network-fetch"');
  expect(preload).toContain('publicNetworkFetch: (requestId, input) => ipcRenderer.invoke("desktop:public-network-fetch"');
  expect(preload).toContain('ipcRenderer.send("desktop:cancel-public-network-fetch"');
});
