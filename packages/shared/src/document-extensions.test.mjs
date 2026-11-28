import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createEdgeEverDocumentExtensions,
  docToMarkdown,
  IMAGE_GALLERY_NODE_TYPE,
  markdownToDoc,
  MERGE_DIVIDER_MARKDOWN_MARKER,
  MERGE_DIVIDER_NODE_TYPE,
} from "./index.ts";
import { createEdgeEverMarkdownMathematics } from "./mathematics-markdown.ts";

const factorySource = readFileSync(resolve(import.meta.dir, "document-extensions.ts"), "utf8");

describe("shared document extensions", () => {
  test("does not import the KaTeX mathematics entry", () => {
    expect(factorySource).not.toContain('from "./mathematics"');
    expect(factorySource).not.toContain("createEdgeEverMathematics");
  });

  test("registers the same document nodes the Markdown codec uses", () => {
    const names = createEdgeEverDocumentExtensions({
      mathematics: createEdgeEverMarkdownMathematics(),
      markdown: true,
    }).map((extension) => extension.name);

    expect(names).toContain("starterKit");
    expect(names).toContain("taskList");
    expect(names).toContain("taskItem");
    expect(names).toContain("tableKit");
    expect(names).toContain("image");
    expect(names).toContain(IMAGE_GALLERY_NODE_TYPE);
    expect(names).toContain("edgeeverPdfAttachment");
    expect(names).toContain("edgeeverFileAttachment");
    expect(names).toContain(MERGE_DIVIDER_NODE_TYPE);
    expect(names).toContain("details");
    expect(names).toContain("detailsSummary");
    expect(names).toContain("detailsContent");
    expect(names).toContain("edgeeverPluginEmbed");
    expect(names).toContain("markdown");
  });

  test("round-trips merge dividers and formulas through the codec factory", () => {
    const markdown = `alpha\n\n${MERGE_DIVIDER_MARKDOWN_MARKER}\n\n---\n\nEuler: $e^{i\\pi}+1=0$.`;
    const doc = markdownToDoc(markdown);
    expect(doc.content.map((node) => node.type)).toEqual([
      "paragraph",
      MERGE_DIVIDER_NODE_TYPE,
      "paragraph",
    ]);
    expect(doc.content[2]?.content?.some((node) => node.type === "inlineMath")).toBe(true);
    expect(docToMarkdown(doc)).toContain(MERGE_DIVIDER_MARKDOWN_MARKER);
  });

  test("keeps Leeef Reader timestamps as separate paragraphs within each quote", () => {
    const divider = `${MERGE_DIVIDER_MARKDOWN_MARKER}\n\n---`;
    const timestamps = ["摘录于 2026-11-27", "摘录于 2026-11-28"];
    const markdown = [
      divider,
      "## 书摘",
      `> 第一段\n>\n> 第二段\n>\n> ${timestamps[0]}`,
      "**批注** 保留批注",
      `> 后一条书摘\n>\n> ${timestamps[1]}`,
      "来自 Leeef Reader",
      divider,
    ].join("\n\n");
    const doc = markdownToDoc(markdown);
    expect(doc.content.filter((block) => block.type === "blockquote")
      .map((quote) => quote.content.at(-1))).toEqual(timestamps.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })));
    expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
  });

  test("keeps a bare Leeef excerpt date as its own quote paragraph", () => {
    const divider = `${MERGE_DIVIDER_MARKDOWN_MARKER}\n\n---`;
    const markdown = [
      divider,
      "## 书摘",
      "> 原文\n>\n> 2026-11-27",
      "来自 Leeef Reader",
      divider,
    ].join("\n\n");
    const doc = markdownToDoc(markdown);
    expect(doc.content.find((block) => block.type === "blockquote")?.content?.at(-1)).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "2026-11-27" }],
    });
    expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
  });
});
