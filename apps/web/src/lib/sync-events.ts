import type { MemoDetail } from "@edgeever/shared";

export const SYNC_QUEUE_CHANGED_EVENT = "edgeever:sync-queue-changed";
export const SYNC_QUEUE_DEFERRED_EVENT = "edgeever:sync-queue-deferred";
export const MEMO_ID_REMAPPED_EVENT = "edgeever:memo-id-remapped";
export const MEMO_SYNC_ACKNOWLEDGED_EVENT = "edgeever:memo-sync-acknowledged";

export const notifySyncQueueChanged = () => {
  window.dispatchEvent(new CustomEvent(SYNC_QUEUE_CHANGED_EVENT));
};

export const notifySyncQueueDeferred = () => {
  window.dispatchEvent(new CustomEvent(SYNC_QUEUE_DEFERRED_EVENT));
};

export const notifyMemoIdRemapped = (memoIdMappings: ReadonlyMap<string, string>) => {
  if (memoIdMappings.size === 0) return;
  window.dispatchEvent(new CustomEvent(MEMO_ID_REMAPPED_EVENT, { detail: memoIdMappings }));
};

export const notifyMemoSyncAcknowledged = (memo: MemoDetail) => {
  window.dispatchEvent(new CustomEvent(MEMO_SYNC_ACKNOWLEDGED_EVENT, { detail: memo }));
};
