import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";
import {
  clampResourceInsertionTarget,
  clearNodeSelectionAtDocumentEnd,
  getResourceInsertionTarget,
  shouldSelectInsertedResources,
} from "./resource-insertion-target.ts";

describe("resource insertion target", () => {
  test("inserts a second pasted image after the selected first image", () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ inline: false })],
      content: {
        type: "doc",
        content: [{ type: "image", attrs: { src: "first.webp" } }],
      },
    });
    editor.commands.setNodeSelection(0);

    const target = getResourceInsertionTarget(editor.state.selection);
    editor.commands.insertContentAt(target, {
      type: "image",
      attrs: { src: "second.webp" },
    }, { updateSelection: true });

    expect(editor.getJSON().content?.map((node) => node.attrs?.src)).toEqual([
      "first.webp",
      "second.webp",
    ]);
    editor.destroy();
  });

  test("preserves a text selection as the replacement target", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "before after" }] }],
      },
    });
    editor.commands.setTextSelection({ from: 1, to: 7 });

    expect(getResourceInsertionTarget(editor.state.selection)).toEqual({ from: 1, to: 7 });
    editor.destroy();
  });

  test("clamps a saved target when the document became shorter during upload", () => {
    expect(clampResourceInsertionTarget({ from: 20, to: 30 }, 8)).toEqual({ from: 8, to: 8 });
    expect(clampResourceInsertionTarget(20, 8)).toBe(8);
  });

  test("clears a selected image when the empty editor canvas is clicked", () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ inline: false })],
      content: {
        type: "doc",
        content: [{ type: "image", attrs: { src: "selected.webp" } }],
      },
    });
    editor.commands.setNodeSelection(0);

    expect(clearNodeSelectionAtDocumentEnd(editor)).toBe(true);
    expect(editor.state.selection.constructor.name).toBe("GapCursor");
    expect(editor.getJSON().content?.map((node) => node.attrs?.src)).toEqual(["selected.webp"]);
    editor.destroy();
  });

  test("does not select an asynchronously inserted image after a newer canvas click", () => {
    expect(shouldSelectInsertedResources(4, 4)).toBe(true);
    expect(shouldSelectInsertedResources(4, 5)).toBe(false);
  });

  test("corrects a block image node selection produced by async insertion mapping", () => {
    const editor = new Editor({
      extensions: [StarterKit, Image.configure({ inline: false })],
      content: {
        type: "doc",
        content: [{ type: "image", attrs: { src: "first.webp" } }],
      },
    });
    editor.commands.setNodeSelection(0);
    clearNodeSelectionAtDocumentEnd(editor);

    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      { type: "image", attrs: { src: "second.webp" } },
      { updateSelection: false },
    );
    // The browser editor's React NodeView can map the boundary selection back
    // onto the inserted image even though the core Image extension does not.
    editor.commands.setNodeSelection(1);
    expect(editor.state.selection.constructor.name).toBe("NodeSelection");

    expect(clearNodeSelectionAtDocumentEnd(editor)).toBe(true);
    expect(editor.state.selection.constructor.name).toBe("GapCursor");
    expect(editor.getJSON().content?.map((node) => node.attrs?.src)).toEqual([
      "first.webp",
      "second.webp",
    ]);
    editor.destroy();
  });
});
