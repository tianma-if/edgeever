import type { ImageThumbnailAdapter } from "./api-context";

/**
 * Thin Cloudflare Images binding adapter. Falls back to `null` when
 * transformation fails so the caller can serve the original bytes.
 */
export const createCloudflareImageThumbnailAdapter = (
  images: ImagesBinding,
): ImageThumbnailAdapter => async ({ bytes, width }) => {
  try {
    const stream = new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>;
    const transformed = await images
      .input(stream)
      .transform({ width, fit: "scale-down" })
      .output({ format: "image/webp", quality: 80 });
    const outputBytes = new Uint8Array(await new Response(transformed.image()).arrayBuffer());
    if (outputBytes.byteLength === 0) return null;
    return {
      bytes: outputBytes,
      mimeType: transformed.contentType() || "image/webp",
    };
  } catch {
    return null;
  }
};
