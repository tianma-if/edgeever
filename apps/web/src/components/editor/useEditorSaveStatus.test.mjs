import { describe, expect, test } from "bun:test";
import {
  editorSaveStatusReducer,
  initialEditorSaveStatus,
} from "./useEditorSaveStatus.ts";

describe("editor save status state machine", () => {
  test("marks edits dirty and returns non-conflicted saves to idle", () => {
    const state = editorSaveStatusReducer(
      { ...initialEditorSaveStatus, saveState: "saved" },
      { type: "mark-dirty" },
    );

    expect(state).toMatchObject({
      saveState: "idle",
      hasUnsavedChanges: true,
      dirtyVersion: 1,
    });
  });

  test("does not hide a conflict when more local edits arrive", () => {
    const state = editorSaveStatusReducer(
      { ...initialEditorSaveStatus, saveState: "conflict", dirtyVersion: 2 },
      { type: "mark-dirty" },
    );

    expect(state.saveState).toBe("conflict");
    expect(state.hasUnsavedChanges).toBe(true);
    expect(state.dirtyVersion).toBe(3);
  });

  test("tracks phase, conflict details, and dirty clearance independently", () => {
    const conflict = { code: "revision_conflict", message: "Changed remotely" };
    const withConflict = editorSaveStatusReducer(initialEditorSaveStatus, {
      type: "set-conflict",
      conflict,
    });
    const saving = editorSaveStatusReducer(withConflict, { type: "set-phase", phase: "saving" });
    const clean = editorSaveStatusReducer(
      { ...saving, hasUnsavedChanges: true },
      { type: "set-dirty", dirty: false },
    );

    expect(clean.saveConflictInfo).toEqual(conflict);
    expect(clean.saveState).toBe("saving");
    expect(clean.hasUnsavedChanges).toBe(false);
  });
});
