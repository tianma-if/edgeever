export const MAX_STAGED_RESOURCE_BYTES = 256 * 1024 * 1024;
const MAX_STAGED_RESOURCE_NAME_LENGTH = 512;
const MAX_STAGED_RESOURCE_TYPE_LENGTH = 256;
const MAX_STAGED_RESOURCE_MEMO_ID_LENGTH = 160;

export const normalizeStagedResourceInput = (input) => {
  if (!input || typeof input !== "object") throw new Error("Invalid staged resource input");
  const memoId = typeof input.memoId === "string" ? input.memoId.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const type = typeof input.type === "string" && input.type.trim() ? input.type.trim() : "application/octet-stream";
  const bytes = input.bytes instanceof Uint8Array
    ? input.bytes
    : input.bytes instanceof ArrayBuffer
      ? new Uint8Array(input.bytes)
      : null;
  if (!memoId || memoId.length > MAX_STAGED_RESOURCE_MEMO_ID_LENGTH) throw new Error("Invalid staged resource memo id");
  if (!name || name.length > MAX_STAGED_RESOURCE_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Invalid staged resource name");
  if (type.length > MAX_STAGED_RESOURCE_TYPE_LENGTH || /[\u0000-\u001f\u007f]/.test(type)) throw new Error("Invalid staged resource type");
  if (!bytes || bytes.byteLength > MAX_STAGED_RESOURCE_BYTES) throw new Error("Staged resource exceeds the 256 MiB limit");
  return { memoId, name, type, bytes };
};
