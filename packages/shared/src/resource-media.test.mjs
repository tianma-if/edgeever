import { expect, test } from "bun:test";
import {
  RESOURCE_THUMBNAIL_DEFAULT_WIDTH,
  isResizableThumbnailMimeType,
  parseResourceThumbnailWidth,
  resolveResourceUploadMimeType,
} from "./resource-media.ts";

test("recognizes SVG picker fallbacks while respecting an explicit non-image MIME", () => {
  for (const type of [null, "", "application/octet-stream", "IMAGE/SVG+XML; charset=utf-8"]) {
    expect(resolveResourceUploadMimeType("diagram.SVG", type)).toBe("image/svg+xml");
  }
  expect(resolveResourceUploadMimeType("document.svg", "text/html")).toBe("text/html");
  expect(resolveResourceUploadMimeType("archive.bin", "")).toBe("application/octet-stream");
});

test("validates thumbnail widths, bounds, and bucket quantization", () => {
  expect(parseResourceThumbnailWidth(undefined)).toEqual({ kind: "none" });
  expect(parseResourceThumbnailWidth("400")).toEqual({ kind: "valid", width: RESOURCE_THUMBNAIL_DEFAULT_WIDTH });
  expect(parseResourceThumbnailWidth(" 64 ")).toEqual({ kind: "valid", width: 200 });
  expect(parseResourceThumbnailWidth("200")).toEqual({ kind: "valid", width: 200 });
  expect(parseResourceThumbnailWidth("401")).toEqual({ kind: "valid", width: 800 });
  expect(parseResourceThumbnailWidth("1600")).toEqual({ kind: "valid", width: 1600 });

  for (const invalid of ["", "   ", "0", "-1", "63", "1601", "99999", "400.5", "400px", "abc", "Infinity"]) {
    expect(parseResourceThumbnailWidth(invalid)).toEqual({ kind: "invalid" });
  }
});

test("identifies resizable raster image MIME types", () => {
  expect(isResizableThumbnailMimeType("image/png")).toBe(true);
  expect(isResizableThumbnailMimeType("IMAGE/JPEG; charset=utf-8")).toBe(true);
  expect(isResizableThumbnailMimeType("image/webp")).toBe(true);
  expect(isResizableThumbnailMimeType("image/avif")).toBe(true);
  expect(isResizableThumbnailMimeType("image/svg+xml")).toBe(false);
  expect(isResizableThumbnailMimeType("image/gif")).toBe(false);
  expect(isResizableThumbnailMimeType("application/pdf")).toBe(false);
  expect(isResizableThumbnailMimeType(null)).toBe(false);
});
