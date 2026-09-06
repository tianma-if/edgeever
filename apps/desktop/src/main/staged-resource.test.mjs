import { describe, expect, test } from "bun:test";
import {
  MAX_STAGED_RESOURCE_BYTES,
  STAGED_RESOURCE_PART_BYTES,
  normalizeStagedResourceMetadataInput,
  normalizeStagedResourcePart,
  remapStagedResourceMetadata,
} from "./staged-resource.mjs";

describe("desktop staged resource input", () => {
  test("normalizes valid metadata without accepting the complete file", () => {
    const input = normalizeStagedResourceMetadataInput({ memoId: "memo-1", name: " photo.png ", type: " image/png ", size: 3 });
    expect(input).toEqual({ memoId: "memo-1", name: "photo.png", type: "image/png", size: 3 });
  });

  test("rejects control characters and invalid or oversized metadata", () => {
    expect(() => normalizeStagedResourceMetadataInput({ memoId: "memo-1", name: "bad\u0000name", size: 1 })).toThrow("Invalid staged resource name");
    expect(() => normalizeStagedResourceMetadataInput({ memoId: "memo-1", name: "large.bin", size: MAX_STAGED_RESOURCE_BYTES + 1 })).toThrow("1 GiB");
  });

  test("bounds every staged write to one multipart-sized chunk", () => {
    expect(normalizeStagedResourcePart(new ArrayBuffer(3))).toBeInstanceOf(Uint8Array);
    expect(() => normalizeStagedResourcePart(new Uint8Array())).toThrow("Invalid staged resource part");
    expect(() => normalizeStagedResourcePart(new Uint8Array(STAGED_RESOURCE_PART_BYTES + 1))).toThrow("Invalid staged resource part");
  });

  test("remaps a staged image from its temporary memo id to the server id", () => {
    const metadata = { id: "stage-1", memoId: "memo_local_1", name: "photo.png" };

    expect(remapStagedResourceMetadata(metadata, [["memo_local_1", "memo_remote_1"]])).toEqual({
      ...metadata,
      memoId: "memo_remote_1",
    });
    expect(remapStagedResourceMetadata(metadata, [["another", "memo_remote_2"]])).toBe(metadata);
  });
});
