import { describe, expect, test } from "bun:test";
import { parseByteRange } from "./byte-range.ts";

describe("HTTP byte range parsing", () => {
  test("supports bounded, open-ended, and suffix ranges", () => {
    expect(parseByteRange("bytes=2-5", 10)).toEqual({
      kind: "range",
      range: { offset: 2, length: 4 },
      end: 5,
    });
    expect(parseByteRange("bytes=7-", 10)).toMatchObject({
      kind: "range",
      range: { offset: 7, length: 3 },
    });
    expect(parseByteRange("bytes=-4", 10)).toMatchObject({
      kind: "range",
      range: { offset: 6, length: 4 },
    });
  });

  test("rejects malformed, multipart, and unsatisfiable ranges", () => {
    expect(parseByteRange("items=0-1", 10)).toEqual({ kind: "invalid" });
    expect(parseByteRange("bytes=0-1,4-5", 10)).toEqual({ kind: "invalid" });
    expect(parseByteRange("bytes=10-", 10)).toEqual({ kind: "invalid" });
    expect(parseByteRange("bytes=8-2", 10)).toEqual({ kind: "invalid" });
  });
});
