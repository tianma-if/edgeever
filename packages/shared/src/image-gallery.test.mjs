import { describe, expect, test } from "bun:test";
import {
  groupConsecutiveImagesIntoGalleries,
  IMAGE_GALLERY_NODE_TYPE,
  normalizeImageGalleries,
  resolveImageGalleryLayout,
} from "./image-gallery.ts";

const image = (src) => ({ type: "image", attrs: { src } });

describe("image gallery", () => {
  test("normalizes supported layouts", () => {
    expect(resolveImageGalleryLayout("auto")).toBe("auto");
    expect(resolveImageGalleryLayout("1")).toBe("1");
    expect(resolveImageGalleryLayout("2")).toBe("2");
    expect(resolveImageGalleryLayout("3")).toBe("3");
    expect(resolveImageGalleryLayout("4")).toBe("auto");
  });

  test("groups adjacent images without moving other content", () => {
    const attachment = { type: "paragraph", content: [{ type: "text", text: "attachment" }] };
    expect(groupConsecutiveImagesIntoGalleries([
      image("one"),
      image("two"),
      attachment,
      image("three"),
    ])).toEqual([
      {
        type: IMAGE_GALLERY_NODE_TYPE,
        attrs: { layout: "auto" },
        content: [image("one"), image("two")],
      },
      attachment,
      image("three"),
    ]);
  });

  test("removes empty gallery images and unwraps a remaining singleton", () => {
    expect(normalizeImageGalleries({
      type: "doc",
      content: [
        {
          type: IMAGE_GALLERY_NODE_TYPE,
          attrs: { layout: "3" },
          content: [image(""), image("kept")],
        },
        {
          type: IMAGE_GALLERY_NODE_TYPE,
          attrs: { layout: "auto" },
          content: [image(null)],
        },
      ],
    })).toEqual({
      type: "doc",
      content: [image("kept")],
    });
  });

  test("preserves valid galleries without cloning the document", () => {
    const doc = {
      type: "doc",
      content: [{
        type: IMAGE_GALLERY_NODE_TYPE,
        attrs: { layout: "2" },
        content: [image("one"), image("two")],
      }],
    };
    expect(normalizeImageGalleries(doc)).toBe(doc);
  });
});
