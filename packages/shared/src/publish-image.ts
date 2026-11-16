/** Raster containers served as passive images by the publication endpoint. */
export const PUBLISH_IMAGE_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
} as const;
export type PublishImageMimeType = keyof typeof PUBLISH_IMAGE_EXTENSIONS;

export const isPublishImageMimeType = (value: string): value is PublishImageMimeType =>
  Object.hasOwn(PUBLISH_IMAGE_EXTENSIONS, value);

/** Container signatures only; browsers remain responsible for image decoding. */
export const detectPublishImageMimeType = (bytes: Uint8Array): PublishImageMimeType | null => {
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(text(0, 6))) return "image/gif";
  if (bytes.length >= 16 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(text(12, 16))) return "image/webp";
  if (bytes.length >= 16 && text(4, 8) === "ftyp") {
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    for (let offset = 8; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4) {
      if (offset !== 12 && ["avif", "avis"].includes(text(offset, offset + 4))) return "image/avif";
    }
  }
  return null;
};

/** Animation container flags, without decoding or rendering any frame. */
export const isAnimatedRasterImage = (bytes: Uint8Array) => {
  const mime = detectPublishImageMimeType(bytes);
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/gif") return true; // GIF is never sent through static compression.
  if (mime === "image/webp") return text(12, 16) === "VP8X" && bytes.length > 20 && (bytes[20] & 2) !== 0;
  if (mime === "image/png") {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const kind = text(offset + 4, offset + 8);
      if (kind === "acTL") return true;
      if (kind === "IDAT" || kind === "IEND") return false;
      offset += 12 + view.getUint32(offset);
    }
  }
  if (mime === "image/avif") {
    for (let offset = 8; offset + 4 <= Math.min(view.getUint32(0), bytes.length); offset += 4) {
      if (offset !== 12 && text(offset, offset + 4) === "avis") return true;
    }
  }
  return false;
};
