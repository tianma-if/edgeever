import type { Notebook } from "@edgeever/shared";
import { localDb, type SyncQueueItem } from "@/lib/local-db";

// Keep notebook mappings separate from the memo mappings observed by editors.
const mappingPrefix = "notebook-id:";
export const notebookRemapTables = [localDb.syncQueue, localDb.syncMeta, localDb.notebooks, localDb.memos];

const notebookReferences = (item: SyncQueueItem) => {
  const payload = item.payload as Record<string, unknown>;
  return [payload.notebookId, payload.parentId,
    ...(Array.isArray(payload.notebookIds) ? payload.notebookIds : []),
    ...(item.kind.startsWith("notebook.") && item.kind !== "notebook.create" ? [item.memoId] : []),
  ].filter((id): id is string => typeof id === "string");
};

export const hasTemporaryNotebookDependency = (item: SyncQueueItem) =>
  notebookReferences(item).some((id) => id.startsWith("local_"));

// Called inside a transaction, including the create acknowledgement when present.
const rewriteNotebookReferences = async (scope: string, temporaryId: string, remoteId: string) => {
  for (const item of await localDb.syncQueue.toArray()) {
    if (item.scope !== scope || item.status === "syncing" || !notebookReferences(item).includes(temporaryId)) continue;
    const payload = { ...item.payload } as Record<string, unknown>;
    for (const field of ["notebookId", "parentId"]) {
      if (payload[field] === temporaryId) payload[field] = remoteId;
    }
    if (Array.isArray(payload.notebookIds)) {
      payload.notebookIds = payload.notebookIds.map((id) => id === temporaryId ? remoteId : id);
    }
    await localDb.syncQueue.put({
      ...item,
      memoId: item.kind.startsWith("notebook.") && item.memoId === temporaryId ? remoteId : item.memoId,
      payload,
      // Dependency errors can retry immediately; preserve genuine conflicts.
      ...(item.status === "error" ? {
        status: "pending" as const, nextAttemptAt: null, lastError: null,
        lastErrorCode: null, lastErrorDetails: null, claimId: null,
      } : {}),
    });
  }
  await localDb.memos.where("scope").equals(scope).filter((memo) => memo.notebookId === temporaryId)
    .modify((memo) => { memo.notebookId = remoteId; });
  await localDb.notebooks.where("scope").equals(scope).filter((notebook) => notebook.parentId === temporaryId)
    .modify({ parentId: remoteId });
};

export const acknowledgeNotebookId = async (scope: string, temporaryId: string, notebook: Notebook) => {
  if (temporaryId === notebook.id) return;
  await localDb.syncMeta.put({
    scope, key: `${mappingPrefix}${temporaryId}`, value: notebook.id, updatedAt: new Date().toISOString(),
  });
  await rewriteNotebookReferences(scope, temporaryId, notebook.id);
  await localDb.notebooks.delete([scope, temporaryId]);
  await localDb.notebooks.put({ ...notebook, scope });
};

// Replay persisted mappings after reload, including writes from a stale UI/tab.
export const repairQueuedNotebookReferences = async (scope?: string, itemId?: string) => {
  await localDb.transaction("rw", notebookRemapTables, async () => {
    const item = itemId ? await localDb.syncQueue.get(itemId) : undefined;
    if (itemId && (!item || !hasTemporaryNotebookDependency(item))) return;
    const queued = item ? [item] : await localDb.syncQueue.toArray();
    const references = new Set(queued
      .filter((entry) => !scope || entry.scope === scope)
      .flatMap((entry) => notebookReferences(entry)
        .filter((id) => id.startsWith("local_"))
        .map((id) => JSON.stringify([entry.scope, id]))));
    if (references.size === 0) return;
    const mappings = scope
      ? await localDb.syncMeta.where("scope").equals(scope).toArray()
      : await localDb.syncMeta.toArray();
    for (const mapping of mappings) {
      if (!mapping.key.startsWith(mappingPrefix)) continue;
      const temporaryId = mapping.key.slice(mappingPrefix.length);
      if (!references.has(JSON.stringify([mapping.scope, temporaryId]))) continue;
      await rewriteNotebookReferences(mapping.scope, temporaryId, mapping.value);
    }
  });
};
