import { describe, expect, test } from "bun:test";
import { findMarkdownImagePasteMatches } from "./markdown-image-paste.ts";

describe("findMarkdownImagePasteMatches", () => {
  test("maps a pasted Markdown image to Tiptap node attributes", () => {
    const markdown = "![图片](https://example.com/image.webp \"预览图\")";

    expect(findMarkdownImagePasteMatches(markdown, markdown)).toEqual([{
      index: 0,
      text: markdown,
      data: {
        src: "https://example.com/image.webp",
        alt: "图片",
        title: "预览图",
      },
    }]);
  });

  test("finds each image when pasted as separate lines", () => {
    const first = "![first](https://example.com/first.png)";
    const second = "![second](https://example.com/second.png)";
    const clipboard = `${first}\n${second}`;

    expect(findMarkdownImagePasteMatches(first, clipboard)).toHaveLength(1);
    expect(findMarkdownImagePasteMatches(second, clipboard)).toEqual([{
      index: 0,
      text: second,
      data: {
        src: "https://example.com/second.png",
        alt: "second",
        title: null,
      },
    }]);
  });

  test("does not match mixed text or unsafe image sources", () => {
    expect(findMarkdownImagePasteMatches(
      "Before ![image](https://example.com/image.png)",
      "Before ![image](https://example.com/image.png)",
    )).toEqual([]);
    expect(findMarkdownImagePasteMatches(
      "![image](javascript:alert(1))",
      "![image](javascript:alert(1))",
    )).toEqual([]);
  });
});
