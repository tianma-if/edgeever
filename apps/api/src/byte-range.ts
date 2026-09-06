import type { BlobRange } from "./storage-contract";

export type ByteRangeResult =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "range"; range: BlobRange; end: number };

/** Parses one RFC 9110 byte range. Multipart ranges are intentionally unsupported. */
export const parseByteRange = (header: string | undefined, totalSize: number): ByteRangeResult => {
  if (!header) return { kind: "none" };
  if (!Number.isSafeInteger(totalSize) || totalSize <= 0) return { kind: "invalid" };

  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return { kind: "invalid" };

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: "invalid" };
    const length = Math.min(suffixLength, totalSize);
    const offset = totalSize - length;
    return { kind: "range", range: { offset, length }, end: totalSize - 1 };
  }

  const offset = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : totalSize - 1;
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(requestedEnd)
    || offset < 0
    || requestedEnd < offset
    || offset >= totalSize
  ) {
    return { kind: "invalid" };
  }

  const end = Math.min(requestedEnd, totalSize - 1);
  return { kind: "range", range: { offset, length: end - offset + 1 }, end };
};

export const rangeNotSatisfiable = (totalSize: number) => new Response(null, {
  status: 416,
  headers: {
    "Accept-Ranges": "bytes",
    "Content-Range": `bytes */${totalSize}`,
  },
});
