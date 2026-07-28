import { describe, expect, test } from "bun:test";
import { MAX_STAGED_RESOURCE_BYTES, normalizeStagedResourceInput } from "./staged-resource.mjs";

describe("desktop staged resource input", () => {
  test("normalizes valid structured-clone payloads", () => {
    const input = normalizeStagedResourceInput({ memoId: "memo-1", name: " photo.png ", type: " image/png ", bytes: new ArrayBuffer(3) });
    expect(input).toMatchObject({ memoId: "memo-1", name: "photo.png", type: "image/png" });
    expect(input.bytes).toBeInstanceOf(Uint8Array);
  });

  test("rejects control characters and invalid or oversized payloads", () => {
    expect(() => normalizeStagedResourceInput({ memoId: "memo-1", name: "bad\u0000name", bytes: new Uint8Array() })).toThrow("Invalid staged resource name");
    expect(() => normalizeStagedResourceInput({ memoId: "memo-1", name: "large.bin", bytes: { byteLength: MAX_STAGED_RESOURCE_BYTES + 1 } })).toThrow("Staged resource exceeds");
  });
});
