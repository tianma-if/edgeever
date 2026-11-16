import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("memo context menu", () => {
  test("opens link sharing at workspace level without requiring a text editor", () => {
    const source = readFileSync(new URL("./WorkspaceApp.tsx", import.meta.url), "utf8");
    const handler = source.slice(source.indexOf("onRequestDocumentAction={(memoId:"), source.indexOf("onCopyMemoToWeChat={"));

    expect(handler).toMatch(/if \(action === "share"\) \{\s*setListShareMemoId\(memoId\);\s*return;/);
    expect(handler.indexOf('if (action === "share")')).toBeLessThan(handler.indexOf('setRightView("editor")'));
    expect(source).toContain("{listShareMemoId && (");
    expect(source).toContain("memoId={listShareMemoId}");
    expect(source).toContain("if (!open) setListShareMemoId(null)");
  });

  test("uses a Radix submenu for notebook moves so opening the picker does not close the menu", () => {
    const source = readFileSync(new URL("./MemoListPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("<DropdownMenuSub>");
    expect(source).toContain("<DropdownMenuSubTrigger");
    expect(source).toContain("<DropdownMenuSubContent");
    expect(source).not.toContain("contextMoveOpen");
  });

  test("opens the card menu without a modal scroll lock so the list does not hitch", () => {
    const source = readFileSync(new URL("./MemoListPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("<DropdownMenu modal={false} open={true}");
    expect(source).toContain("data-[state=open]:animate-none");
    expect(source).toContain("onCloseAutoFocus={(event) => event.preventDefault()}");
  });
});

describe("desktop memo list spacing", () => {
  test("reserves matching desktop scrollbar gutters on both sides", () => {
    const source = readFileSync(new URL("./MemoListPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("lg:px-2 lg:py-2 lg:pb-3 lg:[scrollbar-gutter:stable_both-edges]");
  });
});

describe("memo list windowing", () => {
  test("renders only virtualized memo cards instead of mapping the whole loaded list", () => {
    const source = readFileSync(new URL("./MemoListPane.tsx", import.meta.url), "utf8");

    expect(source).toContain("useVirtualizer");
    expect(source).toContain("memoListVirtualizer.getVirtualItems()");
    expect(source).toContain("memoListVirtualizer.measureElement");
    expect(source).not.toContain("{memos.map((memo) => (");
  });
});

describe("empty memo list creation", () => {
  test("does not forward the React click event as a memo kind", () => {
    const source = readFileSync(new URL("./MemoListPane.tsx", import.meta.url), "utf8");

    expect(source).toContain('onClick={() => onCreateMemo()} disabled={isCreating}');
    expect(source).not.toContain('onClick={onCreateMemo} disabled={isCreating}');
  });
});

describe("desktop bulk move", () => {
  test("keeps a user-chosen notebook instead of snapping back to the current notebook", () => {
    const memoListSource = readFileSync(new URL("./MemoListPane.tsx", import.meta.url), "utf8");
    const workspaceSource = readFileSync(new URL("./WorkspaceApp.tsx", import.meta.url), "utf8");

    expect(memoListSource).toContain("resolveSelectionMoveTargetNotebookId");
    expect(memoListSource).toContain("disabled={selectedCount === 0 || !moveTargetNotebookId || isMoving || isTrashView || !canMove}");
    expect(workspaceSource).toContain("resolveSelectionMoveTargetNotebookId");
    expect(workspaceSource).toContain("canMove={canMoveSelectedMemos}");
    expect(workspaceSource).not.toContain("setSelectionMoveTargetNotebookId(selectedNotebook.id)");
    expect(memoListSource).not.toContain("setMoveTargetNotebookId(notebook.id)");
  });
});
