export const isSafeResourceId = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9._~-]+$/.test(value) && value !== "." && value !== "..";

export const resourceIdFromRequest = (requestUrl) => {
  try {
    const url = new URL(requestUrl);
    const pathId = url.pathname.replace(/^\//, "");
    const id = decodeURIComponent(pathId || url.hostname);
    return isSafeResourceId(id) ? id : null;
  } catch {
    return null;
  }
};

export const parseByteRangeHeader = (header, totalSize) => {
  if (!header) return { kind: "none" };
  if (!Number.isSafeInteger(totalSize) || totalSize <= 0) return { kind: "invalid" };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return { kind: "invalid" };

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: "invalid" };
    const length = Math.min(suffixLength, totalSize);
    return { kind: "range", offset: totalSize - length, length };
  }

  const offset = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : totalSize - 1;
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(requestedEnd)
    || requestedEnd < offset
    || offset >= totalSize
  ) return { kind: "invalid" };

  const end = Math.min(requestedEnd, totalSize - 1);
  return { kind: "range", offset, length: end - offset + 1 };
};

export const cachedResourceResponse = (bytes, contentType, rangeHeader) => {
  const range = parseByteRangeHeader(rangeHeader, bytes.byteLength);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": contentType || "application/octet-stream",
  });

  if (range.kind === "invalid") {
    headers.set("Content-Range", `bytes */${bytes.byteLength}`);
    return new Response(null, { status: 416, headers });
  }
  if (range.kind === "range") {
    const end = range.offset + range.length - 1;
    headers.set("Content-Length", String(range.length));
    headers.set("Content-Range", `bytes ${range.offset}-${end}/${bytes.byteLength}`);
    return new Response(bytes.subarray(range.offset, end + 1), { status: 206, headers });
  }

  headers.set("Content-Length", String(bytes.byteLength));
  return new Response(bytes, { status: 200, headers });
};
