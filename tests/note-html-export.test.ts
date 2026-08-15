import { describe, expect, test } from "bun:test";
import {
  buildHtmlFilename,
  buildStandaloneHtmlDocument,
  createEmptyHtmlImageEmbedResult,
  createHtmlFile,
  escapeHtml,
  getHtmlImageEmbedNoticeKind,
} from "../apps/web/src/lib/note-html-export";

describe("single-note HTML export", () => {
  test("creates a UTF-8 HTML file with the current content", async () => {
    const file = createHtmlFile(
      "<!DOCTYPE html><html><body><p>当前未保存内容</p></body></html>",
      "项目 / 计划",
      "Untitled note",
    );

    expect(file.filename).toBe("项目 - 计划.html");
    expect(file.blob.type).toBe("text/html;charset=utf-8");
    expect(await file.blob.text()).toContain("当前未保存内容");
  });

  test("sanitizes unsafe and reserved filenames", () => {
    expect(buildHtmlFilename("CON", "Untitled note")).toBe("_CON.html");
    expect(buildHtmlFilename('<>:"/\\|?*', "Untitled note")).toBe("---------.html");
    expect(buildHtmlFilename("...", "Untitled note")).toBe("Untitled note.html");
    expect(buildHtmlFilename("README.html", "Untitled note")).toBe("README.html");
    expect(buildHtmlFilename("notes.htm", "Untitled note")).toBe("notes.html");
  });

  test("escapes HTML special characters", () => {
    expect(escapeHtml(`<script>alert("x")</script>&'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;",
    );
  });

  test("builds a standalone HTML document with metadata and styles", () => {
    const html = buildStandaloneHtmlDocument({
      title: 'Release <notes> & "docs"',
      notebook: "Product",
      tags: ["ship", "html"],
      updatedAt: "2026-08-11 12:00",
      language: "zh-CN",
      bodyHtml: "<p>Hello <strong>world</strong></p>",
      styles: "body { color: #111; }",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain("<title>Release &lt;notes&gt; &amp; &quot;docs&quot;</title>");
    expect(html).toContain('<h1 class="edgeever-html-title">Release &lt;notes&gt; &amp; &quot;docs&quot;</h1>');
    expect(html).toContain("Product · 2026-08-11 12:00 · #ship · #html");
    expect(html).toContain("<p>Hello <strong>world</strong></p>");
    expect(html).toContain("body { color: #111; }");
    expect(html).toContain('meta name="generator" content="EdgeEver"');
  });

  test("omits empty metadata row", () => {
    const html = buildStandaloneHtmlDocument({
      title: "Untitled",
      bodyHtml: "<p>body</p>",
    });

    expect(html).not.toContain("edgeever-html-meta");
    expect(html).toContain("<p>body</p>");
  });

  test("only warns about image embedding when some or all images fail", () => {
    expect(getHtmlImageEmbedNoticeKind(createEmptyHtmlImageEmbedResult())).toBe("none");
    expect(getHtmlImageEmbedNoticeKind({ total: 3, embedded: 3, failed: 0 })).toBe("none");
    expect(getHtmlImageEmbedNoticeKind({ total: 3, embedded: 2, failed: 1 })).toBe("partial");
    expect(getHtmlImageEmbedNoticeKind({ total: 2, embedded: 0, failed: 2 })).toBe("failed-all");
  });
});
