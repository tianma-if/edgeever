import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiRequestError, type createEdgeEverClient } from "@edgeever/client";
import {
  createEmptySyncQueueSummary,
  createEmptySyncRunResult,
  formatLocalDraftClipboardText,
  getNextSyncQueueRetryDelay,
  getSyncRetryAt,
  isMemoSyncBaseCurrent,
  summarizeSyncQueue,
  type MemoDetail,
  type SyncQueueSummary,
  type SyncRunResult,
} from "@edgeever/shared";
import { readMobileMemoDraft } from "./mobile-drafts";

const LEGACY_SYNC_QUEUE_KEY = "edgeever.mobile.syncQueue.v1";
const SYNC_QUEUE_KEY_PREFIX = "edgeever.mobile.syncQueue.v2";

export type MobileMemoUpdateSyncPayload = {
  memoId: string;
  expectedRevision: number;
  expectedContentHash: string;
  title: string;
  contentMarkdown: string;
  notebookId: string;
  tags: string[];
};

export type MobileMemoCreateSyncPayload = {
  memoId: string;
  title: string;
  contentMarkdown: string;
  notebookId: string;
  tags: string[];
  createdAt: string;
};

type MobileSyncQueueItemBase = {
  id: string;
  memoId: string;
  status: "pending" | "syncing" | "conflict" | "error";
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type MobileMemoUpdateSyncQueueItem = MobileSyncQueueItemBase & {
  kind: "memo.update";
  payload: MobileMemoUpdateSyncPayload;
};

export type MobileMemoCreateSyncQueueItem = MobileSyncQueueItemBase & {
  kind: "memo.create";
  payload: MobileMemoCreateSyncPayload;
};

export type MobileSyncQueueItem = MobileMemoUpdateSyncQueueItem | MobileMemoCreateSyncQueueItem;

let syncQueueWriteChain: Promise<void> = Promise.resolve();

export type MobileSyncQueueSummary = SyncQueueSummary;
export type MobileSyncRunResult = SyncRunResult;

export const emptyMobileSyncQueueSummary = createEmptySyncQueueSummary;

export const getMobileMemoUpdateQueueId = (memoId: string) => `memo.update:${memoId}`;
export const getMobileMemoCreateQueueId = (memoId: string) => `memo.create:${memoId}`;

export const queueMobileMemoCreate = async (scope: string, payload: MobileMemoCreateSyncPayload) => {
  const now = new Date().toISOString();
  const id = getMobileMemoCreateQueueId(payload.memoId);
  await mutateMobileSyncQueue(scope, (items) => {
    const existing = items.find((item) => item.id === id);
    const nextItem: MobileMemoCreateSyncQueueItem = {
      id,
      kind: "memo.create",
      memoId: payload.memoId,
      status: "pending",
      payload,
      attemptCount: existing?.attemptCount ?? 0,
      lastError: null,
      nextAttemptAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };
    return [nextItem, ...items.filter((item) => item.id !== id)];
  });
  return summarizeMobileSyncQueue(await readMobileSyncQueue(scope));
};

export const queueMobileMemoUpdate = async (scope: string, payload: MobileMemoUpdateSyncPayload) => {
  const now = new Date().toISOString();
  const id = getMobileMemoUpdateQueueId(payload.memoId);
  await mutateMobileSyncQueue(scope, (items) => {
    const pendingCreate = items.find((item): item is MobileMemoCreateSyncQueueItem => item.kind === "memo.create" && item.memoId === payload.memoId);
    if (pendingCreate) {
      return items.map((item) => item.id === pendingCreate.id ? {
        ...pendingCreate,
        status: "pending",
        payload: {
          ...pendingCreate.payload,
          title: payload.title,
          contentMarkdown: payload.contentMarkdown,
          notebookId: payload.notebookId,
          tags: payload.tags,
        },
        lastError: null,
        nextAttemptAt: null,
        updatedAt: now,
        version: pendingCreate.version + 1,
      } : item);
    }
    const existing = items.find((item) => item.id === id);
    const nextItem: MobileMemoUpdateSyncQueueItem = {
      id,
      kind: "memo.update",
      memoId: payload.memoId,
      status: "pending",
      payload,
      attemptCount: existing?.attemptCount ?? 0,
      lastError: null,
      nextAttemptAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };

    return [nextItem, ...items.filter((item) => item.id !== id)];
  });
  return summarizeMobileSyncQueue(await readMobileSyncQueue(scope));
};

export const loadMobileSyncQueueSummary = async (scope: string) => summarizeMobileSyncQueue(await readMobileSyncQueue(scope));

export const getMobileSyncRetryDelay = async (scope: string) =>
  getNextSyncQueueRetryDelay(await readMobileSyncQueue(scope));

export const listMobileSyncQueueItems = async (scope: string) =>
  (await readMobileSyncQueue(scope)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const deleteMobileSyncQueueItem = async (scope: string, id: string) => {
  await removeMobileSyncQueueItem(scope, id);
  return loadMobileSyncQueueSummary(scope);
};

/** Drop a successful online update so a stale outbox entry cannot re-apply older content. */
export const clearMobileMemoUpdateQueueItem = async (scope: string, memoId: string) => {
  await removeMobileSyncQueueItem(scope, getMobileMemoUpdateQueueId(memoId));
  return loadMobileSyncQueueSummary(scope);
};

/**
 * Clear backoff so the next sync pass retries immediately.
 * Conflict items stay conflicted until the user resolves them.
 */
export const armMobileSyncQueueImmediateRetry = async (scope: string) => {
  const now = new Date().toISOString();
  await mutateMobileSyncQueue(scope, (items) =>
    items.map((item) => {
      if (item.status === "conflict") {
        return item;
      }
      if (item.status === "pending" || item.status === "error" || item.status === "syncing") {
        return {
          ...item,
          status: "pending",
          nextAttemptAt: null,
          updatedAt: now,
        };
      }
      return item;
    })
  );
  return loadMobileSyncQueueSummary(scope);
};

export const markMobileMemoUpdateConflict = async (scope: string, memoId: string, lastError: string) => {
  const id = getMobileMemoUpdateQueueId(memoId);
  const now = new Date().toISOString();
  await mutateMobileSyncQueue(scope, (items) =>
    items.map((item) => {
      if (item.id !== id && !(item.kind === "memo.create" && item.memoId === memoId)) {
        return item;
      }
      return {
        ...item,
        status: "conflict",
        lastError,
        nextAttemptAt: null,
        updatedAt: now,
      };
    })
  );
  return loadMobileSyncQueueSummary(scope);
};

export const markMobileMemoUpdateError = async (scope: string, memoId: string, lastError: string) => {
  const id = getMobileMemoUpdateQueueId(memoId);
  const now = new Date().toISOString();
  await mutateMobileSyncQueue(scope, (items) =>
    items.map((item) => {
      if (item.id !== id && !(item.kind === "memo.create" && item.memoId === memoId)) {
        return item;
      }
      return {
        ...item,
        status: "error",
        lastError,
        nextAttemptAt: null,
        updatedAt: now,
      };
    })
  );
  return loadMobileSyncQueueSummary(scope);
};

export const getMobileSyncErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Sync failed";

export const isMobileSyncConflictError = (error: unknown) => {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }
  if (error.status === 409) {
    return true;
  }
  const code = (error.code ?? "").toLowerCase();
  return code.includes("conflict");
};

/** Drop every create/update queue entry for a memo (used when discarding local-only notes). */
export const cancelMobileMemoQueueItems = async (scope: string, memoId: string) => {
  await mutateMobileSyncQueue(scope, (items) => items.filter((item) => item.memoId !== memoId));
  return loadMobileSyncQueueSummary(scope);
};

/**
 * Discard a single note's conflicted local queue item and return the
 * authoritative cloud memo so the UI can rehydrate cleanly.
 */
export const discardMobileMemoConflict = async (
  client: ReturnType<typeof createEdgeEverClient>,
  scope: string,
  memoId: string,
) => {
  const remote = await client.getMemo(memoId, { includeDeleted: true });
  const queueId = getMobileMemoUpdateQueueId(memoId);
  const items = await readMobileSyncQueue(scope);

  for (const item of items) {
    if (item.memoId !== memoId) {
      continue;
    }
    if (item.id === queueId || item.status === "conflict") {
      await removeMobileSyncQueueItem(scope, item.id);
    }
  }

  return remote.memo;
};

/** Resolve the best local draft snapshot to copy when a conflict is shown. */
export const getMobileConflictDraftClipboardText = async (scope: string, memoId: string) => {
  const [queued, draft] = await Promise.all([
    readMobileSyncQueue(scope).then((items) =>
      items.find((item) => item.memoId === memoId && item.kind === "memo.update")
    ),
    readMobileMemoDraft(memoId),
  ]);

  if (queued && queued.kind === "memo.update") {
    return formatLocalDraftClipboardText({
      title: queued.payload.title,
      tags: queued.payload.tags,
      contentMarkdown: queued.payload.contentMarkdown,
    });
  }

  if (draft) {
    return formatLocalDraftClipboardText({
      title: draft.title,
      tags: draft.tagsText
        .split(/[,，]/u)
        .map((tag) => tag.trim())
        .filter(Boolean),
      contentMarkdown: draft.contentMarkdown,
    });
  }

  return null;
};

export const syncMobileQueuedChanges = async (
  client: ReturnType<typeof createEdgeEverClient>,
  scope: string,
  options: {
    force?: boolean;
    onSynced?: (memo: MemoDetail, item: MobileSyncQueueItem) => void | Promise<void>;
  } = {}
): Promise<MobileSyncRunResult> => {
  if (options.force) {
    await armMobileSyncQueueImmediateRetry(scope);
  }

  const result = createEmptySyncRunResult();
  const now = new Date();
  const items = (await readMobileSyncQueue(scope))
    .filter((item) => item.status === "pending" || item.status === "error" || item.status === "syncing")
    .filter((item) => options.force || !item.nextAttemptAt || new Date(item.nextAttemptAt) <= now)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  for (const item of items) {
    const itemVersion = item.version ?? 1;
    result.attempted += 1;
    await updateMobileSyncQueueItem(scope, item.id, {
      status: "syncing",
      updatedAt: new Date().toISOString(),
    }, itemVersion);

    try {
      const memo = await syncMobileQueueItem(client, item);
      const removed = await removeMobileSyncQueueItem(scope, item.id, itemVersion);

      if (removed) {
        await options.onSynced?.(memo, item);
      } else if (item.kind === "memo.create") {
        const promoted = await promoteQueuedMemoCreate(scope, item.id, itemVersion, memo);
        if (promoted) {
          await options.onSynced?.(memo, item);
        } else {
          // User cancelled the offline create while it was in flight. The local
          // row is already gone; soft-delete the remote orphan so it does not
          // reappear on the next mirror sync.
          try {
            await client.deleteMemo(memo.id, { permanent: false });
          } catch {
            // Best-effort cleanup; a later full sync can still reconcile.
          }
        }
      } else {
        await rebaseQueuedMemoUpdate(scope, item.id, itemVersion, memo);
      }
      result.synced += 1;
    } catch (error) {
      const status = isMobileSyncConflictError(error) ? "conflict" : "error";
      const attemptCount = item.attemptCount + 1;

      await updateMobileSyncQueueItem(scope, item.id, {
        status,
        attemptCount,
        lastError: getMobileSyncErrorMessage(error),
        nextAttemptAt: status === "error" ? getSyncRetryAt(attemptCount) : null,
        updatedAt: new Date().toISOString(),
      }, itemVersion);

      if (status === "conflict") {
        result.conflicted += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  return result;
};

export const shouldQueueMobileMemoSaveError = (error: unknown) => {
  if (error instanceof ApiRequestError) {
    return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
  }

  const message = getMobileSyncErrorMessage(error).toLowerCase();
  return error instanceof TypeError
    || message.includes("network")
    || message.includes("failed to fetch")
    || message.includes("network request failed")
    || message.includes("timeout");
};

const syncMobileQueueItem = async (client: ReturnType<typeof createEdgeEverClient>, item: MobileSyncQueueItem) => {
  if (item.kind === "memo.create") {
    const response = await client.createMemo({
      notebookId: item.payload.notebookId,
      title: item.payload.title,
      contentMarkdown: item.payload.contentMarkdown,
      tags: item.payload.tags,
      createdAt: item.payload.createdAt,
      updatedAt: item.updatedAt,
    });
    return response.memo;
  }

  const { editSession } = await client.createMemoEditSession(item.memoId);

  if (!isMemoSyncBaseCurrent(
    { revision: editSession.baseRevision, contentHash: editSession.baseContentHash },
    item.payload,
  )) {
    throw new ApiRequestError("Note changed before the offline draft could sync.", 409, "revision_conflict");
  }

  const response = await client.updateMemo(item.memoId, {
    expectedRevision: item.payload.expectedRevision,
    expectedContentHash: item.payload.expectedContentHash,
    editSessionId: editSession.id,
    title: item.payload.title,
    contentMarkdown: item.payload.contentMarkdown,
    notebookId: item.payload.notebookId,
    tags: item.payload.tags,
  });

  return response.memo;
};

const readMobileSyncQueue = async (scope: string): Promise<MobileSyncQueueItem[]> => {
  const storageKey = getSyncQueueStorageKey(scope);
  let rawValue = await AsyncStorage.getItem(storageKey);

  if (!rawValue) {
    const legacyValue = await AsyncStorage.getItem(LEGACY_SYNC_QUEUE_KEY);
    if (legacyValue) {
      rawValue = legacyValue;
      await AsyncStorage.setItem(storageKey, legacyValue);
      await AsyncStorage.removeItem(LEGACY_SYNC_QUEUE_KEY);
    }
  }

  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.filter(isMobileSyncQueueItem) : [];
  } catch {
    return [];
  }
};

const writeMobileSyncQueue = (scope: string, items: MobileSyncQueueItem[]) =>
  AsyncStorage.setItem(getSyncQueueStorageKey(scope), JSON.stringify(items));

const updateMobileSyncQueueItem = async (scope: string, id: string, patch: Partial<MobileSyncQueueItemBase>, expectedVersion?: number) => {
  let updated = false;
  await mutateMobileSyncQueue(scope, (items) =>
    items.map((item) => {
      if (item.id !== id || (expectedVersion !== undefined && (item.version ?? 1) !== expectedVersion)) {
        return item;
      }

      updated = true;
      return { ...item, ...patch };
    })
  );
  return updated;
};

const removeMobileSyncQueueItem = async (scope: string, id: string, expectedVersion?: number) => {
  let removed = false;
  await mutateMobileSyncQueue(scope, (items) =>
    items.filter((item) => {
      if (item.id !== id || (expectedVersion !== undefined && (item.version ?? 1) !== expectedVersion)) {
        return true;
      }

      removed = true;
      return false;
    })
  );
  return removed;
};

const rebaseQueuedMemoUpdate = async (scope: string, id: string, syncedVersion: number, memo: MemoDetail) => {
  await mutateMobileSyncQueue(scope, (items) =>
    items.map((item) => {
      if (item.id !== id || item.kind !== "memo.update" || (item.version ?? 1) <= syncedVersion) {
        return item;
      }

      return {
        ...item,
        payload: {
          ...item.payload,
          expectedRevision: memo.revision,
          expectedContentHash: memo.contentHash,
        },
        status: "pending",
        lastError: null,
        nextAttemptAt: null,
        updatedAt: new Date().toISOString(),
      };
    })
  );
};

const promoteQueuedMemoCreate = async (
  scope: string,
  id: string,
  syncedVersion: number,
  memo: MemoDetail
): Promise<boolean> => {
  let promoted = false;
  await mutateMobileSyncQueue(scope, (items) => {
    const current = items.find((item) => item.id === id);
    if (!current || current.kind !== "memo.create" || current.version <= syncedVersion) {
      return items;
    }
    promoted = true;
    const now = new Date().toISOString();
    const promotedItem: MobileMemoUpdateSyncQueueItem = {
      id: getMobileMemoUpdateQueueId(memo.id),
      kind: "memo.update",
      memoId: memo.id,
      status: "pending",
      payload: {
        memoId: memo.id,
        expectedRevision: memo.revision,
        expectedContentHash: memo.contentHash,
        title: current.payload.title,
        contentMarkdown: current.payload.contentMarkdown,
        notebookId: current.payload.notebookId,
        tags: current.payload.tags,
      },
      attemptCount: 0,
      lastError: null,
      nextAttemptAt: null,
      createdAt: current.createdAt,
      updatedAt: now,
      version: 1,
    };
    return [promotedItem, ...items.filter((item) => item.id !== id && item.id !== promotedItem.id)];
  });
  return promoted;
};

const mutateMobileSyncQueue = async (scope: string, mutate: (items: MobileSyncQueueItem[]) => MobileSyncQueueItem[]) => {
  const operation = syncQueueWriteChain.then(async () => {
    const items = await readMobileSyncQueue(scope);
    await writeMobileSyncQueue(scope, mutate(items));
  });

  syncQueueWriteChain = operation.catch(() => undefined);
  await operation;
};

const getSyncQueueStorageKey = (scope: string) => `${SYNC_QUEUE_KEY_PREFIX}:${encodeURIComponent(scope.trim().toLowerCase())}`;

const summarizeMobileSyncQueue = (items: MobileSyncQueueItem[]) =>
  summarizeSyncQueue(items);

const isMobileSyncQueueItem = (value: unknown): value is MobileSyncQueueItem => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<MobileSyncQueueItem>;
  return (item.kind === "memo.update" || item.kind === "memo.create") && typeof item.id === "string" && typeof item.memoId === "string" && Boolean(item.payload);
};

