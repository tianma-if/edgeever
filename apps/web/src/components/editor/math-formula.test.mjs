import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import { createEdgeEverDocumentExtensions, createEdgeEverMarkdownManager } from "@edgeever/shared";
import { createEdgeEverMathematics } from "@edgeever/shared/mathematics";
import { ensureTestWindowDom } from "../../lib/restore-test-global.mjs";
import {
  applyMathFormula,
  deleteMathFormula,
  resolveMathFormulaTarget,
  selectedTextAsLatex,
} from "./math-formula.ts";

const createEditor = (content) => {
  ensureTestWindowDom();
  return new Editor({
    extensions: createEdgeEverDocumentExtensions({
      mathematics: createEdgeEverMathematics(),
    }),
    content,
  });
};

describe("math formula commands", () => {
  test("browser Markdown schema imports math fences as rendered formula nodes", () => {
    const manager = createEdgeEverMarkdownManager({ mathematics: createEdgeEverMathematics() });
    const content = manager.parse("```math\n\\Gamma(z) = \\int_0^\\infty t^{z-1}e^{-t}dt\\,.\n```");
    const editor = createEditor(content);
    expect(editor.getJSON().content[0].type).toBe("blockMath");
    expect(manager.parse(manager.serialize(editor.getJSON()))).toEqual(editor.getJSON());
    editor.destroy();
  });
  test("inserts inline math at the caret", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "ab" }] }],
    });
    editor.commands.setTextSelection(2);
    expect(applyMathFormula(editor, { kind: "inline", latex: "x^2" })).toBe(true);
    expect(editor.getJSON().content[0].content).toEqual([
      { type: "text", text: "a" },
      { type: "inlineMath", attrs: { latex: "x^2" } },
      { type: "text", text: "b" },
    ]);
    editor.destroy();
  });

  test("replaces the selected text with inline math", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "E=mc^2" }] }],
    });
    editor.commands.setTextSelection({ from: 1, to: 7 });
    expect(selectedTextAsLatex(editor)).toBe("E=mc^2");
    expect(applyMathFormula(editor, {
      kind: "inline",
      latex: "E=mc^2",
      from: 1,
      to: 7,
    })).toBe(true);
    expect(editor.getJSON().content[0].content).toEqual([
      { type: "inlineMath", attrs: { latex: "E=mc^2" } },
    ]);
    editor.destroy();
  });

  test("updates and deletes an existing formula", () => {
    const editor = createEditor({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "inlineMath", attrs: { latex: "a+b" } }],
      }],
    });
    editor.commands.setTextSelection(1);
    const target = resolveMathFormulaTarget(editor, 1);
    expect(target).toEqual({ kind: "inline", pos: 1, latex: "a+b" });
    expect(applyMathFormula(editor, { kind: "inline", latex: "c+d", pos: 1 })).toBe(true);
    expect(editor.getJSON().content[0].content[0].attrs.latex).toBe("c+d");
    expect(deleteMathFormula(editor, { kind: "inline", pos: 1 })).toBe(true);
    expect(editor.getJSON().content[0].content ?? []).toEqual([]);
    editor.destroy();
  });

  test("inserts a display formula as its own block", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(applyMathFormula(editor, { kind: "block", latex: "\\int x dx" })).toBe(true);
    expect(editor.getJSON().content.some((node) => node.type === "blockMath" && node.attrs.latex === "\\int x dx")).toBe(true);
    editor.destroy();
  });

  test("inserts at the stored caret even if the live selection moved to the end", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "ab" }] },
        { type: "paragraph", content: [{ type: "text", text: "cd" }] },
      ],
    });
    editor.commands.setTextSelection(2);
    editor.commands.setTextSelection(editor.state.doc.content.size);
    expect(applyMathFormula(editor, { kind: "inline", latex: "x", from: 2, to: 2 })).toBe(true);
    expect(editor.getJSON().content[0].content).toEqual([
      { type: "text", text: "a" },
      { type: "inlineMath", attrs: { latex: "x" } },
      { type: "text", text: "b" },
    ]);
    editor.destroy();
  });

  test("rejects empty latex", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(applyMathFormula(editor, { kind: "inline", latex: "  " })).toBe(false);
    editor.destroy();
  });
});
