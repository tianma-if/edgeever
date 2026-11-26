/** Formats rendered through an image element, never injected as document markup. */
export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml",
]);

/** Raster image formats eligible for server-side WebP thumbnail generation. */
export const RESIZABLE_THUMBNAIL_IMAGE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/avif",
]);

export const RESOURCE_THUMBNAIL_DEFAULT_WIDTH = 400;
export const RESOURCE_THUMBNAIL_MIN_WIDTH = 64;
export const RESOURCE_THUMBNAIL_MAX_WIDTH = 1600;
export const RESOURCE_THUMBNAIL_WIDTH_BUCKETS = [200, 400, 800, 1200, 1600] as const;

export type ParsedResourceThumbnailWidth =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "valid"; width: number };

export const normalizeResourceMimeType = (mimeType?: string | null): string =>
  mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";

export const isResizableThumbnailMimeType = (mimeType?: string | null): boolean =>
  RESIZABLE_THUMBNAIL_IMAGE_MIME_TYPES.has(normalizeResourceMimeType(mimeType));

/**
 * Validates `?w=` on `/api/v1/resources/:id/blob` and snaps valid widths to a
 * bounded set of buckets to prevent cache amplification.
 */
export const parseResourceThumbnailWidth = (raw: string | undefined): ParsedResourceThumbnailWidth => {
  if (raw === undefined) return { kind: "none" };
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { kind: "invalid" };
  const numeric = Number(trimmed);
  if (
    !Number.isSafeInteger(numeric)
    || numeric < RESOURCE_THUMBNAIL_MIN_WIDTH
    || numeric > RESOURCE_THUMBNAIL_MAX_WIDTH
  ) {
    return { kind: "invalid" };
  }
  const bucket = RESOURCE_THUMBNAIL_WIDTH_BUCKETS.find((candidate) => candidate >= numeric)
    ?? RESOURCE_THUMBNAIL_MAX_WIDTH;
  return { kind: "valid", width: bucket };
};

/** Some file pickers omit SVG MIME metadata. Do not override an explicit type. */
export const resolveResourceUploadMimeType = (filename: string, mimeType?: string | null): string => {
  const type = mimeType?.split(";")[0]?.trim().toLowerCase();
  if ((!type || type === "application/octet-stream") && /\.svg$/i.test(filename.trim())) {
    return "image/svg+xml";
  }
  return type || "application/octet-stream";
};

// SVG must also be inert when its URL is opened as a document. Keep inline styles
// and embedded images for exported diagrams, but prohibit scripts and network access.
export const SVG_RESOURCE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox";

export const setSvgResourceSecurityHeaders = (headers: Headers): void => {
  if (headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() === "image/svg+xml") {
    headers.set("Content-Security-Policy", SVG_RESOURCE_CONTENT_SECURITY_POLICY);
  }
};
