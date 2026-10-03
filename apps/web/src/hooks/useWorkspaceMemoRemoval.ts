import { useMutation, type QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { MemoSummary } from "@edgeever/shared";
import type { AppNoticeDialogState, Pane } from "@/lib/app-helpers";
import type { EdgeEverRepository } from "@/lib/repository";
import {
  applyMemoRemovalToCache,
  clearTrashMemoLists,
  getAdjacentMemoIdAfterRemoval,
  restoreMemoRemovalCache,
  restoreTrashClearCache,
  snapshotMemoRemovalCache,
  snapshotTrashClearCache,
  type MemoRemovalCacheSnapshot,
  type TrashClearCacheSnapshot,
} from "@/lib/workspace-memo-cache";

type MemoDeleteOptimisticContext = MemoRemovalCacheSnapshot & {
  previousActivePane: Pane;
  previousSelectedMemoId: string | null;
};

type EmptyTrashOptimisticContext = TrashClearCacheSnapshot & {
  previousActivePane: Pane;
  previousSelectedMemoId: string | null;
};

type UseWorkspaceMemoRemovalOptions = {
  activePane: Pane;
  clearMemoSelection: () => void;
  memos: MemoSummary[];
  queryClient: QueryClient;
  repository: Pick<EdgeEverRepository, "deleteMemos" | "deleteMemo" | "emptyTrash">;
  selectedMemoId: string | null;
  setActivePane: Dispatch<SetStateAction<Pane>>;
  setAppNoticeDialog: Dispatch<SetStateAction<AppNoticeDialogState | null>>;
  setEmptyTrashConfirmationOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedMemoId: Dispatch<SetStateAction<string | null>>;
  t: TFunction;
};

export const useWorkspaceMemoRemoval = ({
  activePane,
  clearMemoSelection,
  memos,
  queryClient,
  repository,
  selectedMemoId,
  setActivePane,
  setAppNoticeDialog,
  setEmptyTrashConfirmationOpen,
  setSelectedMemoId,
  t,
}: UseWorkspaceMemoRemovalOptions) => {
  const deleteMemosMutation = useMutation({
    mutationFn: repository.deleteMemos,
    onMutate: async (variables): Promise<MemoDeleteOptimisticContext> => {
      const deletedMemoIds = new Set(variables.memoIds);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["memos"] }),
        queryClient.cancelQueries({ queryKey: ["memo"] }),
        queryClient.cancelQueries({ queryKey: ["notebooks"] }),
      ]);

      const cacheSnapshot = snapshotMemoRemovalCache(queryClient);

      clearMemoSelection();

      if (selectedMemoId && deletedMemoIds.has(selectedMemoId)) {
        setSelectedMemoId(getAdjacentMemoIdAfterRemoval(memos, deletedMemoIds, selectedMemoId));
        setActivePane("memos");
      }

      applyMemoRemovalToCache(queryClient, deletedMemoIds);

      return { ...cacheSnapshot, previousActivePane: activePane, previousSelectedMemoId: selectedMemoId };
    },
    onError: (_error, _variables, context) => {
      if (context) restoreMemoRemovalCache(queryClient, context);
      setSelectedMemoId(context?.previousSelectedMemoId ?? null);
      setActivePane(context?.previousActivePane ?? "memos");
    },
    onSettled: (_data, _error, variables) => {
      const refetchType = _error ? "active" : "inactive";
      const deletedMemoIds = new Set(variables?.memoIds ?? []);

      if (!_error) {
        for (const memoId of deletedMemoIds) {
          queryClient.removeQueries({ queryKey: ["memo", memoId] });
        }
      }

      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"], refetchType }),
        queryClient.invalidateQueries({ queryKey: ["memo"], refetchType }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"], refetchType }),
        queryClient.invalidateQueries({ queryKey: ["resources"], refetchType: _error ? "active" : "all" }),
      ]);
    },
  });

  const deleteMemoMutation = useMutation({
    mutationFn: async ({ memoId, permanent }: { memoId: string; permanent?: boolean }) => {
      return repository.deleteMemo(memoId, Boolean(permanent));
    },
    onMutate: async (variables): Promise<MemoDeleteOptimisticContext> => {
      const deletedMemoIds = new Set([variables.memoId]);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["memos"] }),
        queryClient.cancelQueries({ queryKey: ["memo", variables.memoId] }),
        queryClient.cancelQueries({ queryKey: ["notebooks"] }),
      ]);

      const cacheSnapshot = snapshotMemoRemovalCache(queryClient, ["memo", variables.memoId]);

      if (selectedMemoId === variables.memoId) {
        setSelectedMemoId(getAdjacentMemoIdAfterRemoval(memos, deletedMemoIds, variables.memoId));
        setActivePane("memos");
      }

      applyMemoRemovalToCache(queryClient, deletedMemoIds);

      return { ...cacheSnapshot, previousActivePane: activePane, previousSelectedMemoId: selectedMemoId };
    },
    onError: (_error, _variables, context) => {
      if (context) restoreMemoRemovalCache(queryClient, context);
      setSelectedMemoId(context?.previousSelectedMemoId ?? null);
      setActivePane(context?.previousActivePane ?? "memos");
    },
    onSettled: (_data, _error, variables) => {
      const refetchType = _error ? "active" : "inactive";

      if (!_error) {
        queryClient.removeQueries({ queryKey: ["memo", variables?.memoId] });
      }
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"], refetchType }),
        queryClient.invalidateQueries({ queryKey: ["notebooks"], refetchType }),
        queryClient.invalidateQueries({ queryKey: ["resources"], refetchType: _error ? "active" : "all" }),
      ]);
    },
  });

  const emptyTrashMutation = useMutation({
    mutationFn: repository.emptyTrash,
    onMutate: async (): Promise<EmptyTrashOptimisticContext> => {
      const previousActivePane = activePane;
      const previousSelectedMemoId = selectedMemoId;

      // Leave the editor before cancelling/refetching its detail query. On a
      // desktop layout the editor remains mounted even when the memo pane is
      // visible, so keeping a trashed memo selected while its query is being
      // invalidated can render a deleted detail and repeatedly re-select it.
      setEmptyTrashConfirmationOpen(false);
      clearMemoSelection();
      setSelectedMemoId(null);
      setActivePane("memos");

      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["memos"] }),
        queryClient.cancelQueries({ queryKey: ["memo"] }),
        queryClient.cancelQueries({ queryKey: ["resources"] }),
      ]);

      const cacheSnapshot = snapshotTrashClearCache(queryClient);

      // Keep the optimistic update limited to list data. Removing the active
      // memo detail query here can make the editor render with a missing memo
      // during the same React update and blank the whole workspace.
      clearTrashMemoLists(queryClient);

      return { ...cacheSnapshot, previousActivePane, previousSelectedMemoId };
    },
    onError: (_error, _variables, context) => {
      if (context) restoreTrashClearCache(queryClient, context);
      setSelectedMemoId(context?.previousSelectedMemoId ?? null);
      setActivePane(context?.previousActivePane ?? "memos");
      setAppNoticeDialog({
        title: t("workspaceDialogs.emptyTrashFailedTitle"),
        description: t("workspaceDialogs.emptyTrashFailedDescription"),
      });
    },
    onSuccess: () => {
      // The trash detail queries are no longer valid after a successful
      // permanent delete. Remove them before invalidating the remaining
      // active queries so an editor cannot briefly observe a 404 detail.
      queryClient.removeQueries({
        queryKey: ["memo"],
        predicate: (query) => {
          const data = query.state.data as { memo?: { isDeleted?: boolean } } | undefined;
          return data?.memo?.isDeleted === true;
        },
      });
      setSelectedMemoId(null);
      setActivePane("memos");
    },
    onSettled: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["memos"], refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: ["memo"], refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: ["resources"], refetchType: "active" }),
      ]);
    },
  });

  return { deleteMemosMutation, deleteMemoMutation, emptyTrashMutation };
};
