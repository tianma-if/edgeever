import type { MemoDetail, Notebook } from "./types";

export type SyncEntityType = "memo" | "notebook";
export type SyncOperation = "upsert" | "delete";

export type SyncChange = {
  cursor: number;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  notebook: Notebook | null;
  memo: MemoDetail | null;
};

export type SyncBootstrapResponse = {
  notebooks: Notebook[];
  memos: MemoDetail[];
  snapshotCursor: number;
  syncIdentity?: string;
  totalCount: number;
  nextAfterId: string | null;
};

export type SyncChangesResponse = {
  changes: SyncChange[];
  cursor: number;
  hasMore: boolean;
  /** Absent on older servers; clients must keep the current mirror when omitted. */
  serverCursor?: number;
  syncIdentity?: string;
};

export type SyncCursorState = {
  cursor: number;
  syncIdentity: string;
};

export type RemoteSyncCursorState = {
  serverCursor?: number;
  syncIdentity?: string;
};

export type SyncOutboxOperation =
  | "memo.create"
  | "memo.update"
  | "memo.delete"
  | "memo.restore"
  | "notebook.create"
  | "notebook.update"
  | "notebook.delete";

export type SyncQueueStatus = "pending" | "syncing" | "conflict" | "error";

export type SyncQueueSummary = {
  total: number;
  pending: number;
  syncing: number;
  conflict: number;
  error: number;
};

export type SyncRunResult = {
  attempted: number;
  synced: number;
  failed: number;
  conflicted: number;
};

export type SyncQueueStatusItem = {
  status: SyncQueueStatus;
};

export type RetryableSyncQueueItem = SyncQueueStatusItem & {
  nextAttemptAt: string | null;
};

export type MemoSyncBase = {
  revision: number;
  contentHash: string;
};

export type MemoSyncExpectedBase = {
  expectedRevision: number;
  expectedContentHash: string;
};

export const isMemoSyncBaseCurrent = (
  current: MemoSyncBase,
  expected: MemoSyncExpectedBase,
) => current.revision === expected.expectedRevision
  && current.contentHash === expected.expectedContentHash;

export const getMemoSyncBaseConflictDetails = (
  current: MemoSyncBase,
  expected: MemoSyncExpectedBase,
) => ({
  expectedRevision: expected.expectedRevision,
  currentRevision: current.revision,
  expectedContentHash: expected.expectedContentHash,
  currentContentHash: current.contentHash,
  source: "offline_sync" as const,
});

export const createEmptySyncQueueSummary = (): SyncQueueSummary => ({
  total: 0,
  pending: 0,
  syncing: 0,
  conflict: 0,
  error: 0,
});

export const createEmptySyncRunResult = (): SyncRunResult => ({
  attempted: 0,
  synced: 0,
  failed: 0,
  conflicted: 0,
});

export const summarizeSyncQueue = (
  items: ReadonlyArray<SyncQueueStatusItem>
): SyncQueueSummary => items.reduce((summary, item) => {
  summary.total += 1;
  summary[item.status] += 1;
  return summary;
}, createEmptySyncQueueSummary());

export const getSyncRetryDelayMs = (attemptCount: number) =>
  Math.min(5 * 60_000, 2 ** Math.min(Math.max(0, attemptCount), 6) * 1000);

export const getSyncRetryAt = (attemptCount: number, now = Date.now()) =>
  new Date(now + getSyncRetryDelayMs(attemptCount)).toISOString();

export const getNextSyncQueueRetryDelay = (
  items: ReadonlyArray<RetryableSyncQueueItem>,
  now = Date.now(),
  minimumDelayMs = 250
): number | null => {
  const retryTimes = items
    .filter((item) => item.status === "pending" || item.status === "error" || item.status === "syncing")
    .map((item) => (item.nextAttemptAt ? Date.parse(item.nextAttemptAt) : now))
    .filter(Number.isFinite);

  if (retryTimes.length === 0) {
    return null;
  }

  return Math.max(minimumDelayMs, Math.min(...retryTimes) - now);
};

export const hasSyncCursorRewound = (localCursor: number, serverCursor?: number) =>
  typeof serverCursor === "number"
  && Number.isFinite(serverCursor)
  && serverCursor < localCursor;

export const hasSyncIdentityChanged = (localIdentity: string, serverIdentity?: string) =>
  typeof serverIdentity === "string"
  && serverIdentity.length > 0
  && serverIdentity !== localIdentity;

export const hasSyncStateReset = (
  local: SyncCursorState,
  remote: RemoteSyncCursorState,
) => hasSyncCursorRewound(local.cursor, remote.serverCursor)
  || hasSyncIdentityChanged(local.syncIdentity, remote.syncIdentity);

export const isSyncMetadataInitialized = (
  cursorValue: string | null | undefined,
  identityValue: string | null | undefined,
) => Boolean(identityValue?.trim())
  && typeof cursorValue === "string"
  && cursorValue.trim().length > 0
  && Number.isFinite(Number(cursorValue));

export const splitSyncBootstrapWriteBatches = <T>(
  items: readonly T[],
  batchSize: number,
): T[][] => {
  const normalizedBatchSize = Math.max(1, Math.floor(batchSize));
  if (items.length === 0) {
    return [[]];
  }
  return Array.from(
    { length: Math.ceil(items.length / normalizedBatchSize) },
    (_, index) => items.slice(index * normalizedBatchSize, (index + 1) * normalizedBatchSize),
  );
};
