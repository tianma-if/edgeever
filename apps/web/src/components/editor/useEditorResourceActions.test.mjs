import { describe, expect, test } from "bun:test";
import {
  editorResourceActionReducer,
  initialEditorResourceActionState,
} from "./useEditorResourceActions.ts";

const target = {
  kind: "attachment",
  url: "/resource",
  filename: "draft.pdf",
  resourceId: "resource-1",
  position: { left: 1, top: 2, placement: "above" },
};

describe("editor resource action state machine", () => {
  test("opens a dialog atomically from a menu target", () => {
    const menu = editorResourceActionReducer(initialEditorResourceActionState, { type: "show-menu", target });
    const dialog = editorResourceActionReducer(menu, { type: "open-dialog", action: "rename", target });

    expect(dialog).toMatchObject({ menuTarget: null, filename: "draft.pdf", pending: false, error: null });
    expect(dialog.dialog).toEqual({ action: "rename", target });
  });

  test("keeps a pending dialog open and closes it after completion", () => {
    const dialog = editorResourceActionReducer(initialEditorResourceActionState, { type: "open-dialog", action: "delete", target });
    const pending = editorResourceActionReducer(dialog, { type: "start" });

    expect(editorResourceActionReducer(pending, { type: "close-dialog" })).toBe(pending);
    expect(editorResourceActionReducer(pending, { type: "complete" })).toMatchObject({ dialog: null, pending: false, error: null });
  });

  test("retains the dialog and reports a failed action", () => {
    const dialog = editorResourceActionReducer(initialEditorResourceActionState, { type: "open-dialog", action: "rename", target });
    const failed = editorResourceActionReducer(
      editorResourceActionReducer(dialog, { type: "start" }),
      { type: "fail", error: "rename failed" },
    );

    expect(failed.dialog).toEqual(dialog.dialog);
    expect(failed).toMatchObject({ pending: false, error: "rename failed" });
  });
});
