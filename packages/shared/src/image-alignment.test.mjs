import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { DOMSerializer } from "@tiptap/pm/model";
import { parseHTML } from "linkedom";
import { createEdgeEverDocumentExtensions } from "./document-extensions.ts";
import { createEdgeEverMarkdownMathematics } from "./mathematics-markdown.ts";
import { docToMarkdown, markdownToDoc, docToText } from "./content.ts";
import { alignedImageToHtml, applyImageAlignment, IMAGE_ALIGNMENTS, imageAlignmentMargins } from "./image-alignment.ts";

const image = (alignment, width = 50) => ({ type: "image", attrs: {
  src: "/api/v1/resources/example/blob?x=1&y=2", alt: 'A "quoted" <image>', title: "An image & title", width, alignment,
} });

describe("individual image alignment", () => {
  test("round-trips each alignment and width in Workers without a DOM", () => {
    expect(typeof window).toBe("undefined");
    for (const alignment of IMAGE_ALIGNMENTS) {
      const original = image(alignment, 35);
      const markdown = docToMarkdown({ type: "doc", content: [original] });
      expect(markdown).toBe(alignedImageToHtml(original));
      expect(markdownToDoc(markdown).content).toEqual([original]);
      expect(docToMarkdown(markdownToDoc(markdown))).toBe(markdown);
    }
  });

  test("legacy Markdown images keep their existing serialization and grouping", () => {
    const markdown = "![First](/one.png)\n\n![Second](/two.png)";
    const doc = markdownToDoc(markdown);
    expect(doc.content[0].type).toBe("edgeeverImageGallery");
    expect(docToMarkdown(doc)).toBe(markdown);
    expect(docToMarkdown({ type: "doc", content: [image(null)] })).not.toContain("<img");
  });

  test("adjacent aligned images stay independent after Markdown edits", () => {
    const markdown = [alignedImageToHtml(image("left")), alignedImageToHtml(image("center")), alignedImageToHtml(image("right"))].join("\n\n");
    const doc = markdownToDoc(markdown);
    expect(doc.content.map((node) => node.type)).toEqual(["image", "image", "image"]);
    expect(doc.content.map((node) => node.attrs.alignment)).toEqual(IMAGE_ALIGNMENTS);
    expect(docToMarkdown(doc)).toBe(markdown);
  });

  test("preserves alignment inside expandable details", () => {
    const markdown = `<details>\n<summary>Details</summary>\n\n${alignedImageToHtml(image("center"))}\n\n</details>`;
    const doc = markdownToDoc(markdown);
    expect(doc.content[0].content[1].content[0]).toMatchObject(image("center"));
    expect(docToMarkdown(doc)).toContain('data-image-align="center"');
    expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
  });

  test("custom image schemas retain alignment and old images default to null", () => {
    const schema = getSchema(createEdgeEverDocumentExtensions({ image: Image, mathematics: createEdgeEverMarkdownMathematics() }));
    expect(schema.nodeFromJSON(image("right")).attrs.alignment).toBe("right");
    expect(schema.nodeFromJSON({ type: "image", attrs: { src: "/old.png" } }).attrs.alignment).toBeNull();
  });

  test("native figures apply explicit alignment and can undo back to legacy layout", () => {
    const { document } = parseHTML("<figure></figure>");
    const figure = document.querySelector("figure");
    applyImageAlignment(figure, "right");
    expect(figure.dataset.imageAlign).toBe("right");
    expect(figure.style.marginLeft).toBe("auto");
    expect(figure.style.marginRight).toBe("0");
    applyImageAlignment(figure, null);
    expect(figure.dataset.imageAlign).toBeUndefined();
    expect(figure.style.marginLeft ?? "").toBe("");
    expect(imageAlignmentMargins("invalid")).toEqual({ marginLeft: "0", marginRight: "auto" });
  });

  test("plain image readers render the percentage width and alignment together", () => {
    const schema = getSchema(createEdgeEverDocumentExtensions({ image: Image, mathematics: createEdgeEverMarkdownMathematics() }));
    const { document } = parseHTML("<html></html>");
    const element = DOMSerializer.fromSchema(schema).serializeNode(schema.nodeFromJSON(image("center")), { document });
    expect(element.getAttribute("data-image-align")).toBe("center");
    expect(element.getAttribute("data-width")).toBe("50");
    expect(element.style.width).toBe("50%");
    expect(element.style.marginLeft).toBe("auto");
    expect(element.style.marginRight).toBe("auto");
  });

  test("treats fenced HTML as code and never imports executable image sources", () => {
    const html = alignedImageToHtml(image("center"));
    const code = `\`\`\`html\n${html}\n\`\`\``;
    expect(docToMarkdown(markdownToDoc(code))).toBe(code);
    const unsafe = '<img src="javascript:alert(1)" data-image-align="center" />';
    const doc = markdownToDoc(unsafe);
    expect(doc.content.some((node) => node.type === "image")).toBe(false);
    expect(docToText(doc)).toContain("javascript:");
  });
});
