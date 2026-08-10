import { expect, test } from "bun:test";
import { normalizeMobileImagePickerAsset } from "./mobile-image-picker";

test("normalizes an image-picker asset for the existing upload pipeline", () => {
  expect(normalizeMobileImagePickerAsset({
    fileName: "IMG_207.PNG",
    mimeType: "image/png",
    uri: "file:///cache/IMG_207.PNG",
  })).toEqual({
    uri: "file:///cache/IMG_207.PNG",
    name: "IMG_207.PNG",
    mimeType: "image/png",
  });
});

test("creates a stable JPEG filename when the camera omits metadata", () => {
  expect(normalizeMobileImagePickerAsset(
    { uri: "file:///cache/camera-result" },
    Date.parse("2026-08-10T08:09:10.123Z")
  )).toEqual({
    uri: "file:///cache/camera-result",
    name: "photo-20260810T080910Z.jpg",
    mimeType: "image/jpeg",
  });
});

test("infers the MIME type from the filename when needed", () => {
  expect(normalizeMobileImagePickerAsset({
    fileName: "picked-image.webp",
    uri: "file:///cache/picked-image.webp",
  })).toEqual({
    uri: "file:///cache/picked-image.webp",
    name: "picked-image.webp",
    mimeType: "image/webp",
  });
});
