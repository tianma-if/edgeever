import { expect, test } from "bun:test";
import { resolveResourceUploadMimeType } from "./resource-media.ts";

test("recognizes SVG picker fallbacks while respecting an explicit non-image MIME", () => {
  for (const type of [null, "", "application/octet-stream", "IMAGE/SVG+XML; charset=utf-8"]) {
    expect(resolveResourceUploadMimeType("diagram.SVG", type)).toBe("image/svg+xml");
  }
  expect(resolveResourceUploadMimeType("document.svg", "text/html")).toBe("text/html");
  expect(resolveResourceUploadMimeType("archive.bin", "")).toBe("application/octet-stream");
});
