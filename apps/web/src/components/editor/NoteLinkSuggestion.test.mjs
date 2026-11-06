import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { ensureTestWindowDom } from "../../lib/restore-test-global.mjs";
import {
  filterNoteLinkSuggestions,
  insertSuggestedNoteLink,
  createNoteLinkSuggestionExtension,
} from "./NoteLinkSuggestion.tsx";

const labels = {
  menu: "引用笔记",
  empty: "没有找到可引用的笔记",
  close: "关闭引用笔记",
  untitled: "无标题笔记",
};

const memo = (overrides) => ({
  id: "memo-1",
  title: "项目笔记",
  excerpt: "项目摘要",
  isDeleted: false,
  ...overrides,
});

describe("note link suggestion", () => {
  const suggestionFor = (content) => {
    ensureTestWindowDom();
    const editor = new Editor({
      extensions: [StarterKit, createNoteLinkSuggestionExtension({
        getCurrentMemoId: () => null,
        getLabels: () => labels,
        searchMemos: async () => [],
      })],
      content: { type: "doc", content: [{ type: "paragraph", content }] },
    });
    try {
      const initialState = editor.state.reconfigure({ plugins: editor.extensionManager.plugins });
      const plugin = initialState.plugins.find((item) => item.key.startsWith("edgeever-note-link-suggestion$"));
      const state = initialState.apply(initialState.tr.setSelection(TextSelection.atEnd(initialState.doc)));
      return plugin.getState(state);
    } finally {
      editor.destroy();
    }
  };

  test("does not open for @ embedded in passwords, emails, or ordinary text", () => {
    for (const text of ["secret+@F(", "user@example.com", "文字@笔记", "hello@"]) {
      expect(suggestionFor([{ type: "text", text }]).active).toBe(false);
    }
  });

  test("opens at paragraph starts and after whitespace, including multiword queries", () => {
    for (const [text, query] of [["@", ""], ["@项目", "项目"], ["参考 @项目 笔记", "项目 笔记"], ["参考\t@项目", "项目"], ["参考\u3000@项目", "项目"]]) {
      const suggestion = suggestionFor([{ type: "text", text }]);
      expect(suggestion.active).toBe(true);
      expect(suggestion.query).toBe(query);
    }
  });

  test("formatting does not turn an embedded @ into a paragraph-start trigger", () => {
    expect(suggestionFor([
      { type: "text", text: "secret+" },
      { type: "text", text: "@F(", marks: [{ type: "bold" }] },
    ]).active).toBe(false);
    expect(suggestionFor([
      { type: "text", text: "参考 " },
      { type: "text", text: "@项目", marks: [{ type: "bold" }] },
    ]).active).toBe(true);
  });

  test("opens after a hard break but not immediately after inline code", () => {
    expect(suggestionFor([
      { type: "text", text: "参考" },
      { type: "hardBreak" },
      { type: "text", text: "@项目" },
    ]).active).toBe(true);
    expect(suggestionFor([
      { type: "text", text: "user", marks: [{ type: "code" }] },
      { type: "text", text: "@example.com" },
    ]).active).toBe(false);
  });

  test("excludes the current and deleted notes", () => {
    expect(filterNoteLinkSuggestions([
      memo({ id: "current" }),
      memo({ id: "deleted", isDeleted: true }),
      memo({ id: "available" }),
    ], "current").map((item) => item.id)).toEqual(["available"]);
  });

  test("replaces the @ query with the existing internal-note link format", () => {
    ensureTestWindowDom();
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "@项目" }] }],
      },
    });

    insertSuggestedNoteLink({
      editor,
      item: memo({ id: "target" }),
      labels,
      range: { from: 1, to: 4 },
    });

    expect(editor.getJSON().content[0].content).toEqual([{
      type: "text",
      marks: [{
        type: "link",
        attrs: {
          href: "#memo=target",
          target: "_blank",
          rel: "noopener noreferrer nofollow",
          class: "edgeever-note-link",
          title: null,
        },
      }],
      text: "项目笔记",
    }]);
    editor.destroy();
  });

  test("uses the untitled fallback for an empty title", () => {
    ensureTestWindowDom();
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "@" }] }],
      },
    });

    insertSuggestedNoteLink({
      editor,
      item: memo({ id: "untitled", title: "" }),
      labels,
      range: { from: 1, to: 2 },
    });

    expect(editor.getText()).toBe("无标题笔记");
    editor.destroy();
  });

  test("keeps the creation date of an untitled note out of the inserted link text", () => {
    ensureTestWindowDom();
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "@" }] }],
      },
    });

    insertSuggestedNoteLink({
      editor,
      item: memo({ id: "untitled", title: "" }),
      labels: { ...labels, displayTitle: () => "无标题笔记 · 2026年11月6日 14:32" },
      range: { from: 1, to: 2 },
    });

    expect(editor.getText()).toBe("无标题笔记");
    editor.destroy();
  });
});
