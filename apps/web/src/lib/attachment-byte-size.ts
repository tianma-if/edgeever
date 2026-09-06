import { normalizeAttachmentByteSize } from "@edgeever/shared";

const COMPLETE_LENGTH_PATTERN = /\/(\d+)\s*$/;

export const getAttachmentByteSizeFromResponse = (response: Response): number | null => {
  const contentRange = response.headers.get("Content-Range");
  const rangeTotal = contentRange?.match(COMPLETE_LENGTH_PATTERN)?.[1];
  const byteSize = normalizeAttachmentByteSize(rangeTotal);
  if (byteSize !== null) return byteSize;

  if (response.status !== 200) return null;
  return normalizeAttachmentByteSize(response.headers.get("Content-Length"));
};

export const fetchAttachmentByteSize = async (url: string, signal?: AbortSignal): Promise<number | null> => {
  if (!url) return null;

  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Range: "bytes=0-0" },
    signal,
  });
  const byteSize = response.ok ? getAttachmentByteSizeFromResponse(response) : null;
  await response.body?.cancel().catch(() => undefined);
  return byteSize;
};
