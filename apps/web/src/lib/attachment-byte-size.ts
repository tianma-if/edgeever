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

  // Local API metadata is authorized against the workspace without opening R2/S3.
  // Older instances can still answer the existing one-byte range request.
  const origin = globalThis.window?.location?.origin;
  const parsed = origin && /^https?:\/\//.test(origin) ? new URL(url, origin) : null;
  if (parsed?.origin === origin && /^\/api\/v1\/resources\/[^/]+\/blob$/.test(parsed.pathname)) {
    const metadataUrl = new URL(parsed.href);
    metadataUrl.pathname = metadataUrl.pathname.replace(/\/blob$/, "/metadata");
    const metadata = await fetch(metadataUrl.href, { cache: "no-store", credentials: "same-origin", signal });
    if (metadata.ok) {
      const body = await metadata.json() as { byteSize?: unknown };
      return normalizeAttachmentByteSize(body.byteSize);
    }
    if (metadata.status !== 404 && metadata.status !== 405) return null;
    if (metadata.status === 404) {
      const body = await metadata.json().catch(() => null) as { error?: { code?: string } } | null;
      if (body?.error?.code === "resource_not_found") return null;
    }
  }

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
