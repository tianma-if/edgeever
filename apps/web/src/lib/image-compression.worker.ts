// This module runs only in a dedicated worker; do not import editor code here.
export {};

self.onmessage = async (event: MessageEvent<{
  file: File;
  maxEdge: number;
  type: string;
  quality: number;
}>) => {
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    const { file, maxEdge, type, quality } = event.data;
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Image canvas is unavailable.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type, quality });
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ blob: null, error: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
};
