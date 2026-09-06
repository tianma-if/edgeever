export const MAX_STAGED_RESOURCE_BYTES = 1024 * 1024 * 1024;
export const STAGED_RESOURCE_PART_BYTES = 8 * 1024 * 1024;
const MAX_STAGED_RESOURCE_NAME_LENGTH = 512;
const MAX_STAGED_RESOURCE_TYPE_LENGTH = 256;
const MAX_STAGED_RESOURCE_MEMO_ID_LENGTH = 160;

const normalizeMemoId = (value) => typeof value === "string" ? value.trim() : "";

export const normalizeStagedResourceMetadataInput = (input) => {
  if (!input || typeof input !== "object") throw new Error("Invalid staged resource input");
  const memoId = normalizeMemoId(input.memoId);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const type = typeof input.type === "string" && input.type.trim() ? input.type.trim() : "application/octet-stream";
  const size = Number(input.size);
  if (!memoId || memoId.length > MAX_STAGED_RESOURCE_MEMO_ID_LENGTH) throw new Error("Invalid staged resource memo id");
  if (!name || name.length > MAX_STAGED_RESOURCE_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Invalid staged resource name");
  if (type.length > MAX_STAGED_RESOURCE_TYPE_LENGTH || /[\u0000-\u001f\u007f]/.test(type)) throw new Error("Invalid staged resource type");
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_STAGED_RESOURCE_BYTES) {
    throw new Error("Staged resource must be between 1 byte and 1 GiB");
  }
  return { memoId, name, type, size };
};

export const normalizeStagedResourcePart = (value) => {
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : null;
  if (!bytes || bytes.byteLength <= 0 || bytes.byteLength > STAGED_RESOURCE_PART_BYTES) {
    throw new Error("Invalid staged resource part");
  }
  return bytes;
};

export const remapStagedResourceMetadata = (metadata, mappings) => {
  if (!metadata || typeof metadata !== "object" || !Array.isArray(mappings)) return metadata;
  const currentMemoId = normalizeMemoId(metadata.memoId);
  const mapping = mappings.find((entry) => Array.isArray(entry) && normalizeMemoId(entry[0]) === currentMemoId);
  if (!mapping) return metadata;
  const nextMemoId = normalizeMemoId(mapping[1]);
  if (!nextMemoId || nextMemoId.length > MAX_STAGED_RESOURCE_MEMO_ID_LENGTH) return metadata;
  return { ...metadata, memoId: nextMemoId };
};
