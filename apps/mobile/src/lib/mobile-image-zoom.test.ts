import { describe, expect, test } from "bun:test";
import { clampImageTranslation, fitPreviewImage, previewResizeMultiplier, zoomImageTranslation } from "./mobile-image-zoom";

describe("fullscreen image geometry", () => {
  const viewport = { width: 400, height: 800 };
  test("long images remain fully visible initially and can fill the width after zoom", () => {
    const fitted = fitPreviewImage({ width: 1000, height: 20000 }, viewport);
    expect(fitted).toEqual({ width: 40, height: 800 });
    expect(clampImageTranslation(100, fitted.width, viewport.width, 10)).toBe(0);
    expect(clampImageTranslation(5000, fitted.height, viewport.height, 10)).toBe(3600);
  });
  test("pan cannot expose empty space past any image edge", () => {
    expect(clampImageTranslation(999, 400, 400, 3)).toBe(400);
    expect(clampImageTranslation(-999, 400, 400, 3)).toBe(-400);
    expect(clampImageTranslation(100, 200, 800, 3)).toBe(0);
    expect(clampImageTranslation(400, 400, 400, 1)).toBe(0);
  });
  test("zoom preserves the image point beneath the fingers", () => {
    const translated = zoomImageTranslation(25, 100, 2, 5);
    expect((100 - translated) / 5).toBe((100 - 25) / 2);
    expect(zoomImageTranslation(translated, 100, 5, 2)).toBe(25);
  });
  test("decode requests aim for screen-width detail and cap pixel count and longest edge", () => {
    for (const fitted of [{ width: 400, height: 800 }, { width: 40, height: 800 }, { width: 400, height: 200 }]) {
      const multiplier = previewResizeMultiplier(fitted, viewport, 3);
      expect(Math.max(fitted.width, fitted.height) * 3 * multiplier).toBeLessThanOrEqual(8192);
      expect(fitted.width * fitted.height * 9 * multiplier ** 2).toBeLessThanOrEqual(8_000_001);
      expect(multiplier).toBeGreaterThanOrEqual(1);
    }
  });
  test("unknown dimensions are safe during image loading", () => {
    expect(fitPreviewImage({ width: 0, height: 0 }, viewport)).toEqual(viewport);
    expect(previewResizeMultiplier({ width: 0, height: 0 }, viewport, 3)).toBe(1);
  });
});
