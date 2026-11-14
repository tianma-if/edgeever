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
    expect(names).toContain("edgeeverInlineCodeInput");
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
});
