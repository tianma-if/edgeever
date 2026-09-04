const COMPRESSIBLE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);
const COMPRESSED_IMAGE_TYPE = "image/webp";
const COMPRESSED_IMAGE_EXTENSION = ".webp";
const MAX_COMPRESSED_IMAGE_EDGE = 2560;
const IMAGE_COMPRESSION_QUALITY = 0.82;

export type ImageCompressionResult = {
  file: File;
  compressed: boolean;
  originalSize: number;
  outputSize: number;
};

export const compressImageForUpload = async (file: File): Promise<ImageCompressionResult> => {
  if (!COMPRESSIBLE_IMAGE_TYPES.has(file.type)) {
    return unchanged(file);
  }

  try {
    // Decoding, resizing and WebP encoding must not compete with the editor's
    // painting/input work. Older browsers retain the original canvas fallback.
    const blob = await compressInWorker(file).catch(() => compressOnCanvas(file));

    if (!blob || blob.type !== COMPRESSED_IMAGE_TYPE || blob.size >= file.size) {
      return unchanged(file);
    }

    return {
      file: new File([blob], toCompressedFilename(file.name), {
        type: COMPRESSED_IMAGE_TYPE,
        lastModified: file.lastModified,
      }),
      compressed: true,
      originalSize: file.size,
      outputSize: blob.size,
    };
  } catch {
    return unchanged(file);
  }
};

const compressInWorker = (file: File): Promise<Blob | null> => new Promise((resolve, reject) => {
  const worker = new Worker(new URL("./image-compression.worker.ts", import.meta.url), { type: "module" });
  const finish = (blob: Blob | null, error?: Error) => {
    clearTimeout(timeout);
    worker.terminate();
    if (error) reject(error);
    else resolve(blob);
  };
  const timeout = setTimeout(() => finish(null, new Error("Image compression timed out.")), 15_000);
  worker.onmessage = (event: MessageEvent<{ blob: Blob | null; error?: string }>) => {
    finish(event.data.blob, event.data.error ? new Error(event.data.error) : undefined);
  };
  worker.onerror = () => finish(null, new Error("Image compression worker failed."));
  worker.onmessageerror = () => finish(null, new Error("Image compression response could not be read."));
  try {
    worker.postMessage({ file, maxEdge: MAX_COMPRESSED_IMAGE_EDGE, type: COMPRESSED_IMAGE_TYPE, quality: IMAGE_COMPRESSION_QUALITY });
  } catch (error) {
    finish(null, error instanceof Error ? error : new Error(String(error)));
  }
});

const compressOnCanvas = async (file: File) => {
  const image = await loadImage(file);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) return null;

  const scale = Math.min(1, MAX_COMPRESSED_IMAGE_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  try {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas, COMPRESSED_IMAGE_TYPE, IMAGE_COMPRESSION_QUALITY);
  } finally {
    canvas.width = canvas.height = 0;
  }
};

const unchanged = (file: File): ImageCompressionResult => ({
  file,
  compressed: false,
  originalSize: file.size,
  outputSize: file.size,
});

const loadImage = async (file: File) => {
  const url = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.decoding = "async";

    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image cannot be decoded."));
    });

    image.src = url;
    await loaded;

    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });

const toCompressedFilename = (filename: string) => {
  const trimmed = filename.trim();

  if (!trimmed) {
    return `image${COMPRESSED_IMAGE_EXTENSION}`;
  }

  return trimmed.replace(/\.[^.]+$/, "") + COMPRESSED_IMAGE_EXTENSION;
};
