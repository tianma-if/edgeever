// PicGo and PicList own the image-host credentials. This bridge only posts
// image bytes to the server address the user saved. It never reads the
// clipboard or writes temporary files.
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const ADDRESS_ERROR = "Use a PicGo or PicList upload address ending in /upload, such as http://127.0.0.1:36677/upload";
const BLOCKED_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog"]);

const blockedAddresses = new BlockList();
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddresses.addSubnet("224.0.0.0", 4, "ipv4");
blockedAddresses.addSubnet("240.0.0.0", 4, "ipv4");
blockedAddresses.addAddress("100.100.100.200", "ipv4");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");
blockedAddresses.addSubnet("ff00::", 8, "ipv6");
blockedAddresses.addAddress("::", "ipv6");
blockedAddresses.addAddress("fd00:ec2::254", "ipv6");

const canonicalHost = (hostname) => {
  let host = String(hostname).toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host;
};

const isLiteralHost = (host) => host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

// Link-local and cloud metadata addresses are rejected. LAN and public
// addresses stay available because a remote PicList usually lives on a NAS.
export const isBlockedPicGoAddress = (address) => {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const candidate = mapped ? mapped[1] : address;
  const family = isIP(candidate);
  if (family === 4) {
    const canonical = candidate.split(".").map((part) => String(Number(part))).join(".");
    if (canonical !== candidate) return true;
    return blockedAddresses.check(candidate, "ipv4");
  }
  if (family === 6) return blockedAddresses.check(candidate, "ipv6");
  return true;
};

export const assertHostShape = (hostname, message = ADDRESS_ERROR) => {
  const host = canonicalHost(hostname);
  if (!host || BLOCKED_HOSTNAMES.has(host) || /^\d+$/.test(host)) throw new Error(message);
  if (isLiteralHost(host) && isBlockedPicGoAddress(host)) throw new Error(message);
};

export const normalizePicGoServerKey = (value) => {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new Error("PicGo server key is invalid");
  const key = value.trim();
  if (!key) return "";
  // oxlint-disable-next-line no-control-regex -- rejects control characters and spaces in the PicGo server key
  if (key.length > 512 || /[\u0000-\u0020\u007f]/.test(key)) throw new Error("PicGo server key is invalid");
  return key;
};

export const normalizePicGoEndpoint = (value) => {
  let url;
  try { url = new URL(value); }
  catch { throw new Error(ADDRESS_ERROR); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search || !url.pathname.endsWith("/upload")) {
    throw new Error(ADDRESS_ERROR);
  }
  assertHostShape(url.hostname);
  return url;
};

// A reverse proxy may mount PicList under a prefix; heartbeat sits beside /upload.
const buildPicGoUrl = (endpoint, serverKey, action) => {
  const url = normalizePicGoEndpoint(endpoint);
  if (action === "heartbeat") url.pathname = `${url.pathname.slice(0, -"/upload".length)}/heartbeat`;
  const key = normalizePicGoServerKey(serverKey);
  if (key) url.searchParams.set("key", key);
  return url;
};

export const assertImageHostAllowed = async (hostname, lookupImpl, { label = "PicGo", message = ADDRESS_ERROR } = {}) => {
  assertHostShape(hostname, message);
  const host = canonicalHost(hostname);
  if (isLiteralHost(host)) return;
  let records;
  try {
    records = await lookupImpl(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`${label} host could not be resolved`);
  }
  if (!Array.isArray(records) || records.length === 0) throw new Error(`${label} host could not be resolved`);
  for (const record of records) {
    if (!record || typeof record.address !== "string" || isBlockedPicGoAddress(record.address)) throw new Error(message);
  }
};

export const postImageHostJson = async (url, body, fetchImpl, timeoutMs, { label = "PicGo", headers } = {}) => {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST", body, headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error && typeof error === "object" ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new Error(`${label} did not respond in time`);
    throw new Error(`${label} could not be reached`);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`${label} HTTP ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${label} returned an empty response`);
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) throw new Error(`${label} response is too large`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${label} returned an unreadable response`);
  }
};

export const testPicGoConnection = async (endpoint, { fetchImpl = fetch, timeoutMs = 5000, serverKey = "", lookupImpl = lookup } = {}) => {
  const url = buildPicGoUrl(endpoint, serverKey, "heartbeat");
  await assertImageHostAllowed(url.hostname, lookupImpl);
  const data = await postImageHostJson(url, undefined, fetchImpl, timeoutMs);
  if (data?.success !== true || data.result !== "alive") throw new Error("The service did not identify itself as PicGo or PicList");
  return true;
};

export const uploadPicGoImage = async (input, { fetchImpl = fetch, timeoutMs = 60000, lookupImpl = lookup } = {}) => {
  const url = buildPicGoUrl(input.endpoint, input.serverKey, "upload");
  await assertImageHostAllowed(url.hostname, lookupImpl);
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 50 * 1024 * 1024
    || typeof input.mimeType !== "string" || !input.mimeType.startsWith("image/")) {
    throw new Error("PicGo requires an image of up to 50 MB");
  }
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: input.mimeType }), String(input.filename || "image.png"));
  const data = await postImageHostJson(url, form, fetchImpl, timeoutMs);
  if (data?.success !== true || !Array.isArray(data.result) || data.result.length !== 1) {
    throw new Error("PicGo did not return an uploaded image URL");
  }
  const result = new URL(data.result[0]);
  if (!["http:", "https:"].includes(result.protocol) || result.username || result.password) {
    throw new Error("PicGo returned an invalid image URL");
  }
  return { url: result.href };
};

export const createPicGoUploadQueue = ({ upload = uploadPicGoImage, chooseFailure, isActive }) => {
  let queue = Promise.resolve();
  return (input, isRequestActive = isActive) => {
    const run = async () => {
      while (true) {
        if (!isRequestActive()) throw new Error("The editor closed");
        try { return await upload(input); }
        catch {
          if (!isRequestActive()) throw new Error("The editor closed");
          const response = await chooseFailure(input);
          if (response === 1) return { fallback: true };
          if (response !== 0) throw new Error("PicGo upload cancelled");
        }
      }
    };
    const pending = queue.then(run);
    queue = pending.catch(() => {});
    return pending;
  };
};
