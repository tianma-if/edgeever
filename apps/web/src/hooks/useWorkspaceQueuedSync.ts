import { useCallback, useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { MemoDetail, MemoTemplate, Notebook, Resource } from "@edgeever/shared";
import { isBrowserOffline } from "@/lib/network-status";
import { emptySyncQueueSummary, type SyncQueueSummary } from "@/lib/sync-queue";
import { MEMO_ID_REMAPPED_EVENT, NOTEBOOK_ID_REMAPPED_EVENT, notifyMemoIdRemapped, notifyMemoSyncAcknowledged, notifyNotebookIdRemapped } from "@/lib/sync-events";
import { observeLocalMemoIdMappings, putLocalMemo, replaceLocalMemoId } from "@/lib/local-mirror";
import { remapMemoIdsInLists } from "@/lib/memo-list-cache";
import { remapMemoReadingStyle } from "@/lib/memo-reading-style";
import { preserveRemappedMemoDetailQueries, resolveSyncedMemoId } from "@/lib/workspace-refresh";

type UseWorkspaceQueuedSyncOptions = {
  isOnline: boolean;
  localDataScope: string;
  pendingCreatedMemoIdRef: MutableRefObject<string | null>;
  queryClient: QueryClient;
  selectedMemoIdRef: MutableRefObject<string | null>;
  setCreatedMemoEditId: Dispatch<SetStateAction<string | null>>;
  setOnline: Dispatch<SetStateAction<boolean>>;
  setSelectedMemoId: Dispatch<SetStateAction<string | null>>;
  setSelectedNotebookId: Dispatch<SetStateAction<string | null>>;
};

export const useWorkspaceQueuedSync = ({
  isOnline,
  localDataScope,
  pendingCreatedMemoIdRef,
  queryClient,
  selectedMemoIdRef,
  setCreatedMemoEditId,
  setOnline,
  setSelectedMemoId,
  setSelectedNotebookId,
}: UseWorkspaceQueuedSyncOptions) => {
  const [syncSummary, setSyncSummary] = useState<SyncQueueSummary>(emptySyncQueueSummary);
  const [isSyncingQueuedChanges, setIsSyncingQueuedChanges] = useState(false);

  const applyMemoIdMappings = useCallback((memoIdMappings: ReadonlyMap<string, string>) => {
    if (memoIdMappings.size === 0) return;

    for (const [temporaryId, remoteId] of memoIdMappings) {
      remapMemoReadingStyle(localDataScope, temporaryId, remoteId);
    }

    // Seed the durable-id query before changing the selection. The desktop
    // editor otherwise renders its loading state between the local-id and
    // remote-id queries, which looks like a full editor reload after create.
    preserveRemappedMemoDetailQueries(queryClient, memoIdMappings);
    // The create path inserts the temporary id into the list cache. If sync
    // later adds the durable id without replacing that row, the list shows two
    // empty notes for one create.
    remapMemoIdsInLists(queryClient, memoIdMappings);
    notifyMemoIdRemapped(memoIdMappings);
    const selectedMemoId = selectedMemoIdRef.current;
    const pendingMemoId = pendingCreatedMemoIdRef.current;
    const remappedSelectedMemoId = resolveSyncedMemoId(memoIdMappings, selectedMemoId);
    const remappedPendingMemoId = resolveSyncedMemoId(memoIdMappings, pendingMemoId);
    const nextSelectedMemoId = remappedSelectedMemoId !== selectedMemoId
      ? remappedSelectedMemoId
      : remappedPendingMemoId !== pendingMemoId
        ? remappedPendingMemoId
        : selectedMemoId;

    pendingCreatedMemoIdRef.current = remappedPendingMemoId;
    setCreatedMemoEditId((current) => resolveSyncedMemoId(memoIdMappings, current));
    if (nextSelectedMemoId !== selectedMemoId) {
      selectedMemoIdRef.current = nextSelectedMemoId;
      setSelectedMemoId(nextSelectedMemoId);
    }
  }, [localDataScope, pendingCreatedMemoIdRef, queryClient, selectedMemoIdRef, setCreatedMemoEditId, setSelectedMemoId]);

  useEffect(() => observeLocalMemoIdMappings(localDataScope, applyMemoIdMappings), [applyMemoIdMappings, localDataScope]);

  useEffect(() => {
    const handleMemoIdRemapped = (event: Event) => {
      const mappings = (event as CustomEvent<ReadonlyMap<string, string>>).detail;
      if (mappings instanceof Map) remapMemoIdsInLists(queryClient, mappings);
    };
    window.addEventListener(MEMO_ID_REMAPPED_EVENT, handleMemoIdRemapped);
    return () => window.removeEventListener(MEMO_ID_REMAPPED_EVENT, handleMemoIdRemapped);
  }, [queryClient]);

  useEffect(() => {
    const handleNotebookIdRemapped = (event: Event) => {
      const { temporaryId, remoteId } = (event as CustomEvent<{ temporaryId: string; remoteId: string }>).detail;
      queryClient.setQueryData<{ notebooks: Notebook[] }>(["notebooks"], (current) => {
        if (!current) return current;
        const hasRemote = current.notebooks.some((notebook) => notebook.id === remoteId);
        return {
          ...current,
          notebooks: (hasRemote
            ? current.notebooks.filter((notebook) => notebook.id !== temporaryId)
            : current.notebooks.map((notebook) => notebook.id === temporaryId ? { ...notebook, id: remoteId } : notebook))
            .map((notebook) => notebook.parentId === temporaryId ? { ...notebook, parentId: remoteId } : notebook),
        };
      });
      setSelectedNotebookId((current) => current === temporaryId ? remoteId : current);
    };
    window.addEventListener(NOTEBOOK_ID_REMAPPED_EVENT, handleNotebookIdRemapped);
    return () => window.removeEventListener(NOTEBOOK_ID_REMAPPED_EVENT, handleNotebookIdRemapped);
  }, [queryClient, setSelectedNotebookId]);

  const invalidateSyncQueries = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["memos"] }),
    queryClient.invalidateQueries({ queryKey: ["memo"] }),
    queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
    queryClient.invalidateQueries({ queryKey: ["templates"] }),
    queryClient.invalidateQueries({ queryKey: ["resources"] }),
  ]), [queryClient]);

  const runQueuedSync = useCallback(async () => {
    if (isBrowserOffline()) {
      setOnline(false);
      return;
    }
    setIsSyncingQueuedChanges(true);
    try {
      if (window.edgeeverDesktop?.isAvailable) {
        const { getDesktopSyncSummary, syncDesktopData } = await import("@/lib/desktop-sync");
        const result = await syncDesktopData();
        applyMemoIdMappings(result.memoIdMappings);
        window.dispatchEvent(new CustomEvent("edgeever:sync-completed", { detail: result }));
        setSyncSummary(await getDesktopSyncSummary());
        await invalidateSyncQueries();
        return;
      }

      const { syncQueuedChanges } = await import("@/lib/sync-queue");
      const result = await syncQueuedChanges({
        scope: localDataScope,
        onMemoAcknowledged: async (memo) => {
          // Advance the live editor's concurrency base before the acknowledged
          // server snapshot reaches React Query. This keeps a self-sync from
          // being mistaken for new document content and moving the caret.
          notifyMemoSyncAcknowledged(memo);
        },
        onSynced: async (memo, item) => {
          if (item.kind === "memo.create") {
            const remappedMemo = await replaceLocalMemoId(localDataScope, item.memoId, memo);
            applyMemoIdMappings(new Map([[item.memoId, memo.id]]));
            queryClient.setQueryData(["memo", memo.id, memo.isDeleted ? "trash" : "notebook"], { memo: remappedMemo });
          } else {
            await putLocalMemo(localDataScope, memo);
            queryClient.setQueryData(["memo", memo.id, memo.isDeleted ? "trash" : "notebook"], { memo });
          }
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["memos"] }),
            queryClient.invalidateQueries({ queryKey: ["memo", memo.id] }),
          ]);
        },
        onActionSynced: async (result, item) => {
          if (!result || !["memo.merge", "notebook.create", "notebook.update", "template.create", "template.update", "resource.create"].includes(item.kind)) return;
          const {
            deleteLocalMemo,
            deleteLocalTemplate,
            getLocalMemo,
            putLocalMemo: putMemo,
            putLocalNotebook,
            putLocalResource,
            putLocalTemplate,
          } = await import("@/lib/local-mirror");
          const payload = item.payload as Record<string, unknown>;
          const temporaryId = typeof payload.temporaryId === "string" ? payload.temporaryId : null;

          if (item.kind === "resource.create" && "url" in result) {
            await putLocalResource(localDataScope, { ...(result as Resource), memoTitle: null, memoExcerpt: null, memoDeleted: false });
          } else if (item.kind === "memo.merge" && "contentJson" in result && temporaryId) {
            await deleteLocalMemo(localDataScope, temporaryId, true);
            await putMemo(localDataScope, result as MemoDetail);
            const sourceIds = Array.isArray(payload.memoIds) ? payload.memoIds.filter((value): value is string => typeof value === "string") : [];
            await Promise.all(sourceIds.map(async (sourceId) => {
              const source = await getLocalMemo(localDataScope, sourceId);
              if (source) await putMemo(localDataScope, { ...source, mergedIntoMemoId: (result as MemoDetail).id });
            }));
          } else if (item.kind === "notebook.create" && "name" in result && temporaryId) {
            // The sync core committed the mirror, references, mapping and
            // acknowledgement together before notifying the live UI.
            notifyNotebookIdRemapped(temporaryId, (result as Notebook).id);
          } else if (item.kind === "notebook.update" && "name" in result) {
            await putLocalNotebook(localDataScope, result as Notebook);
          } else if (item.kind === "template.create" && "contentMarkdown" in result && temporaryId) {
            await deleteLocalTemplate(localDataScope, temporaryId);
            await putLocalTemplate(localDataScope, result as MemoTemplate);
          } else if (item.kind === "template.update" && "contentMarkdown" in result) {
            await putLocalTemplate(localDataScope, result as MemoTemplate);
          }
          await invalidateSyncQueries();
        },
      });
      window.dispatchEvent(new CustomEvent("edgeever:sync-completed", { detail: result }));
      if (result.failed > 0) await invalidateSyncQueries();
    } finally {
      setIsSyncingQueuedChanges(false);
    }
  }, [applyMemoIdMappings, invalidateSyncQueries, localDataScope, queryClient, setOnline]);

  const discardConflictsNow = useCallback(async () => {
    if (!isOnline) return;
    setIsSyncingQueuedChanges(true);
    try {
      if (window.edgeeverDesktop?.isAvailable) {
        const { discardDesktopConflicts, getDesktopSyncSummary } = await import("@/lib/desktop-sync");
        await discardDesktopConflicts();
        setSyncSummary(await getDesktopSyncSummary());
      } else {
        const { discardWebConflicts } = await import("@/lib/sync-queue");
        await discardWebConflicts(localDataScope);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["memo"] }),
      ]);
    } finally {
      setIsSyncingQueuedChanges(false);
    }
  }, [isOnline, localDataScope, queryClient]);

  return {
    discardConflictsNow,
    isSyncingQueuedChanges,
    runQueuedSync,
    setSyncSummary,
    syncSummary,
  };
};
