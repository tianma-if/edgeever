import { describe, expect, test } from "bun:test";
import { createMemoLinkHref, parseMemoLinkHref } from "./note-links.ts";
import { docToMarkdown, markdownToDoc } from "./content.ts";

describe("stable memo links", () => {
  test("round trips a memo id through the internal link format", () => {
    const href = createMemoLinkHref("memo/中文 1");

    expect(href).toBe("#memo=memo%2F%E4%B8%AD%E6%96%87%201");
    expect(parseMemoLinkHref(href)).toBe("memo/中文 1");
  });

  test("rejects unrelated links", () => {
    expect(parseMemoLinkHref("https://example.com")).toBeNull();
    expect(parseMemoLinkHref("#memo=")).toBeNull();
  });

  test("preserves memo links in Markdown", () => {
    const markdown = "查看 [项目笔记](#memo=memo_project)。";
    const doc = markdownToDoc(markdown);

    expect(doc.content[0]?.content?.[1]).toMatchObject({
      type: "text",
      text: "项目笔记",
      marks: [{ type: "link", attrs: { href: "#memo=memo_project" } }],
    });
    expect(docToMarkdown(doc)).toBe(markdown);
  });
});
