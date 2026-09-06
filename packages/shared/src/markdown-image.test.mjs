import { describe, expect, test } from "bun:test";
import {
  isSupportedMarkdownImageSource,
  parseMarkdownImagePaste,
} from "./markdown-image.ts";

describe("parseMarkdownImagePaste", () => {
  test("parses the Markdown image syntax from Issue #229", () => {
    expect(parseMarkdownImagePaste(
      "![图片](https://picui.ogmua.cn/s1/2026/08/12/6a7c64323d0a8.webp)",
    )).toEqual([{
      markdown: "![图片](https://picui.ogmua.cn/s1/2026/08/12/6a7c64323d0a8.webp)",
      attributes: {
        src: "https://picui.ogmua.cn/s1/2026/08/12/6a7c64323d0a8.webp",
        alt: "图片",
        title: null,
      },
    }]);
  });

  test("preserves optional titles and parses multiple image lines", () => {
    expect(parseMarkdownImagePaste([
      "  ![First](https://example.com/first.png \"First title\")  ",
      "",
      "![Second](http://example.com/second.jpg)",
    ].join("\r\n"))).toEqual([
      {
        markdown: "![First](https://example.com/first.png \"First title\")",
        attributes: {
          src: "https://example.com/first.png",
          alt: "First",
          title: "First title",
        },
      },
      {
        markdown: "![Second](http://example.com/second.jpg)",
        attributes: {
          src: "http://example.com/second.jpg",
          alt: "Second",
          title: null,
        },
      },
    ]);
  });

  test("leaves prose, ordinary URLs, and malformed syntax unchanged", () => {
    expect(parseMarkdownImagePaste("Before ![image](https://example.com/image.png) after")).toBeNull();
    expect(parseMarkdownImagePaste("https://example.com/image.png")).toBeNull();
    expect(parseMarkdownImagePaste("![image](https://example.com/image.png)\nordinary text")).toBeNull();
    expect(parseMarkdownImagePaste("   \n")).toBeNull();
  });

  test("rejects executable, embedded, local-file, and relative sources", () => {
    for (const source of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "file:///tmp/image.png",
      "./image.png",
    ]) {
      expect(parseMarkdownImagePaste(`![unsafe](${source})`)).toBeNull();
    }
  });
});

describe("isSupportedMarkdownImageSource", () => {
  test("allows remote and EdgeEver-managed image sources", () => {
    expect(isSupportedMarkdownImageSource("https://example.com/image.png")).toBe(true);
    expect(isSupportedMarkdownImageSource("http://example.com/image.png")).toBe(true);
    expect(isSupportedMarkdownImageSource("/api/v1/resources/res_1/blob")).toBe(true);
    expect(isSupportedMarkdownImageSource("edgeever-resource://resource/res_1")).toBe(true);
    expect(isSupportedMarkdownImageSource("edgeever-staged://stage_1")).toBe(true);
  });
});
