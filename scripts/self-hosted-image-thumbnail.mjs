let sharpLoaderPromise = null;

const loadSharp = async () => {
  sharpLoaderPromise ??= import("sharp").then((mod) => mod.default).catch(() => null);
  return sharpLoaderPromise;
};

/**
 * Thin self-hosted image thumbnail adapter backed by sharp.
 * Falls back to `null` if sharp's native module is unavailable or decoding fails
 * so the API route serves the original image cleanly.
 */
export const createSelfHostedImageThumbnailAdapter = () => async ({ bytes, width }) => {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const output = await sharp(bytes, { failOn: "none", limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
    if (!output || output.byteLength === 0) return null;
    return {
      bytes: new Uint8Array(output.buffer, output.byteOffset, output.byteLength),
      mimeType: "image/webp",
    };
  } catch {
    return null;
  }
};
