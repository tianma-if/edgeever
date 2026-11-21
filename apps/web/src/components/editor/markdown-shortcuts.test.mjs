import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import { createEdgeEverDocumentExtensions, docToMarkdown } from "@edgeever/shared";
import { createEdgeEverMathematics } from "@edgeever/shared/mathematics";
import { ensureTestWindowDom } from "../../lib/restore-test-global.mjs";

const createEditor = (content = { type: "doc", content: [{ type: "paragraph" }] }) => {
  ensureTestWindowDom();
  const editor = new Editor({
    extensions: createEdgeEverDocumentExtensions({
      mathematics: createEdgeEverMathematics(),
    }),
    content,
  });
  editor.view.updateState(editor.state.reconfigure({
    plugins: editor.extensionManager.plugins,
  }));
  return editor;
};

const typeText = (editor, text) => {
  // Headless Bun never mounts an EditorView, so call the input-rule plugins
  // with the same state and dispatch the real view proxy already exposes.
  const plugins = editor.extensionManager.plugins;
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const view = {
      composing: false,
      state: editor.state,
      dispatch: (transaction) => editor.view.dispatch(transaction),
    };
    let handled = false;
    for (const plugin of plugins) {
      const handleTextInput = plugin.props?.handleTextInput;
      if (handleTextInput?.call(plugin, view, from, to, char)) {
        handled = true;
        break;
      }
    }
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
};

const pastePlainText = (editor, text) => {
  const { schema } = editor;
  const nodes = text.split("\n").map((line) => (
    line ? schema.nodes.paragraph.create(null, schema.text(line)) : schema.nodes.paragraph.create()
  ));
  editor.view.dispatch(
    editor.state.tr
      .replaceWith(0, editor.state.doc.content.size, nodes)
      .setMeta("uiEvent", "paste"),
  );
};

const paragraphText = (node) => node.content?.filter((child) => child.type === "text").map((child) => child.text).join("") ?? "";

describe("checklist typing", () => {
  test("turns - [ ] into an empty task and keeps the following words in that task", () => {
    const editor = createEditor();
    typeText(editor, "- [ ] buy milk");

    expect(editor.getJSON().content[0]).toEqual({
      type: "taskList",
      content: [{
        type: "taskItem",
        attrs: { checked: false },
        content: [{ type: "paragraph", content: [{ type: "text", text: "buy milk" }] }],
      }],
    });
    expect(docToMarkdown(editor.getJSON())).toContain("- [ ] buy milk");
    editor.destroy();
  });

  test("turns * [x] and + [X] into checked tasks", () => {
    const star = createEditor();
    typeText(star, "* [x] ");
    expect(star.getJSON().content[0].content[0].attrs.checked).toBe(true);

    const plus = createEditor();
    typeText(plus, "+ [X] ");
    expect(plus.getJSON().content[0].content[0].attrs.checked).toBe(true);
    star.destroy();
    plus.destroy();
  });

  test("splits only the marked bullet out of a list and keeps the surrounding items", () => {
    const editor = createEditor({
      type: "doc",
      content: [{
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
          { type: "listItem", content: [{ type: "paragraph" }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }] },
        ],
      }],
    });
    let cursor = null;
    editor.state.doc.descendants((node, pos) => {
      if (cursor !== null) return false;
      if (node.type.name === "paragraph" && node.content.size === 0) {
        cursor = pos + 1;
        return false;
      }
    });
    editor.commands.setTextSelection(cursor);
    typeText(editor, "[ ] ");

    expect(editor.getJSON().content.map((node) => node.type)).toEqual(["bulletList", "taskList", "bulletList", "paragraph"]);
    expect(paragraphText(editor.getJSON().content[0].content[0].content[0])).toBe("a");
    expect(editor.getJSON().content[1].content[0].attrs.checked).toBe(false);
    expect(paragraphText(editor.getJSON().content[2].content[0].content[0])).toBe("c");
    editor.destroy();
  });

  test("converts a bullet that already has text when the marker is typed at its start", () => {
    const editor = createEditor({
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "beta" }] }],
        }],
      }],
    });
    let cursor = null;
    editor.state.doc.descendants((node, pos) => {
      if (cursor !== null) return false;
      if (node.type.name === "paragraph") {
        cursor = pos + 1;
        return false;
      }
    });
    editor.commands.setTextSelection(cursor);
    typeText(editor, "[ ] ");

    expect(editor.getJSON().content[0].type).toBe("taskList");
    expect(paragraphText(editor.getJSON().content[0].content[0].content[0])).toBe("beta");
    editor.destroy();
  });

  test("still turns a plain [ ] into a task and leaves ordered lists unchanged", () => {
    const plain = createEditor();
    typeText(plain, "[ ] ");
    expect(plain.getJSON().content[0].type).toBe("taskList");

    const ordered = createEditor();
    typeText(ordered, "1. [ ] ");
    expect(ordered.getJSON().content[0].type).toBe("orderedList");
    expect(paragraphText(ordered.getJSON().content[0].content[0].content[0])).toBe("[ ] ");
    plain.destroy();
    ordered.destroy();
  });

  test("joins the converted item with a task list on either side", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [{
            type: "taskItem",
            attrs: { checked: false },
            content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
          }],
        },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        },
        {
          type: "taskList",
          content: [{
            type: "taskItem",
            attrs: { checked: true },
            content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }],
          }],
        },
      ],
    });
    let cursor = null;
    editor.state.doc.descendants((node, pos) => {
      if (cursor !== null) return false;
      if (node.type.name === "paragraph" && node.content.size === 0) {
        cursor = pos + 1;
        return false;
      }
    });
    editor.commands.setTextSelection(cursor);
    typeText(editor, "[x] ");

    const taskList = editor.getJSON().content[0];
    expect(taskList.type).toBe("taskList");
    expect(taskList.content.map((item) => item.attrs.checked)).toEqual([false, true, true]);
    expect(taskList.content.map((item) => paragraphText(item.content[0]))).toEqual(["a", "", "c"]);
    editor.destroy();
  });

  test("undoes the checklist conversion", () => {
    const editor = createEditor();
    typeText(editor, "- [ ] ");
    expect(editor.getJSON().content[0].type).toBe("taskList");
    expect(editor.commands.undo()).toBe(true);
    expect(docToMarkdown(editor.getJSON())).not.toContain("- [ ]");
    editor.destroy();
  });
});

