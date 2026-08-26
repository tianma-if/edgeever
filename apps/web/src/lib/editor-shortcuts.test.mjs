import { describe, expect, test } from "bun:test";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Schema } from "@tiptap/pm/model";
import {
  applyPlainTextTab,
  getAiSlashCommandStart,
  preserveEmptyListIndentOnBackspace,
  saveAndSyncEditor,
  shouldOpenAiFromSpace,
  wrapIndentedParagraphInList,
} from "./editor-shortcuts.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    codeBlock: { content: "text*", group: "block", code: true },
    bulletList: { content: "listItem+", group: "block" },
    listItem: { content: "paragraph block*" },
    text: { group: "inline" },
  },
});

const createState = (paragraphs, from, to = from) => {
  const doc = schema.node("doc", null, paragraphs.map((text) =>
    schema.node("paragraph", null, text ? schema.text(text) : null)
  ));
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
};

const runTab = (state, shiftKey = false) => {
  let nextState = state;
  const handled = applyPlainTextTab(state, (transaction) => {
    nextState = state.apply(transaction);
  }, shiftKey);
  return { handled, state: nextState };
};

const runListBackspace = (state) => {
  let nextState = state;
  const handled = preserveEmptyListIndentOnBackspace(state, (transaction) => {
    nextState = state.apply(transaction);
  });
  return { handled, state: nextState };
};

describe("editor shortcut actions", () => {
  test("inserts a tab at the caret in a plain paragraph", () => {
    const result = runTab(createState(["hello world"], 6));

    expect(result.handled).toBe(true);
    expect(result.state.doc.textContent).toBe("hello\t world");
  });

  test("indents each selected paragraph without replacing its text", () => {
    const result = runTab(createState(["first", "second"], 2, 13));

    expect(result.handled).toBe(true);
    expect(result.state.doc.child(0).textContent).toBe("\tfirst");
    expect(result.state.doc.child(1).textContent).toBe("\tsecond");
  });

  test("Shift-Tab removes indentation and keeps focus when no indentation remains", () => {
    const indented = runTab(createState(["\thello"], 7), true);
    const unchanged = runTab(createState(["hello"], 3), true);

    expect(indented.handled).toBe(true);
    expect(indented.state.doc.textContent).toBe("hello");
    expect(unchanged.handled).toBe(true);
    expect(unchanged.state.doc.textContent).toBe("hello");
  });

  test("inserts a tab in code blocks", () => {
    const doc = schema.node("doc", null, [schema.node("codeBlock", null, schema.text("code"))]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });
    const result = runTab(state);

    expect(result.handled).toBe(true);
    expect(result.state.doc.textContent).toBe("co\tde");
  });

  test("delegates list indentation to Tiptap's list keymap", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [schema.node("paragraph", null, schema.text("item"))]),
      ]),
    ]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 4) });

    expect(applyPlainTextTab(state, () => {}, false)).toBe(false);
  });

  test("removes an empty sibling list marker while preserving nested indentation", () => {
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [schema.node("paragraph", null, schema.text("first"))]),
        schema.node("listItem", null, [schema.node("paragraph")]),
      ]),
    ]);
    const result = runListBackspace(EditorState.create({
      doc,
      selection: TextSelection.create(doc, 12),
    }));

    expect(result.handled).toBe(true);
    expect(result.state.doc.toJSON()).toEqual({
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "first" }] },
            { type: "paragraph" },
          ],
        }],
      }],
    });
    expect(result.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(result.state.selection.$from.parent.content.size).toBe(0);

    let nestedListState = result.state;
    expect(wrapIndentedParagraphInList(result.state, undefined, "bulletList")).toBe(true);
    expect(wrapIndentedParagraphInList(result.state, (transaction) => {
      nestedListState = result.state.apply(transaction);
    }, "bulletList")).toBe(true);

    expect(nestedListState.doc.toJSON()).toEqual({
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "first" }] },
            {
              type: "bulletList",
              content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
            },
          ],
        }],
      }],
    });
  });

  test("keeps the default Backspace behavior outside a removable sibling list item", () => {
    const firstItemOnly = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [schema.node("paragraph")]),
      ]),
    ]);
    const nonEmptySecondItem = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [schema.node("paragraph", null, schema.text("first"))]),
        schema.node("listItem", null, [schema.node("paragraph", null, schema.text("second"))]),
      ]),
    ]);

    expect(preserveEmptyListIndentOnBackspace(
      EditorState.create({ doc: firstItemOnly, selection: TextSelection.create(firstItemOnly, 3) }),
      () => {},
    )).toBe(false);
    expect(preserveEmptyListIndentOnBackspace(
      EditorState.create({ doc: nonEmptySecondItem, selection: TextSelection.create(nonEmptySecondItem, 12) }),
      () => {},
    )).toBe(false);
  });

  test("recognizes /ai only at a text boundary", () => {
    expect(getAiSlashCommandStart({ caretPosition: 2, insertedText: "i", textBefore: "/a" })).toBe(0);
    expect(getAiSlashCommandStart({ caretPosition: 8, insertedText: "I", textBefore: "hello /a" })).toBe(6);
    expect(getAiSlashCommandStart({ caretPosition: 5, insertedText: "i", textBefore: "x/a" })).toBeNull();
    expect(getAiSlashCommandStart({ caretPosition: 2, insertedText: "x", textBefore: "/a" })).toBeNull();
  });

  test("opens AI from Space only in an empty paragraph outside IME composition", () => {
    const base = {
      altKey: false,
      ctrlKey: false,
      isComposing: false,
      isEmptyParagraph: true,
      key: " ",
      keyCode: 32,
      metaKey: false,
      repeat: false,
      selectionEmpty: true,
      shiftKey: false,
    };

    expect(shouldOpenAiFromSpace(base)).toBe(true);
    expect(shouldOpenAiFromSpace({ ...base, isEmptyParagraph: false })).toBe(false);
    expect(shouldOpenAiFromSpace({ ...base, selectionEmpty: false })).toBe(false);
    expect(shouldOpenAiFromSpace({ ...base, isComposing: true })).toBe(false);
    expect(shouldOpenAiFromSpace({ ...base, keyCode: 229 })).toBe(false);
    expect(shouldOpenAiFromSpace({ ...base, ctrlKey: true })).toBe(false);
    expect(shouldOpenAiFromSpace({ ...base, key: "Enter" })).toBe(false);
  });

  test("saves dirty editor content before starting sync", async () => {
    const calls = [];

    await saveAndSyncEditor({
      hasUnsavedChanges: true,
      save: async () => calls.push("save"),
      sync: async () => calls.push("sync"),
    });

    expect(calls).toEqual(["save", "sync"]);
  });

  test("syncs existing queued changes when the editor is already clean", async () => {
    const calls = [];

    await saveAndSyncEditor({
      hasUnsavedChanges: false,
      save: async () => calls.push("save"),
      sync: async () => calls.push("sync"),
    });

    expect(calls).toEqual(["sync"]);
  });

  test("does not sync when saving the current snapshot fails", async () => {
    const calls = [];

    await expect(saveAndSyncEditor({
      hasUnsavedChanges: true,
      save: async () => {
        calls.push("save");
        throw new Error("save failed");
      },
      sync: async () => calls.push("sync"),
    })).rejects.toThrow("save failed");

    expect(calls).toEqual(["save"]);
  });
});
