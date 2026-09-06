import { expect, test } from "bun:test";
import { createPublicNetworkAdapter } from "./public-network-adapter";
const input = { url: "https://example.org/feed", method: "GET", headers: { accept: "text/plain" } };

test("Web public transport uses a readable direct response without backend relay", async () => {
  let relays = 0;
  const adapter = createPublicNetworkAdapter({ fetchPublic: async () => { relays++; throw new Error("unused"); } }, { direct: async () => new Response("direct", { status: 200 }) });
  const result = await adapter.fetchPublic(input);
  expect(new TextDecoder().decode(result.body)).toBe("direct"); expect(relays).toBe(0);
});

test("Web public transport falls back only for browser network/CORS failure", async () => {
  let relays = 0;
  const relay = { fetchPublic: async value => { relays++; return { ...value, status: 200, statusText: "OK", body: new TextEncoder().encode("relay").buffer }; } };
  const adapter = createPublicNetworkAdapter(relay, { direct: async () => { throw new TypeError("Failed to fetch"); } });
  expect(new TextDecoder().decode((await adapter.fetchPublic(input)).body)).toBe("relay"); expect(relays).toBe(1);
  const limited = createPublicNetworkAdapter(relay, { direct: async () => { throw new Error("Public response exceeds the size limit."); } });
  await expect(limited.fetchPublic(input)).rejects.toThrow("size limit"); expect(relays).toBe(1);
});

test("desktop public transport stays on the device and propagates cancellation", async () => {
  let relays = 0, cancelled = "";
  const desktop = {
    publicNetworkFetch: async (_id, value) => ({ ...value, status: 200, statusText: "OK", body: new ArrayBuffer(0) }),
    cancelPublicNetworkFetch: async id => { cancelled = id; },
  };
  const adapter = createPublicNetworkAdapter({ fetchPublic: async () => { relays++; throw new Error("unused"); } }, { desktop });
  expect((await adapter.fetchPublic(input)).status).toBe(200); expect(relays).toBe(0);
  const controller = new AbortController(); let rejectPending;
  const pendingDesktop = { publicNetworkFetch: () => new Promise((_resolve, reject) => { rejectPending = reject; }), cancelPublicNetworkFetch: async id => { cancelled = id; rejectPending(new Error("cancelled")); } };
  const pending = createPublicNetworkAdapter({ fetchPublic: async () => { throw new Error("unused"); } }, { desktop: pendingDesktop }).fetchPublic(input, { signal: controller.signal });
  controller.abort(); await expect(pending).rejects.toThrow(); expect(cancelled).not.toBe("");
});
