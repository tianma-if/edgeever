import { describe, expect, test } from "bun:test";
import { collectMemoLinkIds, createMemoLinkHref, parseMemoLinkHref } from "./note-links.ts";
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

  test("collects unique referenced memo ids from link marks", () => {
    const doc = markdownToDoc("[项目](#memo=memo_project) 和 [项目副本](#memo=memo_project) 及 [待办](#memo=memo_todo)");

    expect(collectMemoLinkIds(doc)).toEqual(["memo_project", "memo_todo"]);
  });
});
