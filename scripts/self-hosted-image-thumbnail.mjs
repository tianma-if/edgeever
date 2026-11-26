import { Image } from "imagescript";

const MAX_THUMBNAIL_INPUT_PIXELS = 40_000_000;

let sharpLoaderPromise = null;
let sharpFallbackLogged = false;

const loadSharp = async () => {
  sharpLoaderPromise ??= import("sharp")
    .then((mod) => mod.default)
    .catch((error) => {
      if (!sharpFallbackLogged) {
        sharpFallbackLogged = true;
        console.warn(
          `[self-hosted] sharp unavailable (${error instanceof Error ? error.message : String(error)}); using bundled imagescript thumbnail resizer.`,
        );
      }
      return null;
    });
  return sharpLoaderPromise;
};

export const resizeWithImageScript = async ({ bytes, width }) => {
  try {
    const image = await Image.decode(bytes, {
      applyOrientation: true,
      maxPixels: MAX_THUMBNAIL_INPUT_PIXELS,
    });
    if (image.width > width) {
      image.resize({ width, mode: "area" });
    }
    const output = await image.encodeWebP({ quality: 80, effort: 2 });
    if (!output || output.byteLength === 0) return null;
    return {
      bytes: new Uint8Array(output.buffer, output.byteOffset, output.byteLength),
      mimeType: "image/webp",
    };
  } catch {
    return null;
  }
};

/**
 * Self-hosted image thumbnail adapter.
 * Uses native `sharp` when available (local/dev with `node_modules`), and falls
 * back to bundled `imagescript` so single-file Docker/standalone builds resize
 * images cleanly without native `.node` bindings.
 */
export const createSelfHostedImageThumbnailAdapter = () => async ({ bytes, width }) => {
  const sharp = await loadSharp();
  if (sharp) {
    try {
      const output = await sharp(bytes, { failOn: "none", limitInputPixels: MAX_THUMBNAIL_INPUT_PIXELS })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
      if (output && output.byteLength > 0) {
        return {
          bytes: new Uint8Array(output.buffer, output.byteOffset, output.byteLength),
          mimeType: "image/webp",
        };
      }
    } catch {
      return null;
    }
  }
  return resizeWithImageScript({ bytes, width });
};
