import { describe, expect, test } from "bun:test";
import { getAttachmentByteSizeFromResponse } from "./attachment-byte-size.ts";

describe("attachment byte size discovery", () => {
  test("reads the complete size from a one-byte range response", () => {
    const response = new Response(new Uint8Array([1]), {
      status: 206,
      headers: {
        "Content-Length": "1",
        "Content-Range": "bytes 0-0/856000",
      },
    });

    expect(getAttachmentByteSizeFromResponse(response)).toBe(856000);
  });

  test("falls back to Content-Length for a full response", () => {
    const response = new Response(null, {
      status: 200,
      headers: { "Content-Length": "2048" },
    });

    expect(getAttachmentByteSizeFromResponse(response)).toBe(2048);
  });

  test("does not mistake a partial Content-Length for the complete size", () => {
    const response = new Response(new Uint8Array([1]), {
      status: 206,
      headers: { "Content-Length": "1" },
    });

    expect(getAttachmentByteSizeFromResponse(response)).toBeNull();
  });
});
