import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import { parseHTML } from "linkedom";
import { docToMarkdown, docToText, markdownToDoc } from "./content";
import { createEdgeEverDocumentExtensions } from "./document-extensions";
import { createEdgeEverMarkdownMathematics } from "./mathematics-markdown";

const imageUrl = "/api/v1/resources/image/blob";
const link = { href: "/api/v1/resources/manual/blob", title: "Document" };
const images = doc => {
  const result = [];
  const visit = node => { if (node.type === "image") result.push(node); node.content?.forEach(visit); };
  visit(doc); return result;
};
const linked = { type: "image", attrs: { src: imageUrl, alt: "thumb", title: "Preview", width: 72, link } };

describe("linked image persistence", () => {
  test("retains separate image and outer-link targets/titles through Markdown", () => {
    const source = `[![thumb](${imageUrl} "Preview")](${link.href} "Document")`;
    const doc = markdownToDoc(source);
    expect(doc.content[0].type).toBe("image");
    expect(images(doc)[0].attrs).toMatchObject(linked.attrs);
    expect(docToMarkdown(doc)).toBe(source);
  });

  test("preserves escaped outer targets and titles without changing text links", () => {
    const doc = { type: "doc", content: [{ ...linked, attrs: { ...linked.attrs, link: { href: "https://example.test/a(b)?x=&copy;", title: 'A "quoted" \\ title' } } }, { type: "paragraph", content: [{ type: "text", text: "ordinary", marks: [{ type: "link", attrs: { href: "https://example.test" } }] }] }] };
    const restored = markdownToDoc(docToMarkdown(doc));
    expect(images(restored)[0].attrs).toMatchObject(doc.content[0].attrs);
    expect(docToMarkdown(restored)).toContain("[ordinary](https://example.test)");
  });

  test("keeps image labels literal rather than interpreting them as rich text", () => {
    const alt = "图 [ ] \\ $x$ &copy;";
    const doc = { type: "doc", content: [{ type: "image", attrs: { src: imageUrl, alt } }] };
    expect(images(markdownToDoc(docToMarkdown(doc)))[0].attrs.alt).toBe(alt);
  });

  test("retains escaped unmatched brackets inside inline and reference image links", () => {
    for (const alt of ["thumb ]", "thumb [", "thumb ] \\ $x$"]) {
      const doc = { type: "doc", content: [{ ...linked, attrs: { ...linked.attrs, alt } }] };
      const markdown = docToMarkdown(doc);
      const reference = markdown.replace(`(${link.href} "Document")`, "[manual]") + `\n\n[manual]: ${link.href} "Document"`;
      for (const source of [markdown, reference]) {
        expect(images(markdownToDoc(source))[0]?.attrs).toMatchObject({ alt, src: imageUrl, link });
      }
    }
  });

  test("custom image schemas retain link metadata through JSON and HTML clipboard", () => {
    const schema = getSchema(createEdgeEverDocumentExtensions({ image: Image, mathematics: createEdgeEverMarkdownMathematics() }));
    const doc = schema.nodeFromJSON({ type: "doc", content: [linked, { type: "paragraph", content: [{ type: "text", text: "Edited text" }] }] });
    doc.check();
    const { document } = parseHTML("<html><body></body></html>");
    document.body.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document }));
    const restored = DOMParser.fromSchema(schema).parse(document.body).toJSON();
    expect(images(restored)[0].attrs.link).toEqual(link);
    expect(images(markdownToDoc(docToMarkdown(restored)))[0].attrs.link).toEqual(link);
  });

  test("gallery fitting and individual alignment retain image links", () => {
    const gallery = { type: "doc", content: [{ type: "edgeeverImageGallery", attrs: { fit: "height", layout: "2" }, content: [linked, { type: "image", attrs: { src: "/other.png", alt: "other", width: 72 } }] }] };
    const restored = markdownToDoc(docToMarkdown(gallery));
    expect(restored.content[0]).toMatchObject(gallery.content[0]);
    const aligned = { type: "doc", content: [{ ...linked, attrs: { ...linked.attrs, alignment: "right", width: 35 } }] };
    expect(images(markdownToDoc(docToMarkdown(aligned)))[0]).toMatchObject(aligned.content[0]);
  });

  test("does not activate unsafe targets in aligned HTML exports", () => {
    const unsafe = { type: "doc", content: [{ ...linked, attrs: { ...linked.attrs, alignment: "right", link: { href: "javascript:alert(1)", title: "Source" } } }] };
    const markdown = docToMarkdown(unsafe);
    expect(markdown).not.toContain('<a href="javascript:');
    expect(images(markdownToDoc(markdown))[0].attrs.link).toEqual(unsafe.content[0].attrs.link);
  });

  test("keeps linked images valid inside lists, quotes and mixed paragraphs", () => {
    const schema = getSchema(createEdgeEverDocumentExtensions({ mathematics: createEdgeEverMarkdownMathematics() }));
    const source = `[![thumb](${imageUrl})](${link.href} "Document")`;
    for (const markdown of [`- ${source}`, `3. ${source}`, `- [x] ${source}`, `> ${source}`, `Before ${source} after`]) {
      const doc = markdownToDoc(markdown);
      schema.nodeFromJSON(doc).check();
      const reopened = markdownToDoc(docToMarkdown(doc));
      schema.nodeFromJSON(reopened).check();
      expect(reopened.content[0].type).toBe(doc.content[0].type);
      expect(images(reopened)[0].attrs.link).toEqual(link);
      if (markdown.startsWith("Before")) expect(docToText(reopened)).toContain("Before");
    }
  });

  test("keeps existing image-only list JSON and nested siblings after exporting and reopening", () => {
    const schema = getSchema(createEdgeEverDocumentExtensions({ mathematics: createEdgeEverMarkdownMathematics() }));
    const paragraph = text => ({ type: "paragraph", content: [{ type: "text", text }] });
    const variants = [["bulletList", "listItem", {}], ["orderedList", "listItem", { start: 3 }], ["taskList", "taskItem", {}]];
    for (const [type, itemType, attrs] of variants) {
      const item = itemType === "taskItem" ? { type: itemType, attrs: { checked: true } } : { type: itemType };
      const doc = { type: "doc", content: [{
        type, ...(type === "orderedList" ? { attrs } : {}), content: [
          { ...item, content: [
            { type: "paragraph" }, linked, paragraph("After image"),
            { type: "bulletList", content: [{ type: "listItem", content: [paragraph("Nested")] }] },
          ] },
          { ...item, content: [paragraph("Sibling")] },
        ],
      }] };
      schema.nodeFromJSON(doc).check();
      const original = JSON.stringify(doc);
      const reopened = markdownToDoc(docToMarkdown(doc));
      schema.nodeFromJSON(reopened).check();
      expect(reopened).toMatchObject(doc);
      expect(JSON.stringify(doc)).toBe(original);
    }
  });

  test("ordinary inline HTML anchors do not start an image block", () => {
    const source = 'Hello <a href="https://example.com">site</a> tail';
    expect(markdownToDoc(source).content[0].content.map(node => node.text ?? "").join("")).toBe(source);
  });
});
