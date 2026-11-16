import { sha256 } from "@noble/hashes/sha2.js";

export const sha256Hex = async (value: string | ArrayBuffer) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  // LAN HTTP origins do not expose SubtleCrypto. Always compute the same SHA-256.
  const digest = globalThis.crypto?.subtle
    ? await crypto.subtle.digest("SHA-256", bytes)
    : sha256(new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
