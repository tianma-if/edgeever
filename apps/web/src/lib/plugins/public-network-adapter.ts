import type { PluginPublicFetchRequest, PluginPublicFetchResponse } from "@edgeever/shared";

const MAX_BYTES = 2_000_000;
const SAFE_RESPONSE_HEADERS = new Set(["content-type", "cache-control", "etag", "last-modified", "location", "retry-after", "content-range", "accept-ranges"]);
type Relay = { fetchPublic(input: PluginPublicFetchRequest, options?: { signal?: AbortSignal }): Promise<PluginPublicFetchResponse> };
type DesktopBridge = Pick<EdgeEverDesktopBridge, "publicNetworkFetch" | "cancelPublicNetworkFetch">;

async function responseToResult(input: PluginPublicFetchRequest, response: Response, signal?: AbortSignal): Promise<PluginPublicFetchResponse> {
  signal?.throwIfAborted();
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error("Public response exceeds the size limit.");
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) {
    const abort = () => { void reader.cancel().catch(() => undefined); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        const { done, value } = await reader.read(); signal?.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("Public response exceeds the size limit.");
        chunks.push(value);
      }
    } finally { signal?.removeEventListener("abort", abort); await reader.cancel().catch(() => undefined); }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const headers: Record<string, string> = {};
  for (const [name, value] of response.headers) if (SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value.slice(0, 2_000);
  return { url: input.url, status: response.status, statusText: response.statusText, headers, body: bytes.buffer };
}

export function createPublicNetworkAdapter(relay: Relay, options: {
  direct?: typeof fetch;
  desktop?: DesktopBridge;
} = {}): Relay {
  return {
    async fetchPublic(input, requestOptions) {
      const signal = requestOptions?.signal;
      if (options.desktop) {
        const requestId = crypto.randomUUID();
        const abort = () => { void options.desktop!.cancelPublicNetworkFetch(requestId); };
        signal?.addEventListener("abort", abort, { once: true });
        try {
          signal?.throwIfAborted();
          const result = await options.desktop.publicNetworkFetch(requestId, input);
          signal?.throwIfAborted();
          return result;
        } finally { signal?.removeEventListener("abort", abort); }
      }
      const direct = options.direct ?? globalThis.fetch;
      try {
        const response = await direct(input.url, { method: input.method, headers: input.headers, credentials: "omit", redirect: "manual", signal });
        if (response.type === "opaqueredirect" || response.status === 0) throw new TypeError("Browser could not expose the public response");
        return await responseToResult(input, response, signal);
      } catch (error) {
        signal?.throwIfAborted();
        // Browser fetch rejects CORS and network failures with TypeError. The authenticated relay is the Web fallback.
        if (!(error instanceof TypeError)) throw error;
        return relay.fetchPublic(input, requestOptions);
      }
    },
  };
}
