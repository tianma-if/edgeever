import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { detectPublishImageMimeType, isAnimatedRasterImage } from "./publish-image.ts";

test("recognizes real two-frame animation containers without decoding", () => {
  for (const [extension, mime] of [["gif", "image/gif"], ["webp", "image/webp"], ["png", "image/png"], ["avif", "image/avif"]]) {
    const bytes = new Uint8Array(readFileSync(`tests/fixtures/publish-animation/two-frames.${extension}`));
    expect(detectPublishImageMimeType(bytes)).toBe(mime);
    expect(isAnimatedRasterImage(bytes)).toBe(true);
  }
  const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=", "base64"));
  expect(isAnimatedRasterImage(png)).toBe(false);
  expect(detectPublishImageMimeType(new TextEncoder().encode('<svg/>'))).toBeNull();
  for (let size = 0; size < 24; size++) expect(() => isAnimatedRasterImage(new Uint8Array(size))).not.toThrow();
});
