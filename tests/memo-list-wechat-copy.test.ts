import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const memoListSource = readSource("../apps/web/src/components/MemoListPane.tsx");
const workspaceSource = readSource("../apps/web/src/components/WorkspaceApp.tsx");
const editorActionsSource = readSource("../apps/web/src/components/editor/useEditorDocumentActions.ts");

describe("memo list WeChat copy", () => {
  test("adds the publish copy action to text-note card menus", () => {
    expect(memoListSource).toContain('t("editor.copyToWeChat")');
    expect(memoListSource).toContain('t("editor.copyToWeChatTooltip")');
    expect(memoListSource).toContain("<ClipboardType");
    expect(memoListSource).toContain("!memoContextMenu.memo.diagramKind && !memoContextMenu.memo.structuredTable && !memoContextMenu.memo.infographic");
    expect(memoListSource).toContain("void handleCopyContextMemoToWeChat()");
    expect(memoListSource).toContain('wechatCopyNotice === "copied" ? "editor.copiedToWeChatNotice" : "editor.copyToWeChatFailed"');
  });

  test("copies the open text note through the editor and other notes from saved markdown", () => {
    expect(workspaceSource).toContain('action: "copy-wechat"');
    expect(workspaceSource).toContain("copyMarkdownToWeChat(memo.contentMarkdown)");
    expect(workspaceSource).toContain("return \"editor\"");
    expect(editorActionsSource).toContain("copyWeChat: () => void handleCopyToWeChat()");
  });
});
