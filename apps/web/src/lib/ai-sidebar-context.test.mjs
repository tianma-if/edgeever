import { describe, expect, test } from "bun:test";
import { sidebarCompanionFocus, sidebarLocalContextText } from "./ai-sidebar-context.ts";

const note = {
  memoId: "note-1",
  notebookId: "book-1",
  notebookTitle: "音乐",
  noteTitle: "QQ 音乐等级",
  contentMarkdown: "关于 QQ 音乐等级的长篇笔记",
};
const conversation = (message = "翻译一下当前笔记。", recentUserMessages = [], fallbackLocale = "en-US") => ({
  message, recentUserMessages, fallbackLocale,
});

describe("AI sidebar note context", () => {
  test("a request receives the open note identity without its body", () => {
    expect(sidebarCompanionFocus(note, false)).toEqual({ memoId: "note-1", title: "QQ 音乐等级" });
    const localContext = sidebarLocalContextText(note, false, conversation());
    expect(localContext).toContain("ID: note-1");
    expect(localContext).toContain("Title (data): QQ 音乐等级");
    expect(localContext).toContain("get_memo");
    expect(localContext).toContain("translate into Simplified Chinese without asking");
    expect(localContext).not.toContain(note.contentMarkdown);
  });

  test("explicitly including the current note works for both assistant modes", () => {
    expect(sidebarCompanionFocus(note, true)).toEqual({
      memoId: "note-1",
      notebookId: "book-1",
      notebookTitle: "音乐",
      title: "QQ 音乐等级",
      contentMarkdown: "关于 QQ 音乐等级的长篇笔记",
    });
    expect(sidebarLocalContextText(note, true, conversation())).toContain("关于 QQ 音乐等级的长篇笔记");
  });

  test("an explicitly pinned selection is retained without the rest of the note", () => {
    const selected = { ...note, selectionMarkdown: "  需要解释的句子  " };
    expect(sidebarCompanionFocus(selected, false)).toEqual({ memoId: "note-1", title: "QQ 音乐等级", selectionMarkdown: "需要解释的句子" });
    expect(sidebarLocalContextText(selected, false, conversation())).toContain("需要解释的句子");
    expect(sidebarLocalContextText(selected, false, conversation())).not.toContain(note.contentMarkdown);
  });

  test("switching notes sends only the newly open note identity", () => {
    const switched = { ...note, memoId: "note-2", noteTitle: "第二篇", contentMarkdown: "第二篇正文" };
    expect(sidebarCompanionFocus(switched, false)).toEqual({ memoId: "note-2", title: "第二篇" });
    expect(sidebarLocalContextText(switched, false, conversation())).toContain("ID: note-2");
    expect(sidebarLocalContextText(switched, false, conversation())).not.toContain("note-1");
  });

  test("local agents follow the request language ahead of interface language", () => {
    expect(sidebarLocalContextText(note, false, conversation("翻译一下", [], "ja"))).toContain("Simplified Chinese (current request)");
    expect(sidebarLocalContextText(note, false, conversation("このノートを翻訳して", [], "zh-CN"))).toContain("Japanese (current request)");
    expect(sidebarLocalContextText(note, false, conversation("Translate this note", [], "zh-CN"))).toContain("English (current request)");
    expect(sidebarLocalContextText(note, false, conversation("🔄", ["このノートを読んで"], "zh-CN"))).toContain("Japanese (recent conversation)");
    expect(sidebarLocalContextText(note, false, conversation("请翻译我正在看的内容，并把译文作为回复写给我。", ["このノートを読んで"], "zh-CN"))).toContain("Japanese (recent conversation)");
    expect(sidebarLocalContextText(note, false, conversation("请翻译下面这段文字：如果原文是简体中文，译成英文；否则译成简体中文。\n\nEnglish source", ["このノートを読んで"], "zh-CN"))).toContain("Japanese (recent conversation)");
    expect(sidebarLocalContextText(note, false, conversation("请翻译下面这段文字。按当前对话的语言选择目标语言。\n\nEnglish source", ["このノートを読んで"], "zh-CN"))).toContain("Japanese (recent conversation)");
    expect(sidebarLocalContextText(note, false, conversation("下の文章をこの会話の言語に翻訳してください。\n\nEnglish source", ["请读这篇笔记"], "ja"))).toContain("Simplified Chinese (recent conversation)");
    expect(sidebarLocalContextText(note, false, conversation("🔄", [], "zh-CN"))).toContain("Simplified Chinese (interface)");
    expect(sidebarLocalContextText(note, false, conversation("请翻译：これは日本語です", [], "en-US"))).toContain("Simplified Chinese (current request)");
    expect(sidebarLocalContextText(note, false, conversation("Translate: 这是中文", [], "zh-CN"))).toContain("English (current request)");
  });
});
