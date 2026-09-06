import ipaddr from "ipaddr.js";

export const PUBLIC_NETWORK_MAX_BYTES = 2_000_000;
export const PUBLIC_NETWORK_TIMEOUT_MS = 20_000;
const REQUEST_HEADERS = new Set(["accept", "accept-language", "if-none-match", "if-modified-since", "range"]);
const RESPONSE_HEADERS = new Set(["content-type", "cache-control", "etag", "last-modified", "location", "retry-after", "content-range", "accept-ranges"]);

export function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}

export function validatePublicUrl(input) {
  const url = new URL(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.hash) throw new Error("Only public HTTPS URLs on port 443 without credentials or fragments are supported.");
  if (ipaddr.isValid(hostname) || !hostname.includes(".") || hostname.endsWith(".") || /(?:^|\.)(localhost|local|internal|test|invalid|example|onion|home|lan|arpa)$/.test(hostname)) throw new Error("A public Internet hostname is required.");
  return url;
}

export function publicRequestHeaders(input) {
  const result = {};
  if (Object.keys(input).length > 10) throw new Error("Too many request headers.");
  for (const [key, value] of Object.entries(input)) {
    const name = key.toLowerCase();
    if (!REQUEST_HEADERS.has(name) || typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error("Unsupported public request header.");
    result[name] = value;
  }
  return result;
}

export function publicResponseHeaders(headers) {
  const result = {};
  for (const [key, value] of headers) if (RESPONSE_HEADERS.has(key.toLowerCase())) result[key.toLowerCase()] = value.slice(0, 2_000);
  return result;
}

export async function readPublicBody(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > PUBLIC_NETWORK_MAX_BYTES) throw new Error("Public response exceeds the size limit.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => undefined); }
}
