import { nodePublicFetch } from "@edgeever/public-network/node";
import { PUBLIC_NETWORK_TIMEOUT_MS, publicRequestHeaders, publicResponseHeaders, readPublicBody, validatePublicUrl } from "@edgeever/public-network/policy";

export function createPluginPublicNetworkRuntime({ fetchPublic = nodePublicFetch, timeoutMs = PUBLIC_NETWORK_TIMEOUT_MS, maxConcurrent = 4 } = {}) {
  const active = new Map();
  return {
    async fetch(requestId, input) {
      if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 100 || !input || typeof input !== "object") throw new Error("Invalid public network request");
      const url = validatePublicUrl(input.url);
      const method = input.method ?? "GET";
      if (!["GET", "HEAD"].includes(method)) throw new Error("Public transport supports GET/HEAD only");
      const headers = publicRequestHeaders(input.headers ?? {});
      if (active.size >= maxConcurrent || active.has(requestId)) throw new Error("Too many public network requests");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("Public network request timed out")), timeoutMs);
      active.set(requestId, controller);
      try {
        const aborted = new Promise((_, reject) => {
          if (controller.signal.aborted) reject(controller.signal.reason);
          else controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
        });
        const response = await Promise.race([
          fetchPublic(url.href, { method, headers: { ...headers, "User-Agent": "EdgeEver-Plugins/1.0" }, redirect: "manual", signal: controller.signal }),
          aborted,
        ]);
        const bytes = await readPublicBody(response, controller.signal);
        return { url: url.href, status: response.status, statusText: response.statusText, headers: publicResponseHeaders(response.headers), body: bytes.buffer };
      } finally {
        clearTimeout(timeout);
        active.delete(requestId);
      }
    },
    cancel(requestId) {
      const controller = active.get(requestId);
      if (!controller) return false;
      controller.abort(new Error("Public network request cancelled"));
      return true;
    },
    get activeCount() { return active.size; },
  };
}
