import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { MemoDetail, MemoTemplate, Notebook, Resource } from "@edgeever/shared";
import { isBrowserOffline } from "@/lib/network-status";
import { emptySyncQueueSummary, type SyncQueueSummary } from "@/lib/sync-queue";
import { notifyMemoIdRemapped, notifyMemoSyncAcknowledged } from "@/lib/sync-events";
import { putLocalMemo, replaceLocalMemoId } from "@/lib/local-mirror";
import { resolveCreatedMemoSelection, resolveSyncedMemoId } from "@/lib/workspace-refresh";

type UseWorkspaceQueuedSyncOptions = {
  isOnline: boolean;
  localDataScope: string;
  pendingCreatedMemoIdRef: MutableRefObject<string | null>;
  queryClient: QueryClient;
  selectedMemoIdRef: MutableRefObject<string | null>;
  setCreatedMemoEditId: Dispatch<SetStateAction<string | null>>;
  setOnline: Dispatch<SetStateAction<boolean>>;
  setSelectedMemoId: Dispatch<SetStateAction<string | null>>;
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
}: UseWorkspaceQueuedSyncOptions) => {
  const [syncSummary, setSyncSummary] = useState<SyncQueueSummary>(emptySyncQueueSummary);
  const [isSyncingQueuedChanges, setIsSyncingQueuedChanges] = useState(false);

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
        if (result.memoIdMappings.size > 0) {
          notifyMemoIdRemapped(result.memoIdMappings);
          pendingCreatedMemoIdRef.current = resolveSyncedMemoId(result.memoIdMappings, pendingCreatedMemoIdRef.current);
          setCreatedMemoEditId((current) => resolveSyncedMemoId(result.memoIdMappings, current));
          setSelectedMemoId((current) => resolveSyncedMemoId(result.memoIdMappings, current));
        }
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
            const remappedSelection = resolveCreatedMemoSelection(
              selectedMemoIdRef.current,
              pendingCreatedMemoIdRef.current,
              item.memoId,
              memo.id,
            );
            if (remappedSelection === memo.id) {
              selectedMemoIdRef.current = memo.id;
              setSelectedMemoId(memo.id);
              setCreatedMemoEditId(memo.id);
              pendingCreatedMemoIdRef.current = memo.id;
            }
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
            deleteLocalNotebook,
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
            await deleteLocalNotebook(localDataScope, temporaryId);
            await putLocalNotebook(localDataScope, result as Notebook);
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
    } finally {
      setIsSyncingQueuedChanges(false);
    }
  }, [invalidateSyncQueries, localDataScope, pendingCreatedMemoIdRef, queryClient, selectedMemoIdRef, setCreatedMemoEditId, setOnline, setSelectedMemoId]);

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
