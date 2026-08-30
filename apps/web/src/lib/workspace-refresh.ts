import type { QueryClient } from "@tanstack/react-query";
import type { MemoDetail } from "@edgeever/shared";

export type WorkspaceRefreshMode = "background" | "manual";
export type WorkspaceMemoView = "notebook" | "trash";

export const DEFERRED_MEMO_SYNC_DELAY_MS = 30_000;
export const BACKGROUND_WORKSPACE_REFRESH_INTERVAL_MS = 5 * 60_000;
export const BACKGROUND_WORKSPACE_REFRESH_LEASE_MS = BACKGROUND_WORKSPACE_REFRESH_INTERVAL_MS * 2;
export const BACKGROUND_WORKSPACE_REFRESH_COALESCE_MS = 1_000;

type RefreshLease = {
  ownerId: string;
  expiresAt: number;
};

const parseRefreshLease = (value: string | null): RefreshLease | null => {
  if (!value) return null;
  try {
    const lease = JSON.parse(value) as Partial<RefreshLease>;
    return typeof lease.ownerId === "string" && Number.isFinite(lease.expiresAt)
      ? { ownerId: lease.ownerId, expiresAt: Number(lease.expiresAt) }
      : null;
  } catch {
    return null;
  }
};

export const claimBackgroundRefreshLease = ({
  storage,
  key,
  ownerId,
  now = Date.now(),
  leaseMs = BACKGROUND_WORKSPACE_REFRESH_LEASE_MS,
}: {
  storage: Pick<Storage, "getItem" | "setItem">;
  key: string;
  ownerId: string;
  now?: number;
  leaseMs?: number;
}) => {
  const current = parseRefreshLease(storage.getItem(key));
  if (current && current.ownerId !== ownerId && current.expiresAt > now) return false;

  storage.setItem(key, JSON.stringify({ ownerId, expiresAt: now + leaseMs }));
  return parseRefreshLease(storage.getItem(key))?.ownerId === ownerId;
};

export const releaseBackgroundRefreshLease = ({
  storage,
  key,
  ownerId,
}: {
  storage: Pick<Storage, "getItem" | "removeItem">;
  key: string;
  ownerId: string;
}) => {
  if (parseRefreshLease(storage.getItem(key))?.ownerId === ownerId) storage.removeItem(key);
};

export const createRefreshSingleFlight = <T>({
  refresh,
  now = Date.now,
  coalesceMs = BACKGROUND_WORKSPACE_REFRESH_COALESCE_MS,
}: {
  refresh: () => Promise<T>;
  now?: () => number;
  coalesceMs?: number;
}) => {
  let active: Promise<T> | null = null;
  let lastStartedAt = Number.NEGATIVE_INFINITY;

  return () => {
    if (active) return active;
    const startedAt = now();
    if (startedAt - lastStartedAt < coalesceMs) return Promise.resolve(null);
    lastStartedAt = startedAt;
    active = refresh().finally(() => {
      active = null;
    });
    return active;
  };
};

export const shouldNavigateHomeWhenOpeningMemo = (view: WorkspaceMemoView) => view !== "trash";

export const resolveSyncedMemoId = (
  memoIdMappings: ReadonlyMap<string, string>,
  memoId: string | null,
) => memoId ? memoIdMappings.get(memoId) ?? memoId : null;

type MemoDetailQueryData = { memo: MemoDetail };

/**
 * Keep the active editor backed by cached detail while sync replaces a local
 * memo id with its durable server id. Without this handoff, React Query briefly
 * observes an empty query under the new key and swaps the editor for its loading
 * state until the desktop sidecar returns the same memo again.
 */
export const preserveRemappedMemoDetailQueries = (
  queryClient: Pick<QueryClient, "getQueryData" | "setQueryData">,
  memoIdMappings: ReadonlyMap<string, string>,
) => {
  for (const [temporaryId, remoteId] of memoIdMappings) {
    if (temporaryId === remoteId) continue;

    for (const view of ["notebook", "trash"] as const) {
      const remoteKey = ["memo", remoteId, view] as const;
      if (queryClient.getQueryData<MemoDetailQueryData>(remoteKey)?.memo) continue;

      const temporary = queryClient.getQueryData<MemoDetailQueryData>([
        "memo",
        temporaryId,
        view,
      ]);
      if (!temporary?.memo) continue;

      queryClient.setQueryData<MemoDetailQueryData>(remoteKey, {
        ...temporary,
        memo: { ...temporary.memo, id: remoteId },
      });
    }
  }
};

export const resolveCreatedMemoSelection = (
  currentMemoId: string | null,
  pendingMemoId: string | null,
  temporaryMemoId: string,
  remoteMemoId: string,
) => currentMemoId === temporaryMemoId || pendingMemoId === temporaryMemoId
  ? remoteMemoId
  : currentMemoId;

export type WorkspaceRefreshResult = {
  changed: number;
  skipped: boolean;
};

export const refreshWorkspaceData = async ({
  mode,
  hasPendingLocalChanges,
  pushLocalChanges,
  pullRemoteChanges,
  invalidateWorkspaceQueries,
}: {
  mode: WorkspaceRefreshMode;
  hasPendingLocalChanges: boolean;
  pushLocalChanges: () => Promise<void>;
  pullRemoteChanges: () => Promise<{ changed: number }>;
  invalidateWorkspaceQueries: () => Promise<void>;
}): Promise<WorkspaceRefreshResult> => {
  if (mode === "background" && hasPendingLocalChanges) {
    return { changed: 0, skipped: true };
  }

  if (mode === "manual") {
    await pushLocalChanges();
  }

  const result = await pullRemoteChanges();

  if (mode === "manual" || result.changed > 0) {
    await invalidateWorkspaceQueries();
  }

  return { changed: result.changed, skipped: false };
};
