import { useCallback, useState } from "react";
import { toggleMobileMemoSelection } from "@edgeever/shared/mobile-ui";

export const toggleVisibleMemoSelection = (
  current: ReadonlySet<string>,
  visibleMemoIds: readonly string[],
) => {
  const next = new Set(current);
  const allVisibleSelected = visibleMemoIds.length > 0
    && visibleMemoIds.every((memoId) => next.has(memoId));

  for (const memoId of visibleMemoIds) {
    if (allVisibleSelected) {
      next.delete(memoId);
    } else {
      next.add(memoId);
    }
  }

  return next;
};

export const remapSelectedMemo = (
  current: Set<string>,
  temporaryId: string,
  persistedId: string,
) => {
  if (!current.has(temporaryId)) {
    return current;
  }

  const next = new Set(current);
  next.delete(temporaryId);
  next.add(persistedId);
  return next;
};

export const useMobileWorkspaceSelection = () => {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMemoIds, setSelectedMemoIds] = useState<Set<string>>(() => new Set());
  const [selectionMoveOpen, setSelectionMoveOpen] = useState(false);
  const [selectionMoreOpen, setSelectionMoreOpen] = useState(false);

  const clearSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedMemoIds(new Set());
    setSelectionMoveOpen(false);
    setSelectionMoreOpen(false);
  }, []);

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
  }, []);

  const toggleSelectedMemo = useCallback((memoId: string) => {
    setSelectionMode(true);
    setSelectedMemoIds((current) => toggleMobileMemoSelection(current, memoId));
  }, []);

  const selectSingleMemo = useCallback((memoId: string) => {
    setSelectionMode(true);
    setSelectedMemoIds(new Set([memoId]));
  }, []);

  const toggleVisibleSelection = useCallback((visibleMemoIds: readonly string[]) => {
    if (visibleMemoIds.length === 0) {
      return;
    }

    setSelectionMode(true);
    setSelectedMemoIds((current) => toggleVisibleMemoSelection(current, visibleMemoIds));
  }, []);

  const remapSelectedMemoId = useCallback((temporaryId: string, persistedId: string) => {
    setSelectedMemoIds((current) => remapSelectedMemo(current, temporaryId, persistedId));
  }, []);

  const restoreSelection = useCallback((mode: boolean, memoIds: ReadonlySet<string>) => {
    setSelectionMode(mode);
    setSelectedMemoIds(new Set(memoIds));
  }, []);

  return {
    clearSelection,
    enterSelectionMode,
    remapSelectedMemoId,
    restoreSelection,
    selectedMemoIds,
    selectionMode,
    selectionMoreOpen,
    selectionMoveOpen,
    selectSingleMemo,
    setSelectionMoreOpen,
    setSelectionMoveOpen,
    toggleSelectedMemo,
    toggleVisibleSelection,
  };
};
