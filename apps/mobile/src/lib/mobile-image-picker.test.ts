import { expect, test } from "bun:test";
import { normalizeMobileImagePickerAsset, normalizeMobileImagePickerAssets } from "./mobile-image-picker";

test("keeps every picked image in selection order and handles cancellation", () => {
  const assets = [
    { uri: "file:///first.png", fileName: "first.png" },
    { uri: "file:///second.jpg", fileName: "second.jpg" },
  ];
  expect(normalizeMobileImagePickerAssets({ canceled: false, assets }).map((asset) => asset.name))
    .toEqual(["first.png", "second.jpg"]);
  expect(normalizeMobileImagePickerAssets({ canceled: true, assets: null })).toEqual([]);
});

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
