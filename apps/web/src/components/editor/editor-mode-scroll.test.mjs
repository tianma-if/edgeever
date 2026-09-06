import { describe, expect, test } from "bun:test";
import {
  getEditorScrollProgress,
  restoreEditorScrollProgress,
} from "./editor-mode-scroll.ts";

describe("editor mode scroll anchoring", () => {
  test("transfers relative position between differently sized editors", () => {
    const richEditor = { clientHeight: 600, scrollHeight: 3000, scrollTop: 1200 };
    const markdownEditor = { clientHeight: 700, scrollHeight: 4700, scrollTop: 0 };

    const progress = getEditorScrollProgress(richEditor);
    expect(progress).toBe(0.5);
    expect(restoreEditorScrollProgress(markdownEditor, progress)).toBe(true);
    expect(markdownEditor.scrollTop).toBe(2000);
  });

  test("clamps stale positions and tolerates missing scroll elements", () => {
    const editor = { clientHeight: 500, scrollHeight: 1500, scrollTop: 0 };

    expect(getEditorScrollProgress(null)).toBe(0);
    expect(restoreEditorScrollProgress(null, 0.5)).toBe(false);
    restoreEditorScrollProgress(editor, 2);
    expect(editor.scrollTop).toBe(1000);
    restoreEditorScrollProgress(editor, -1);
    expect(editor.scrollTop).toBe(0);
  });
});