const placeCaretBetweenLastBacktickPair = (editor) => {
  const text = editor.state.doc.textContent;
  const index = text.lastIndexOf("``");
  // A single paragraph or code block starts its text at position 1.
  editor.commands.setTextSelection(index + 2);
};

describe("inline code typing", () => {
  test("renders text typed between an existing pair of backticks as inline code", () => {
    const editor = createEditor();
    typeText(editor, "``");
    placeCaretBetweenLastBacktickPair(editor);
    typeText(editor, "你好");

    expect(editor.getJSON().content[0].content).toEqual([
      { type: "text", text: "你好", marks: [{ type: "code" }] },
    ]);
    expect(docToMarkdown(editor.getJSON())).toBe("`你好`");
    editor.destroy();
  });

  test("keeps later letters inside the same code span and leaves the following space outside", () => {
    const editor = createEditor();
    typeText(editor, "see ``");
    placeCaretBetweenLastBacktickPair(editor);
    typeText(editor, "file.txt next");

    expect(editor.getJSON().content[0].content).toEqual([
      { type: "text", text: "see " },
      { type: "text", text: "file.txt", marks: [{ type: "code" }] },
      { type: "text", text: " next" },
    ]);
    editor.destroy();
  });

  test("still renders inline code when the closing backtick is typed last", () => {
    const editor = createEditor();
    typeText(editor, "`你好` ");

    expect(editor.getJSON().content[0].content).toEqual([
      { type: "text", text: "你好", marks: [{ type: "code" }] },
      { type: "text", text: " " },
    ]);
    editor.destroy();
  });

  test("undoes the character typed between backticks and restores the pair", () => {
    const editor = createEditor();
    typeText(editor, "``");
    placeCaretBetweenLastBacktickPair(editor);
    typeText(editor, "你");
    expect(editor.getText()).toBe("你");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("``");
    editor.destroy();
  });

  test("does not turn a double-backtick span or code-block text into an inline code mark", () => {
    const doubled = createEditor();
    typeText(doubled, "````");
    // Two backticks on each side: ``|``
    doubled.commands.setTextSelection(3);
    typeText(doubled, "code");
    expect(doubled.getText()).toBe("``code``");
    expect(doubled.getJSON().content[0].content.some((child) => child.marks?.some((mark) => mark.type === "code"))).toBe(false);
    doubled.destroy();

    const block = createEditor({
      type: "doc",
      content: [{ type: "codeBlock", content: [{ type: "text", text: "``" }] }],
    });
    placeCaretBetweenLastBacktickPair(block);
    typeText(block, "x");
    expect(block.getJSON().content[0]).toMatchObject({
      type: "codeBlock",
      content: [{ type: "text", text: "`x`" }],
    });
    block.destroy();
  });
});

