import { describe, expect, test } from "bun:test";
import { docToMarkdown, markdownToDoc, docToText } from "./content.ts";
import { normalizeTextColor, TEXT_COLORS } from "./text-colors.ts";
import { prepareNativeEditorContent, restoreNativeEditorContent } from "./mobile-content-compatibility.ts";

describe("inline text and highlight colors", () => {
  test("round-trips every palette color in the server codec without a DOM", () => {
    expect(typeof window).toBe("undefined");
    for (const color of TEXT_COLORS) {
      const markdown = `Before <span style="color: ${color.text}; background-color: ${color.background}">**bold** and [a link](https://example.com)</span> after.`;
      const doc = markdownToDoc(markdown);
      expect(docToMarkdown(doc)).toBe(markdown);
      expect(docToText(doc)).toBe("Before bold and a link after.");
      expect(doc.content[0].content[1].marks).toContainEqual({ type: "textStyle", attrs: { color: color.text, backgroundColor: color.background } });
      expect(doc.content[0].content[1].marks).toContainEqual({ type: "bold" });
    }
  });

  test("preserves independent colors, adjacent color boundaries, and normal Markdown", () => {
    const markdown = '# Heading\n\n<span style="color: #337ea9">Blue</span><span style="background-color: #fbf3db">yellow</span> plain\n\n- <span style="color: #c94343">red *list*</span>\n\n`<span style="color: #c94343">literal</span>`';
    expect(docToMarkdown(markdownToDoc(markdown))).toBe(markdown);
  });

  test("normalizes browser RGB values and rejects CSS injection", () => {
    expect(normalizeTextColor("rgb(51, 126, 169)")).toBe("#337ea9");
    expect(normalizeTextColor("#aBc")).toBe("#aabbcc");
    for (const value of ["red; position:fixed", 'red" onclick="alert(1)', "url(https://example.com)", "rgb(300, 0, 0)"]) {
      expect(normalizeTextColor(value)).toBeNull();
      const markdown = docToMarkdown({ type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "Safe", marks: [{ type: "textStyle", attrs: { color: value } }] },
      ] }] });
      expect(markdown).toBe("Safe");
    }
  });

  test("nested spans merge color properties without losing the inner highlight", () => {
    const doc = markdownToDoc('<span style="color: #337ea9">outer <span style="background-color: #fbf3db">inner</span> after</span>');
    expect(doc.content[0].content[1].marks).toEqual([
      { type: "textStyle", attrs: { color: "#337ea9", backgroundColor: "#fbf3db" } },
    ]);
    expect(docToMarkdown(doc)).toBe('<span style="color: #337ea9">outer</span> <span style="color: #337ea9; background-color: #fbf3db">inner</span> <span style="color: #337ea9">after</span>');
  });

  test("plain documents keep their existing serialization", () => {
    const markdown = "# Plain\n\nText **bold** *italic* ~~strike~~ [link](https://example.com).\n\n> Quote";
    expect(docToMarkdown(markdownToDoc(markdown))).toBe(markdown);
  });

  test("the native compatibility layer retains color marks", () => {
    const doc = markdownToDoc('<span style="color: #337ea9; background-color: #fbf3db">Colored text</span>');
    expect(prepareNativeEditorContent(doc)).toEqual(doc);
    expect(restoreNativeEditorContent(prepareNativeEditorContent(doc))).toEqual(doc);
  });
});
