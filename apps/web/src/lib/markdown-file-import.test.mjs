import { describe, expect, test } from "bun:test";
import {
  getMarkdownFileTitle,
  isMarkdownFile,
  readMarkdownFile,
} from "./markdown-file-import.ts";

describe("Markdown file import", () => {
  test("imports title and tags from properties while keeping unknown fields in the document", async () => {
    const markdown = "---\ntitle: Imported title\ntags: [archive, '#research']\nauthor: [Alice]\n---\n\nBody";
    expect(await readMarkdownFile({ name: "file.md", text: async () => markdown })).toEqual({
      title: "Imported title", tags: ["archive", "research"], contentMarkdown: markdown,
    });
  });
  test("accepts Markdown extensions case-insensitively", () => {
    expect(isMarkdownFile({ name: "notes.md" })).toBe(true);
    expect(isMarkdownFile({ name: "notes.MARKDOWN" })).toBe(true);
    expect(isMarkdownFile({ name: "notes.txt" })).toBe(false);
  });

  test("uses the filename without its extension as the note title", () => {
    expect(getMarkdownFileTitle(" docker install - setup.md ")).toBe("docker install - setup");
    expect(getMarkdownFileTitle(`${"a".repeat(200)}.md`)).toHaveLength(160);
  });

  test("preserves Markdown content while removing a UTF-8 BOM", async () => {
    const result = await readMarkdownFile({
      name: "setup.md",
      text: async () => "\uFEFF# Setup\n\nKeep **all** Markdown.",
    });

    expect(result).toEqual({
      title: "setup",
      contentMarkdown: "# Setup\n\nKeep **all** Markdown.",
    });
  });
});
