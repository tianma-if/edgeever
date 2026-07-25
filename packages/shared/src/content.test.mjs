import { describe, expect, test } from "bun:test";
import { countMemoCharacters, docToMarkdown, markdownToDoc, resolveMemoContentDoc } from "./content.ts";

describe("memo character count", () => {
  test("counts punctuation while excluding whitespace and formatting", () => {
    const doc = markdownToDoc("你好， **EdgeEver**!\n\n下一行");

    expect(countMemoCharacters(doc)).toBe(15);
  });

  test("counts grapheme clusters and ignores image labels", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "e\u0301 👨‍👩‍👧‍👦" }] },
        { type: "image", attrs: { alt: "不计入" } },
      ],
    };

    expect(countMemoCharacters(doc)).toBe(2);
  });
});

describe("Markdown table conversion", () => {
  const markdown = [
    "| Name | Status |",
    "| --- | --- |",
    "| Editor | Ready |",
    "| Mobile | Planned |",
  ].join("\n");

  test("parses a GFM table into TipTap nodes", () => {
    const doc = markdownToDoc(markdown);

    expect(doc.content).toHaveLength(1);
    expect(doc.content[0]?.type).toBe("table");
    expect(doc.content[0]?.content?.[0]?.type).toBe("tableRow");
    expect(doc.content[0]?.content?.[0]?.content?.[0]?.type).toBe("tableHeader");
    expect(doc.content[0]?.content?.[1]?.content?.[0]?.type).toBe("tableCell");
  });

  test("preserves table values through a Markdown round trip", () => {
    const serialized = docToMarkdown(markdownToDoc(markdown));
    const reparsed = markdownToDoc(serialized);

    expect(serialized).toContain("| Name");
    expect(serialized).toContain("| Editor");
    expect(reparsed).toEqual(markdownToDoc(markdown));
  });

  test("recovers a table omitted by an older JSON schema", () => {
    const legacyDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Legacy note" }] }],
    };

    expect(resolveMemoContentDoc(legacyDoc, markdown).content[0]?.type).toBe("table");
    expect(resolveMemoContentDoc(legacyDoc, "Legacy note")).toBe(legacyDoc);
  });
});

describe("Nested list Markdown conversion", () => {
  const markdown = [
    "- Level 1",
    "  - Level 2",
    "    - Level 3",
    "  - Another level 2",
    "- Another level 1",
  ].join("\n");

  test("preserves nested list hierarchy through a Markdown round trip", () => {
    const doc = markdownToDoc(markdown);

    const topList = doc.content[0];
    const firstItem = topList?.content?.[0];
    const secondLevelList = firstItem?.content?.[1];
    const secondLevelItem = secondLevelList?.content?.[0];

    expect(topList?.type).toBe("bulletList");
    expect(topList?.content).toHaveLength(2);
    expect(firstItem?.type).toBe("listItem");
    expect(secondLevelList?.type).toBe("bulletList");
    expect(secondLevelList?.content).toHaveLength(2);
    expect(secondLevelItem?.content?.[1]?.type).toBe("bulletList");
    expect(secondLevelItem?.content?.[1]?.content).toHaveLength(1);
    expect(docToMarkdown(doc)).toBe(markdown);
  });
});

describe("Mermaid Markdown conversion", () => {
  const markdown = "```mermaid\nflowchart LR\n  A --> B\n```";

  test("preserves Mermaid fenced code blocks through a Markdown round trip", () => {
    const doc = markdownToDoc(markdown);

    expect(doc.content[0]).toMatchObject({
      type: "codeBlock",
      attrs: { language: "mermaid" },
    });
    expect(docToMarkdown(doc)).toBe(markdown);
  });
});

describe("Theme block compatibility", () => {
  test("keeps themed blocks in the richer JSON document when Markdown is also present", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "edgeeverThemeBlock",
        attrs: { kind: "key-point" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Important" }] }],
      }],
    };

    expect(resolveMemoContentDoc(doc, "Important")).toBe(doc);
  });

  test("exports themed blocks as readable quoted Markdown instead of dropping their text", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "edgeeverThemeBlock",
        attrs: { kind: "intro" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Read this first" }] }],
      }],
    };

    const markdown = docToMarkdown(doc);
    expect(markdown).toContain("\\[intro\\]");
    expect(markdown).toContain("Read this first");
  });
});
