import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  filterNoteLinkSuggestions,
  insertSuggestedNoteLink,
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
  test("excludes the current and deleted notes", () => {
    expect(filterNoteLinkSuggestions([
      memo({ id: "current" }),
      memo({ id: "deleted", isDeleted: true }),
      memo({ id: "available" }),
    ], "current").map((item) => item.id)).toEqual(["available"]);
  });

  test("replaces the @ query with the existing internal-note link format", () => {
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
});
