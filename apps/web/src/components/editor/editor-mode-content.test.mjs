import { describe, expect, test } from "bun:test";
import { docToMarkdown } from "@edgeever/shared";
import {
  createMarkdownModeSnapshot,
  isMarkdownSourceUnchanged,
  resolveMarkdownModeContent,
} from "./editor-mode-content.ts";

const tableTaskListDocument = {
  type: "doc",
  content: [{
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [{
          type: "tableHeader",
          content: [{ type: "paragraph", content: [{ type: "text", text: "事项" }] }],
        }],
      },
      {
        type: "tableRow",
        content: [{
          type: "tableCell",
          content: [{
            type: "taskList",
            content: [{
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "待办" }] }],
            }],
          }],
        }],
      },
    ],
  }],
};

describe("Markdown editor mode content preservation", () => {
  test("preserves rich-only table task lists when source was only viewed", () => {
    const snapshot = createMarkdownModeSnapshot("memo-1", tableTaskListDocument);
    const restored = resolveMarkdownModeContent(snapshot, "memo-1", snapshot.markdownSource);

    expect(isMarkdownSourceUnchanged(snapshot, "memo-1", snapshot.markdownSource)).toBe(true);
    expect(restored).toEqual(tableTaskListDocument);
    expect(restored.content[0].content[1].content[0].content[0].type).toBe("taskList");
  });

  test("treats equivalent line endings as an unchanged source projection", () => {
    const snapshot = createMarkdownModeSnapshot("memo-1", tableTaskListDocument);
    const windowsSource = snapshot.markdownSource.replaceAll("\n", "\r\n");

    expect(isMarkdownSourceUnchanged(snapshot, "memo-1", windowsSource)).toBe(true);
    expect(resolveMarkdownModeContent(snapshot, "memo-1", windowsSource)).toEqual(tableTaskListDocument);
  });

  test("preserves a rich table cell when content outside the table changes", () => {
    const snapshot = createMarkdownModeSnapshot("memo-1", tableTaskListDocument);
    const changedSource = `${snapshot.markdownSource}\n\n新增段落`;
    const resolved = resolveMarkdownModeContent(snapshot, "memo-1", changedSource);

    expect(isMarkdownSourceUnchanged(snapshot, "memo-1", changedSource)).toBe(false);
    expect(resolved.content[0].content[1].content[0].content[0].type).toBe("taskList");
    expect(docToMarkdown(resolved)).toContain("新增段落");
  });

  test("parses a rich table cell only when that cell was actually edited", () => {
    const snapshot = createMarkdownModeSnapshot("memo-1", tableTaskListDocument);
    const changedSource = snapshot.markdownSource.replace("待办", "待办 updated");
    const resolved = resolveMarkdownModeContent(snapshot, "memo-1", changedSource);

    expect(docToMarkdown(resolved)).toContain("updated");
    expect(resolved.content[0].content[1].content[0].content[0].type).toBe("paragraph");
  });

  test("never reuses a snapshot belonging to another memo", () => {
    const snapshot = createMarkdownModeSnapshot("memo-1", tableTaskListDocument);
    const resolved = resolveMarkdownModeContent(snapshot, "memo-2", snapshot.markdownSource);

    expect(isMarkdownSourceUnchanged(snapshot, "memo-2", snapshot.markdownSource)).toBe(false);
    expect(resolved).not.toEqual(tableTaskListDocument);
  });
});
