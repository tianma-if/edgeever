/** Formats rendered through an image element, never injected as document markup. */
export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml",
]);

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
