import {
  useCallback,
  useReducer,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { MemoSaveConflictInfo } from "@/lib/memo-save-conflict";

export type EditorSavePhase = "idle" | "saving" | "saved" | "queued" | "error" | "conflict";

export type EditorSaveStatusState = {
  saveState: EditorSavePhase;
  saveConflictInfo: MemoSaveConflictInfo | null;
  hasUnsavedChanges: boolean;
  dirtyVersion: number;
};

export type EditorSaveStatusAction =
  | { type: "set-phase"; phase: EditorSavePhase }
  | { type: "set-conflict"; conflict: MemoSaveConflictInfo | null }
  | { type: "set-dirty"; dirty: boolean }
  | { type: "mark-dirty" };

export const initialEditorSaveStatus: EditorSaveStatusState = {
  saveState: "idle",
  saveConflictInfo: null,
  hasUnsavedChanges: false,
  dirtyVersion: 0,
};

export const editorSaveStatusReducer = (
  state: EditorSaveStatusState,
  action: EditorSaveStatusAction,
): EditorSaveStatusState => {
  switch (action.type) {
    case "set-phase":
      return { ...state, saveState: action.phase };
    case "set-conflict":
      return { ...state, saveConflictInfo: action.conflict };
    case "set-dirty":
      return { ...state, hasUnsavedChanges: action.dirty };
    case "mark-dirty":
      return {
        ...state,
        hasUnsavedChanges: true,
        dirtyVersion: state.dirtyVersion + 1,
        saveState: state.saveState === "conflict" ? "conflict" : "idle",
      };
  }
};

const resolveStateUpdate = <T,>(update: SetStateAction<T>, current: T) =>
  typeof update === "function" ? (update as (value: T) => T)(current) : update;

export const useEditorSaveStatus = () => {
  const [state, dispatch] = useReducer(editorSaveStatusReducer, initialEditorSaveStatus);
  const saveStateRef = useRef(state.saveState);
  const conflictInfoRef = useRef(state.saveConflictInfo);
  const hasUnsavedChangesRef = useRef(state.hasUnsavedChanges);

  const setSaveState: Dispatch<SetStateAction<EditorSavePhase>> = useCallback((update) => {
    const phase = resolveStateUpdate(update, saveStateRef.current);
    saveStateRef.current = phase;
    dispatch({ type: "set-phase", phase });
  }, []);

  const setSaveConflictInfo: Dispatch<SetStateAction<MemoSaveConflictInfo | null>> = useCallback((update) => {
    const conflict = resolveStateUpdate(update, conflictInfoRef.current);
    conflictInfoRef.current = conflict;
    dispatch({ type: "set-conflict", conflict });
  }, []);

  const setHasUnsavedChanges: Dispatch<SetStateAction<boolean>> = useCallback((update) => {
    const dirty = resolveStateUpdate(update, hasUnsavedChangesRef.current);
    hasUnsavedChangesRef.current = dirty;
    dispatch({ type: "set-dirty", dirty });
  }, []);

  const markDirtyStatus = useCallback(() => {
    hasUnsavedChangesRef.current = true;
    if (saveStateRef.current !== "conflict") saveStateRef.current = "idle";
    dispatch({ type: "mark-dirty" });
  }, []);

  return {
    ...state,
    hasUnsavedChangesRef,
    markDirtyStatus,
    setHasUnsavedChanges,
    setSaveConflictInfo,
    setSaveState,
  };
};
