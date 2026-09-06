import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const webEditorSource = readSource("../apps/web/src/components/EditorPane.tsx");
const webMemoListSource = readSource("../apps/web/src/components/MemoListPane.tsx");
const webCopyNoticeSource = readSource("../apps/web/src/components/ClipboardCopyNotice.tsx");
const androidDetailSource = readSource("../apps/mobile/src/screens/WorkspaceMemoDetail.tsx");
const iosDetailSource = readSource("../apps/ios/EdgeEver/Features/Workspace/MemoDetailView.swift");

describe("copy current note ID", () => {
  test("copies the raw memo ID from the desktop and web note menu", () => {
    expect(webEditorSource).toContain("copyTextToClipboard(memo.id)");
    expect(webEditorSource).toContain('"editor.copyNoteId"');
  });

  test("renders copy feedback at the page root so panes cannot clip it", () => {
    expect(webMemoListSource).toContain("<ClipboardCopyNotice");
    expect(webEditorSource).toContain("<ClipboardCopyNotice");
    expect(webCopyNoticeSource).toContain("createPortal(");
    expect(webCopyNoticeSource).toContain("document.body");
  });

  test("copies the raw memo ID from both native mobile clients", () => {
    expect(androidDetailSource).toContain("Clipboard.setStringAsync(memo.id)");
    expect(androidDetailSource).toContain('resolvedLocale === "en-US" ? "Copy note ID" : "复制笔记 ID"');
    expect(androidDetailSource).toContain("disabled={!canCopyMemoId}");
    expect(iosDetailSource).toContain("UIPasteboard.general.string = memo.id");
    expect(iosDetailSource).toContain('env.preferences.t("复制笔记 ID", en: "Copy note ID")');
  });

  test("does not present temporary local IDs as agent-readable IDs", () => {
    expect(webEditorSource).toContain("disabled={isLocalMemoId(memo.id)}");
    expect(androidDetailSource).toContain('!memo.id.startsWith("local:")');
    expect(iosDetailSource).toContain('id.hasPrefix("local:") || id.hasPrefix("local_")');
  });
});
