export const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return sha256Bytes(bytes);
};

export const sha256Bytes = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
