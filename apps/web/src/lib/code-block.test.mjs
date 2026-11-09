import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { codeBlockLowlight, EdgeEverCodeBlock, selectCurrentCodeBlockContent } from "./code-block.ts";

const createEditor = (source = "flowchart TD\n  A --> B") => new Editor({
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    EdgeEverCodeBlock.configure({ lowlight: codeBlockLowlight }),
  ],
  content: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      {
        type: "codeBlock",
        attrs: { language: "mermaid" },
        content: source ? [{ type: "text", text: source }] : [],
      },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ],
  },
});

const copyAtCaret = (editor, position, isCollapsed = true) => {
  const { beforecopy, copy } = editor.extensionManager.plugins
    .find((plugin) => plugin.props.handleDOMEvents?.beforecopy).props.handleDOMEvents;
  const view = {
    state: editor.state,
    editable: true,
    hasFocus: () => true,
    dom: {
      contains: () => true,
      ownerDocument: { getSelection: () => ({ anchorNode: {}, anchorOffset: 0, isCollapsed }) },
    },
    posAtDOM: () => position,
  };
  const clipboard = new Map();
  const event = {
    clipboardData: { setData: (type, value) => clipboard.set(type, value) },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };

  expect(beforecopy(view, event)).toBe(event.defaultPrevented);
  const enabled = event.defaultPrevented;
  event.defaultPrevented = false;
  expect(copy(view, event)).toBe(enabled);
  expect(event.defaultPrevented).toBe(enabled);
  return clipboard.get("text/plain");
};

describe("copy current code line", () => {
  test.each([
    [0, "first"],
    [5, "first"],
    [7, "\t indented  "],
    [20, undefined],
    [25, "last"],
  ])("returns the source line at offset %i, preserving whitespace", (offset, expected) => {
    const editor = createEditor("first\r\n\t indented  \n\nlast");
    const { from } = getCodeBlockRange(editor);
    // The DOM caret can move before the editor state observes the selection change.
    editor.commands.setTextSelection(2);

    expect(copyAtCaret(editor, from + offset)).toBe(expected);
    expect(editor.state.selection.from).toBe(2);
    editor.destroy();
  });

  test("defers to normal copy for a selection or a cursor outside the code block", () => {
    const editor = createEditor();
    const { from } = getCodeBlockRange(editor);
    editor.commands.setTextSelection({ from, to: from + 3 });
    expect(copyAtCaret(editor, from, false)).toBeUndefined();

    editor.commands.setTextSelection(2);
    expect(copyAtCaret(editor, 2)).toBeUndefined();
    editor.destroy();
  });
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
