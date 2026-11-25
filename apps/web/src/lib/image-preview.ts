/**
 * Downscaled previews for resource images.
 *
 * A single poster upload can be a 2560×27421 PNG: decoding it costs hundreds of
 * megabytes of bitmap memory and turns every hover repaint of a kanban or
 * gallery card into a long task. Cards only ever paint a few hundred pixels, so
 * decode the source once with `createImageBitmap` resize options, then serve a
 * small WebP blob from memory to every card that references the resource.
 *
 * The full-resolution blob stays the click-through target, so opening or
 * downloading a card image is unchanged.
 */

const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/** Formats we must not re-encode: animation and vector content would be lost. */
const UNRESIZED_MIME_TYPES = new Set(["image/svg+xml", "image/gif", "image/apng", "image/avif"]);

const PREVIEW_QUALITY = 0.82;
/** Guard rail: never build a bitmap bigger than this on the longest edge. */
const PREVIEW_MAX_EDGE = 640;

export const resourceBlobPath = (resourceId: string) =>
  `/api/v1/resources/${encodeURIComponent(resourceId)}/blob`;

const cacheKey = (resourceId: string, width: number) => `${resourceId}@${Math.round(width)}`;

const encodePreview = async (bitmap: ImageBitmap): Promise<Blob | null> => {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0);
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/webp", PREVIEW_QUALITY);
  });
};

const buildPreview = async (resourceId: string, width: number): Promise<string | null> => {
  const response = await fetch(resourceBlobPath(resourceId), { credentials: "include" });
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!blob.type.startsWith("image/") || blob.size === 0) return null;
  const mimeType = blob.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (UNRESIZED_MIME_TYPES.has(mimeType)) return URL.createObjectURL(blob);
  if (typeof createImageBitmap !== "function") return URL.createObjectURL(blob);

  const targetWidth = Math.min(PREVIEW_MAX_EDGE, Math.max(64, Math.round(width)));
  let bitmap: ImageBitmap | null = null;
  try {
    // Decoding with `resizeWidth` lets the decoder skip the full-size bitmap.
    bitmap = await createImageBitmap(blob, { resizeWidth: targetWidth, resizeQuality: "medium" });
    if (bitmap.height > PREVIEW_MAX_EDGE * 8) {
      bitmap.close();
      bitmap = await createImageBitmap(blob, { resizeHeight: PREVIEW_MAX_EDGE * 8, resizeQuality: "medium" });
    }
    const encoded = await encodePreview(bitmap);
    if (!encoded) return URL.createObjectURL(blob);
    const url = URL.createObjectURL(encoded);
    memory.set(cacheKey(resourceId, targetWidth), url);
    return url;
  } catch {
    return URL.createObjectURL(blob);
  } finally {
    bitmap?.close();
  }
};

/** Returns a cached preview synchronously when one has already been built. */
export const peekImagePreview = (resourceId: string, width: number): string | null =>
  memory.get(cacheKey(resourceId, width)) ?? null;

/** Builds (or reuses) a downscaled preview blob URL for a resource image. */
export const loadImagePreview = (resourceId: string, width: number): Promise<string | null> => {
  const id = resourceId.trim();
  if (!id) return Promise.resolve(null);
  const cached = peekImagePreview(id, width);
  if (cached) return Promise.resolve(cached);
  const key = cacheKey(id, width);
  const running = inflight.get(key);
  if (running) return running;
  const task = buildPreview(id, width).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
};

/** Test/profiling helper: counts how many previews are currently cached. */
export const imagePreviewCacheSize = () => memory.size;