describe("formula typing and pasting", () => {
  test("turns $latex$ into inline math and leaves currency as text", () => {
    const editor = createEditor();
    typeText(editor, "Euler $e=mc^2$ and $100$.");

    const content = editor.getJSON().content[0].content;
    expect(content).toEqual([
      { type: "text", text: "Euler " },
      { type: "inlineMath", attrs: { latex: "e=mc^2" } },
      { type: "text", text: " and $100$." },
    ]);
    expect(docToMarkdown(editor.getJSON())).toBe("Euler $e=mc^2$ and \\$100\\$.");
    editor.destroy();
  });

  test("turns a paragraph of $$latex$$ into display math and ignores $$ inside a sentence", () => {
    const block = createEditor();
    typeText(block, "$$c+d$$next");
    expect(block.getJSON().content[0]).toMatchObject({
      type: "blockMath",
      attrs: { latex: "c+d" },
    });
    expect(block.getJSON().content[1]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "next" }],
    });

    const inline = createEditor();
    typeText(inline, "hello $$x$$");
    expect(inline.getJSON().content[0].content).toEqual([{ type: "text", text: "hello $$x$$" }]);
    block.destroy();
    inline.destroy();
  });

  test("does not convert dollars typed in a code block", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "codeBlock", content: [{ type: "text", text: "before " }] }],
    });
    let cursor = null;
    editor.state.doc.descendants((node, pos) => {
      if (cursor !== null) return false;
      if (node.isText) {
        cursor = pos + node.text.length;
        return false;
      }
    });
    editor.commands.setTextSelection(cursor);
    typeText(editor, "$x$");
    expect(editor.getJSON().content[0].type).toBe("codeBlock");
    expect(editor.getJSON().content[0].content[0].text).toBe("before $x$");
    editor.destroy();
  });

  test("converts only math delimiters when plain text is pasted", () => {
    const editor = createEditor();
    pastePlainText(editor, [
      "See $a+b$ and $100$.",
      "$$c+d$$",
      "- not a list",
      "# not a heading",
    ].join("\n"));

    const content = editor.getJSON().content;
    expect(content[0].content).toEqual([
      { type: "text", text: "See " },
      { type: "inlineMath", attrs: { latex: "a+b" } },
      { type: "text", text: " and $100$." },
    ]);
    expect(content[1]).toMatchObject({ type: "blockMath", attrs: { latex: "c+d" } });
    expect(content[2]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "- not a list" }],
    });
    expect(content[3]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "# not a heading" }],
    });
    editor.destroy();
  });

  test("leaves the caret after a pasted display formula", () => {
    const editor = createEditor();
    pastePlainText(editor, "$$c+d$$");
    expect(editor.getJSON().content[0]).toMatchObject({
      type: "blockMath",
      attrs: { latex: "c+d" },
    });
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    typeText(editor, "next");
    expect(editor.getJSON().content[0].type).toBe("blockMath");
    expect(editor.getJSON().content[1].content).toEqual([{ type: "text", text: "next" }]);
    editor.destroy();
  });

  test("leaves dollars inside a pasted code block as text", () => {
    const editor = createEditor();
    const { schema } = editor;
    const nodes = [
      schema.nodes.paragraph.create(null, schema.text("See $a$")),
      schema.nodes.codeBlock.create(null, schema.text("const value = $a$;")),
    ];
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, nodes)
        .setMeta("uiEvent", "paste"),
    );

    const content = editor.getJSON().content;
    expect(content[0].content[1]).toMatchObject({ type: "inlineMath", attrs: { latex: "a" } });
    expect(content[1]).toMatchObject({
      type: "codeBlock",
      content: [{ type: "text", text: "const value = $a$;" }],
    });
    editor.destroy();
  });
});
