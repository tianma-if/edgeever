import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const TASK_ITEM_LAYOUT_SOURCES = [
  ["./globals.css", '.ProseMirror ul[data-type="taskList"] li[data-checked]'],
  ["./mobile-markdown-editor.css", '.edgeever-mobile-tiptap-content ul[data-type="taskList"] li[data-checked]'],
  ["./note-html-export.css", '.edgeever-html-content ul[data-type="taskList"] li[data-checked]'],
  ["./note-print.css", '.edgeever-print-content ul[data-type="taskList"] li[data-checked]'],
  ["../../../mobile/src/components/LocalTiptapEditor.tsx", '.edgeever-editor-content ul[data-type="taskList"] li[data-checked]'],
  ["../../../ios/EditorSource/src/styles.css", '.ProseMirror ul[data-type="taskList"] li[data-checked]'],
];

describe("task list layout contract", () => {
  test.each(TASK_ITEM_LAYOUT_SOURCES)("uses TipTap's live task-item marker in %s", (relativePath, selector) => {
    const source = readSource(relativePath);
    const selectorStart = source.indexOf(selector);

    expect(selectorStart).toBeGreaterThanOrEqual(0);
    expect(source.slice(selectorStart, selectorStart + selector.length + 160)).toMatch(/display:\s*flex/);
  });
});
