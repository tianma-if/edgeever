// CloudFlare ImgBed upload bridge. The renderer expands the upload folder in the
// user's local time; this module re-validates every field before posting bytes.
import { lookup } from "node:dns/promises";
import { assertHostShape, assertImageHostAllowed, postImageHostJson } from "./picgo.mjs";

const ADDRESS_ERROR = "Use a CloudFlare ImgBed address such as https://img.example.com";
const LABEL = "ImgBed";
export const IMGBED_NAME_TYPES = ["default", "index", "origin", "short"];
// Defaults follow the ImgBed upload API: telegram channel with server compression on.
export const IMGBED_UPLOAD_CHANNELS = ["telegram", "cfr2", "s3", "discord", "huggingface", "webdav"];
export const IMGBED_MAX_IMAGE_BYTES = 50 * 1024 * 1024;
// 1×1 transparent PNG used by the connection test.
const TEST_IMAGE = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

// Accepts the site root or a full .../upload address and returns the upload URL.
export const normalizeImgBedEndpoint = (value) => {
  let url;
  try { url = new URL(String(value ?? "").trim()); }
  catch { throw new Error(ADDRESS_ERROR); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new Error(ADDRESS_ERROR);
  }
  assertHostShape(url.hostname, ADDRESS_ERROR);
  const base = url.pathname.replace(/\/+$/, "").replace(/\/upload$/, "");
  url.pathname = `${base}/upload`;
  return url;
};

export const normalizeImgBedToken = (value) => {
  if (typeof value !== "string") throw new Error("ImgBed API token is invalid");
  const token = value.trim();
  // oxlint-disable-next-line no-control-regex -- rejects control characters and spaces in the ImgBed token
  if (!token || token.length > 1024 || /[\u0000- \u007f]/.test(token)) throw new Error("ImgBed API token is invalid");
  return token;
};

// The folder arrives already expanded. Keep it a plain relative path.
export const normalizeImgBedFolder = (value) => {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > 200) throw new Error("ImgBed upload folder is invalid");
  // oxlint-disable-next-line no-control-regex -- rejects control characters in the ImgBed upload folder
  if (/[\u0000-\u001f\u007f\\?#%<>:*|"{}]/.test(value)) throw new Error("ImgBed upload folder is invalid");
  const segments = value.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) throw new Error("ImgBed upload folder is invalid");
  return segments.join("/");
};

const buildUploadUrl = (input) => {
  const url = normalizeImgBedEndpoint(input.endpoint);
  const folder = normalizeImgBedFolder(input.uploadFolder);
  const nameType = input.nameType ?? "default";
  if (!IMGBED_NAME_TYPES.includes(nameType)) throw new Error("ImgBed file naming is invalid");
  const channel = input.uploadChannel ?? "telegram";
  if (!IMGBED_UPLOAD_CHANNELS.includes(channel)) throw new Error("ImgBed upload channel is invalid");
  if (input.serverCompress != null && typeof input.serverCompress !== "boolean") throw new Error("ImgBed server compression is invalid");
  url.searchParams.set("uploadChannel", channel);
  url.searchParams.set("serverCompress", String(input.serverCompress ?? true));
  url.searchParams.set("uploadNameType", nameType);
  if (folder) url.searchParams.set("uploadFolder", folder);
  return url;
};

// Prefer publicUrl; otherwise resolve src against the ImgBed site.
const resultUrl = (data, uploadUrl) => {
  const item = Array.isArray(data) && data.length === 1 ? data[0] : null;
  const raw = typeof item?.publicUrl === "string" && item.publicUrl ? item.publicUrl : item?.src;
  if (typeof raw !== "string" || !raw) throw new Error("ImgBed did not return an uploaded image URL");
  let url;
  try { url = new URL(raw, uploadUrl); }
  catch { throw new Error("ImgBed returned an invalid image URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("ImgBed returned an invalid image URL");
  }
  return url.href;
};

const post = async (input, file, filename, { fetchImpl, timeoutMs, lookupImpl }) => {
  const url = buildUploadUrl(input);
  const token = normalizeImgBedToken(input.token);
  await assertImageHostAllowed(url.hostname, lookupImpl, { label: LABEL, message: ADDRESS_ERROR });
  const form = new FormData();
  form.append("file", file, filename);
  let data;
  try {
    data = await postImageHostJson(url, form, fetchImpl, timeoutMs, { label: LABEL, headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    if (/HTTP (401|403)$/.test(String(error?.message))) throw new Error("ImgBed rejected the API token");
    throw error;
  }
  return { url: resultUrl(data, url) };
};

// ImgBed has no heartbeat, so the test uploads a 1×1 PNG to the configured folder.
export const testImgBedConnection = async (input, { fetchImpl = fetch, timeoutMs = 15000, lookupImpl = lookup } = {}) => {
  await post(input, new Blob([TEST_IMAGE], { type: "image/png" }), "edgeever-connection-test.png", { fetchImpl, timeoutMs, lookupImpl });
  return true;
};

export const uploadImgBedImage = async (input, { fetchImpl = fetch, timeoutMs = 60000, lookupImpl = lookup } = {}) => {
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > IMGBED_MAX_IMAGE_BYTES
    || typeof input.mimeType !== "string" || !input.mimeType.startsWith("image/")) {
    throw new Error("ImgBed requires an image of up to 50 MB");
  }
  return post(input, new Blob([bytes], { type: input.mimeType }), String(input.filename || "image.png"), { fetchImpl, timeoutMs, lookupImpl });
};
