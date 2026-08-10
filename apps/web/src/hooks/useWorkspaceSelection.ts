import { useCallback, useRef, useState } from "react";

export const useWorkspaceSelection = () => {
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null);
  const selectedMemoIdRef = useRef(selectedMemoId);
  selectedMemoIdRef.current = selectedMemoId;
  const [selectedMemoIds, setSelectedMemoIds] = useState<Set<string>>(() => new Set());
  const [memoSelectionMode, setMemoSelectionMode] = useState(false);
  const [selectionMoveTargetNotebookId, setSelectionMoveTargetNotebookId] = useState("");

  const clearMemoSelection = useCallback(() => {
    setSelectedMemoIds(new Set());
    setMemoSelectionMode(false);
  }, []);

  const replaceMemoSelection = useCallback((memoIds: string[]) => {
    setSelectedMemoIds(new Set(memoIds));
    setMemoSelectionMode(true);
  }, []);

  const beginMemoSelection = useCallback(() => setMemoSelectionMode(true), []);

  return {
    beginMemoSelection,
    clearMemoSelection,
    memoSelectionMode,
    replaceMemoSelection,
    selectedMemoId,
    selectedMemoIdRef,
    selectedMemoIds,
    selectedNotebookId,
    selectionMoveTargetNotebookId,
    setMemoSelectionMode,
    setSelectedMemoId,
    setSelectedMemoIds,
    setSelectedNotebookId,
    setSelectionMoveTargetNotebookId,
  };
};
