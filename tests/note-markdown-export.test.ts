import { describe, expect, test } from "bun:test";
import { splitMarkdownFrontMatter } from "@edgeever/shared";
import {
  buildMarkdownFilename,
  buildSingleNoteMarkdown,
  createMarkdownFile,
} from "../apps/web/src/lib/note-markdown-export";

describe("single-note Markdown export", () => {
  test("creates a UTF-8 Markdown file with the current content", async () => {
    const file = createMarkdownFile("# 标题\n\n当前未保存内容", "项目 / 计划", "Untitled note");

    expect(file.filename).toBe("项目 - 计划.md");
    expect(file.blob.type).toBe("text/markdown;charset=utf-8");
    expect(await file.blob.text()).toBe("# 标题\n\n当前未保存内容");
  });

  test("sanitizes unsafe and reserved filenames", () => {
    expect(buildMarkdownFilename("CON", "Untitled note")).toBe("_CON.md");
    expect(buildMarkdownFilename('<>:"/\\|?*', "Untitled note")).toBe("---------.md");
    expect(buildMarkdownFilename("...", "Untitled note")).toBe("Untitled note.md");
    expect(buildMarkdownFilename("README.md", "Untitled note")).toBe("README.md");
  });
});

describe("single-note Markdown properties", () => {
  test("ordinary notes export only their body", async () => {
    const body = "# Article\n\nBody with **formatting**.\n";
    const markdown = buildSingleNoteMarkdown(body, "Article", ["work"]);
    expect(markdown).toBe(body);
    expect(await createMarkdownFile(markdown, "Article", "Untitled").blob.text()).toBe(body);
  });

  test("retains comments and custom properties while updating existing title and tags", () => {
    const markdown = buildSingleNoteMarkdown("---\n# Preserve this comment\ntitle: Old\ntags: [old]\nauthor: Alice\ncustom:\n  reviewed: true\n---\n\nBody", "New", ["new"]);
    const header = splitMarkdownFrontMatter(markdown)!;
    expect(header.values).toEqual({ title: "New", tags: ["new"], author: "Alice", custom: { reviewed: true } });
    expect(header.source).toContain("# Preserve this comment");
    expect(header.body.trim()).toBe("Body");
  });

  test("does not add title, tags or system fields to a custom-only header", () => {
    const markdown = "---\nsource: https://example.com\n---\n\nBody";
    expect(buildSingleNoteMarkdown(markdown, "Article", ["work"])).toBe(markdown);
  });

  test("retains original system fields without replacing or supplementing them", () => {
    const markdown = buildSingleNoteMarkdown("---\ntitle: Old\ncreated: 2020-01-01\nedgeever_id: original\n---\n\nBody", "New", ["work"]);
    expect(splitMarkdownFrontMatter(markdown)!.values).toEqual({ title: "New", created: "2020-01-01", edgeever_id: "original" });
  });

  test("invalid properties remain recoverable verbatim", () => {
    const markdown = "---\ntitle: [broken\n---\n\nBody";
    expect(buildSingleNoteMarkdown(markdown, "Article", [])).toBe(markdown);
  });
});
