import { expect, test } from "bun:test";
import {
  createMobileImageUploadPlaceholderSource,
  stripMobileImageUploadPlaceholders,
} from "./mobile-image-upload-placeholder";

test("cleans up empty or singleton galleries after removing failed upload placeholders", () => {
  const pending = { type: "image", attrs: { src: createMobileImageUploadPlaceholderSource("batch") } };
  const saved = { type: "image", attrs: { src: "/api/v1/resources/done/blob" } };
  expect(stripMobileImageUploadPlaceholders({ type: "doc", content: [
    { type: "edgeeverImageGallery", content: [pending] },
    { type: "edgeeverImageGallery", content: [pending, saved] },
  ] }).content).toEqual([saved]);
});

test("removes transient image upload placeholders before a note is persisted", () => {
  const placeholderSource = createMobileImageUploadPlaceholderSource("upload-1");
  const result = stripMobileImageUploadPlaceholders({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      { type: "image", attrs: { alt: "图片上传中…", src: placeholderSource } },
      { type: "image", attrs: { alt: "done", src: "/api/v1/resources/res_1", width: 50 } },
    ],
  });

  expect(result).toEqual({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      { type: "image", attrs: { alt: "done", src: "/api/v1/resources/res_1", width: 50 } },
    ],
  });
});

test("keeps an empty editor valid when its only node is an upload placeholder", () => {
  expect(stripMobileImageUploadPlaceholders({
    type: "doc",
    content: [{
      type: "image",
      attrs: { src: createMobileImageUploadPlaceholderSource("upload-2") },
    }],
  })).toEqual({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
});
