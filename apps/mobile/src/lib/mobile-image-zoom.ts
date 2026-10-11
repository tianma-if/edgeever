export type ImageSize = { width: number; height: number };

export const fitPreviewImage = (image: ImageSize, viewport: ImageSize): ImageSize => {
  if (image.width <= 0 || image.height <= 0) return viewport;
  const ratio = Math.min(viewport.width / image.width, viewport.height / image.height);
  return { width: image.width * ratio, height: image.height * ratio };
};

export const clampImageTranslation = (value: number, imageLength: number, viewportLength: number, scale: number) => {
  "worklet";
  const limit = Math.max(0, (imageLength * scale - viewportLength) / 2);
  return Math.max(-limit, Math.min(limit, value));
};

export const zoomImageTranslation = (translation: number, focal: number, oldScale: number, newScale: number) => {
  "worklet";
  return focal - (focal - translation) * newScale / oldScale;
};

// Aim for readable screen-width detail, while limiting requested decode dimensions.
// Fresco may round sampling sizes; these are request limits, not a strict heap bound.
export const previewResizeMultiplier = (fitted: ImageSize, viewport: ImageSize, density: number) => {
  if (fitted.width <= 0 || fitted.height <= 0 || density <= 0) return 1;
  return Math.max(1, Math.min(
    viewport.width * 2 / fitted.width,
    8192 / (Math.max(fitted.width, fitted.height) * density),
    Math.sqrt(8_000_000 / (fitted.width * fitted.height * density * density)),
  ));
};
