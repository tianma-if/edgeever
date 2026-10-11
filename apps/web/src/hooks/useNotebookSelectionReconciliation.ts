import { useEffect } from "react";

// An external deletion can remove the selected notebook without going through
// the UI mutation. Wait for a settled catalog before returning to all notes.
export const useNotebookSelectionReconciliation = ({
  notebooks,
  selectedNotebookId,
  setSelectedNotebookId,
  setSelectedMemoId,
  clearMemoSelection,
}: {
  notebooks: ReadonlyArray<{ id: string }> | undefined;
  selectedNotebookId: string | null;
  setSelectedNotebookId: (id: string | null) => void;
  setSelectedMemoId: (id: string | null) => void;
  clearMemoSelection: () => void;
}) => {
  useEffect(() => {
    if (!notebooks || !selectedNotebookId || notebooks.some((notebook) => notebook.id === selectedNotebookId)) return;
    setSelectedNotebookId(null);
    setSelectedMemoId(null);
    clearMemoSelection();
  }, [notebooks, selectedNotebookId, setSelectedNotebookId, setSelectedMemoId, clearMemoSelection]);
};
