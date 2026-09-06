import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EdgeEverCodeBlock, selectCurrentCodeBlockContent } from "./code-block.ts";

const createEditor = () => new Editor({
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    EdgeEverCodeBlock,
  ],
  content: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      {
        type: "codeBlock",
        attrs: { language: "mermaid" },
        content: [{ type: "text", text: "flowchart TD\n  A --> B" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ],
  },
});

const getCodeBlockRange = (editor) => {
  let range = null;
  editor.state.doc.descendants((node, pos) => {
    if (!range && node.type.name === "codeBlock") {
      range = { from: pos + 1, to: pos + 1 + node.content.size };
    }
  });
  return range;
};

describe("code block selection", () => {
  test("selects only the current code block on the first Mod-a", () => {
    const editor = createEditor();
    const range = getCodeBlockRange(editor);
    editor.commands.setTextSelection(range.from + 2);

    expect(selectCurrentCodeBlockContent(editor)).toBe(true);
    expect({
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    }).toEqual(range);
    editor.destroy();
  });

  test("allows the editor-wide Mod-a after the code block is fully selected", () => {
    const editor = createEditor();
    const range = getCodeBlockRange(editor);
    editor.commands.setTextSelection(range);

    expect(selectCurrentCodeBlockContent(editor)).toBe(false);
    editor.destroy();
  });

  test("leaves Mod-a unchanged outside code blocks", () => {
    const editor = createEditor();
    editor.commands.setTextSelection(2);

    expect(selectCurrentCodeBlockContent(editor)).toBe(false);
    editor.destroy();
  });
});
