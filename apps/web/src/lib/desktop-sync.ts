import {
  getMemoSyncBaseConflictDetails,
  isMemoSyncBaseCurrent,
  type DesktopOutboxItem,
  type DesktopRpcParams,
  type DesktopRpcResponses,
  type SyncBootstrapResponse,
  type SyncChangesResponse,
  type TiptapDoc,
} from "@edgeever/shared";
import { api, ApiRequestError } from "@/lib/api";
import { isDesktopResourceRuntime } from "@/lib/desktop-resources";
import { notifyMemoIdRemapped, notifyMemoSyncAcknowledged } from "@/lib/sync-events";

type StagedResourceRewrite = { memoId: string; placeholder: string; url: string };
let lastSyncFailed = false;

const STAGED_RESOURCE_ID_CHARACTER = /[A-Za-z0-9_-]/;

const stringReferencesStagedResource = (value: string, placeholder: string) => {
  let index = value.indexOf(placeholder);
  while (index >= 0) {
    const nextCharacter = value[index + placeholder.length];
    if (!nextCharacter || !STAGED_RESOURCE_ID_CHARACTER.test(nextCharacter)) return true;
    index = value.indexOf(placeholder, index + placeholder.length);
  }
  return false;
};

const valueReferencesStagedResource = (value: unknown, placeholder: string): boolean => {
  if (typeof value === "string") return stringReferencesStagedResource(value, placeholder);
  if (Array.isArray(value)) return value.some((item) => valueReferencesStagedResource(item, placeholder));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => valueReferencesStagedResource(item, placeholder));
  }
  return false;
};

export const isStagedResourceReferenced = (payloads: unknown[], stagedId: string) => {
  const placeholder = `edgeever-staged://${stagedId}`;
  return payloads.some((payload) => valueReferencesStagedResource(payload, placeholder));
};

const remapStagedResourceMemoIds = async (memoIdMappings: ReadonlyMap<string, string>) => {
  if (memoIdMappings.size === 0) return;
  // Keep sync compatible with a renderer hot-reload or an older native shell
  // that does not expose the new remapping IPC yet.
  await window.edgeeverDesktop?.remapStagedResourceMemoIds?.([...memoIdMappings]);
};

const syncStagedResources = async (memoIdMappings: Map<string, string>) => {
  if (!isDesktopResourceRuntime() || (typeof navigator !== "undefined" && !navigator.onLine)) return { attempted: 0, synced: 0, failed: 0, rewrites: [] as StagedResourceRewrite[], stagedIds: [] as string[] };
  const staged = await window.edgeeverDesktop!.listStagedResources();
  const pending = await request("sync.outbox.list", { limit: 200 });
  const pendingPayloads = pending.items.map((item) => item.payload);
  let synced = 0;
  let failed = 0;
  const rewrites: StagedResourceRewrite[] = [];
  const stagedIds: string[] = [];
  for (const item of staged) {
    // An image can finish staging before the editor's debounced local save
    // has queued the memo update that references it. Uploading and deleting
    // the staged file in that gap leaves the memo with an unrecoverable
    // edgeever-staged:// URL. Keep it durable until an outbox payload proves
    // that the note content containing the placeholder has been saved.
    if (!isStagedResourceReferenced(pendingPayloads, item.id)) continue;
    try {
      const stored = await window.edgeeverDesktop!.readStagedResource(item.id);
      const memoId = memoIdMappings.get(item.memoId) ?? item.memoId;
      const uploaded = await api.uploadMemoResource(memoId, new File([stored.bytes as unknown as ArrayBuffer], stored.name, { type: stored.type }));
      await window.edgeeverDesktop!.sidecarRequest("resource.cache", { resource: uploaded.resource });
      rewrites.push({ memoId, placeholder: `edgeever-staged://${item.id}`, url: uploaded.resource.url });
      stagedIds.push(item.id);
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  try {
    await patchCreatedMemoResources(rewrites);
  } catch {
    // Keep the staged files and rewritten outbox payloads recoverable. A later
    // sync can retry the remote patch without losing the local attachment.
    failed += rewrites.length > 0 ? 1 : 0;
  }
  return { attempted: staged.length, synced, failed, rewrites, stagedIds };
};

const removeSyncedStagedResources = async (stagedIds: string[]) => {
  for (const id of stagedIds) {
    try {
      await window.edgeeverDesktop!.removeStagedResource(id);
    } catch {
      // The uploaded resource and the local memo are already durable; a later
      // pass can remove this harmless orphan from the staging directory.
    }
  }
};

export const rewriteStagedResource = (value: unknown, rewrites: StagedResourceRewrite[]): unknown => {
  if (typeof value === "string") {
    return rewrites.reduce((current, rewrite) => current.split(rewrite.placeholder).join(rewrite.url), value);
  }
  if (Array.isArray(value)) return value.map((item) => rewriteStagedResource(item, rewrites));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteStagedResource(item, rewrites)]));
  }
  return value;
};

const patchCreatedMemoResources = async (rewrites: StagedResourceRewrite[]) => {
  const memoIds = [...new Set(rewrites.map((rewrite) => rewrite.memoId))];
  if (memoIds.length === 0) return;

  const pending = await request("sync.outbox.list", { limit: 200 });
  const pendingUpdates = new Set(
    pending.items
      .filter((item) => item.kind === "memo.update")
      .map((item) => String(item.payload.memoId ?? item.entityId)),
  );

  for (const memoId of memoIds) {
    // A queued edit will carry the rewritten URLs through syncOutbox. Patching
    // here as well would advance the revision and turn that edit into a false
    // conflict, so only patch creates that have no later local edit.
    if (pendingUpdates.has(memoId)) continue;

    const remote = await api.getMemo(memoId, { includeDeleted: true });
    const memoRewrites = rewrites.filter((rewrite) => rewrite.memoId === memoId);
    const contentJson = rewriteStagedResource(remote.memo.contentJson, memoRewrites) as TiptapDoc;
    const contentMarkdown = rewriteStagedResource(remote.memo.contentMarkdown, memoRewrites);
    if (JSON.stringify(contentJson) === JSON.stringify(remote.memo.contentJson) && contentMarkdown === remote.memo.contentMarkdown) continue;

    const editSession = (await api.createMemoEditSession(memoId)).editSession;
    const updated = await api.updateMemo(memoId, {
      expectedRevision: editSession.baseRevision,
      expectedContentHash: editSession.baseContentHash,
      editSessionId: editSession.id,
      contentJson,
      contentMarkdown: typeof contentMarkdown === "string" ? contentMarkdown : undefined,
      title: remote.memo.title ?? "",
      tags: remote.memo.tags,
    });
    await request("sync.apply", {
      changes: [{ entityType: "memo", operation: "upsert", entityId: updated.memo.id, memo: updated.memo, notebook: null }],
    });
  }
};

const request = async <M extends keyof DesktopRpcResponses>(method: M, params: DesktopRpcParams[M]) => {
  const bridge = window.edgeeverDesktop;
  if (!bridge?.isAvailable) throw new Error("EdgeEver desktop bridge is unavailable");
  return bridge.sidecarRequest<DesktopRpcResponses[M]>(method, params);
};

const applyRemoteNotebook = async (notebook: DesktopRpcResponses["notebook.list"]["notebooks"][number]) => {
  await request("sync.apply", {
    changes: [{ entityType: "notebook", operation: "upsert", entityId: notebook.id, notebook, memo: null }],
  });
};

export const resolveDesktopMemoSyncBase = (
  current: { revision: number; contentHash: string },
  expected: { expectedRevision: number; expectedContentHash: string },
) => {
  // Older desktop clients advanced the cached cloud revision for every local
  // autosave. A base ahead of the actual server is therefore a local counter,
  // not evidence of a concurrent remote edit. Rebase that impossible state so
  // existing drafts recover automatically. Bases behind the server remain
  // conflicts and keep the normal adopt-cloud/copy-draft protection.
  if (expected.expectedRevision > current.revision) {
    return {
      expectedRevision: current.revision,
      expectedContentHash: current.contentHash,
    };
  }
  return expected;
};

const acknowledge = async (
  item: DesktopOutboxItem,
  remoteMemo?: DesktopRpcResponses["memo.get"]["memo"],
  remoteNotebook?: DesktopRpcResponses["notebook.list"]["notebooks"][number],
  remoteTemplate?: DesktopRpcResponses["template.list"]["templates"][number],
) => {
  if (remoteNotebook) await applyRemoteNotebook(remoteNotebook);
  await request("sync.outbox.ack", { id: item.id, version: item.version, remoteMemo, remoteNotebook, remoteTemplate });
};

const syncOutboxItem = async (item: DesktopOutboxItem, stagedRewrites: StagedResourceRewrite[]) => {
  const payload = stagedRewrites.length > 0
    ? rewriteStagedResource(item.payload, stagedRewrites.filter((rewrite) => rewrite.memoId === String(item.payload.memoId ?? item.entityId))) as Record<string, unknown>
    : item.payload;
  if (item.kind === "memo.create") {
    const data = await api.createMemo({
      notebookId: String(payload.notebookId),
      title: String(payload.title ?? ""),
      contentMarkdown: typeof payload.contentMarkdown === "string" ? payload.contentMarkdown : undefined,
      tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string") : [],
      createdAt: typeof payload.createdAt === "string" ? payload.createdAt : undefined,
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : undefined,
    });
    await acknowledge(item, data.memo);
    return data.memo;
  }

  if (item.kind === "memo.update") {
    const memoId = String(payload.memoId ?? item.entityId);
    const editSessionResponse = await api.createMemoEditSession(memoId);
    const editSession = editSessionResponse.editSession;
    const queuedBase = {
      expectedRevision: Number(payload.expectedRevision),
      expectedContentHash: String(payload.expectedContentHash ?? ""),
    };
    const currentBase = { revision: editSession.baseRevision, contentHash: editSession.baseContentHash };
    const expectedBase = resolveDesktopMemoSyncBase(currentBase, queuedBase);
    if (!isMemoSyncBaseCurrent(currentBase, expectedBase)) {
      throw new ApiRequestError(
        "Note changed before the offline draft could sync.",
        409,
        "revision_conflict",
        getMemoSyncBaseConflictDetails(currentBase, expectedBase),
      );
    }
    const data = await api.updateMemo(memoId, {
      expectedRevision: expectedBase.expectedRevision,
      expectedContentHash: expectedBase.expectedContentHash,
      editSessionId: editSession.id,
      title: String(payload.title ?? ""),
      contentJson: payload.contentJson as TiptapDoc,
      contentMarkdown: typeof payload.contentMarkdown === "string" ? payload.contentMarkdown : undefined,
      tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string") : [],
    });
    await acknowledge(item, data.memo);
    return data.memo;
  }

  if (item.kind === "memo.delete") {
    await api.deleteMemo(String(payload.memoId ?? item.entityId), { permanent: Boolean(payload.permanent) });
    await acknowledge(item);
    return null;
  }

  if (item.kind === "memo.deleteBatch") {
    await api.deleteMemos({
      memoIds: Array.isArray(payload.memoIds) ? payload.memoIds.filter((memoId): memoId is string => typeof memoId === "string") : [],
      permanent: Boolean(payload.permanent),
    });
    await acknowledge(item);
    return null;
  }

  if (item.kind === "memo.emptyTrash") {
    await api.emptyTrash();
    await acknowledge(item);
    return null;
  }

  if (item.kind === "memo.pinBatch") {
    const memoIds = Array.isArray(payload.memoIds) ? payload.memoIds.filter((memoId): memoId is string => typeof memoId === "string") : [];
    await Promise.all(memoIds.map((memoId) => api.updateMemo(memoId, { isPinned: Boolean(payload.isPinned) })));
    await acknowledge(item);
    return null;
  }

  if (item.kind === "memo.merge") {
    const data = await api.mergeMemos({
      memoIds: Array.isArray(payload.memoIds) ? payload.memoIds.filter((memoId): memoId is string => typeof memoId === "string") : [],
      notebookId: typeof payload.notebookId === "string" ? payload.notebookId : undefined,
      title: typeof payload.title === "string" ? payload.title : undefined,
    });
    await acknowledge(item, data.memo);
    return data.memo;
  }

  if (item.kind === "notebook.create") {
    const data = await api.createNotebook({ name: String(payload.name ?? ""), parentId: typeof payload.parentId === "string" ? payload.parentId : null });
    await acknowledge(item, undefined, data.notebook);
    return null;
  }

  if (item.kind === "notebook.update") {
    const data = await api.updateNotebook(String(payload.notebookId ?? item.entityId), {
      name: typeof payload.name === "string" ? payload.name : undefined,
      parentId: Object.prototype.hasOwnProperty.call(payload, "parentId") ? (typeof payload.parentId === "string" ? payload.parentId : null) : undefined,
      sortOrder: typeof payload.sortOrder === "number" ? payload.sortOrder : undefined,
    });
    await acknowledge(item, undefined, data.notebook);
    return null;
  }

  if (item.kind === "notebook.delete") {
    await api.deleteNotebook(String(payload.notebookId ?? item.entityId));
    await acknowledge(item);
    return null;
  }

  if (item.kind === "notebook.restore") {
    const data = await api.restoreNotebook(String(payload.notebookId ?? item.entityId));
    await acknowledge(item, undefined, data.notebook);
    return null;
  }

  if (item.kind === "template.create") {
    const data = await api.createTemplate({
      name: String(payload.name ?? ""),
      description: typeof payload.description === "string" ? payload.description : null,
      title: typeof payload.title === "string" ? payload.title : null,
      contentMarkdown: typeof payload.contentMarkdown === "string" ? payload.contentMarkdown : "",
      tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string") : [],
    });
    await acknowledge(item, undefined, undefined, data.template);
    return null;
  }

  if (item.kind === "template.update") {
    const data = await api.updateTemplate(String(payload.templateId ?? item.entityId), {
      name: typeof payload.name === "string" ? payload.name : undefined,
      description: typeof payload.description === "string" ? payload.description : null,
      title: typeof payload.title === "string" ? payload.title : null,
      contentMarkdown: typeof payload.contentMarkdown === "string" ? payload.contentMarkdown : undefined,
      tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string") : [],
    });
    await acknowledge(item, undefined, undefined, data.template);
    return null;
  }

  if (item.kind === "template.delete") {
    await api.deleteTemplate(String(payload.templateId ?? item.entityId));
    await acknowledge(item);
    return null;
  }

  if (item.kind === "tag.rename") {
    await api.renameTag(String(payload.tag ?? item.entityId), String(payload.name ?? ""));
    await acknowledge(item);
    return null;
  }

  if (item.kind === "tag.delete") {
    await api.deleteTag(String(payload.tag ?? item.entityId));
    await acknowledge(item);
    return null;
  }

  if (item.kind === "memo.move") {
    await api.moveMemos({
      memoIds: Array.isArray(payload.memoIds) ? payload.memoIds.filter((memoId): memoId is string => typeof memoId === "string") : [],
      notebookId: String(payload.notebookId ?? ""),
    });
    await acknowledge(item);
    return null;
  }

  if (item.kind === "memo.restore") {
    await api.restoreMemo(String(payload.memoId ?? item.entityId));
    await acknowledge(item);
    return null;
  }

  throw new Error(`Unsupported desktop sync operation: ${item.kind}`);
};

const syncOutbox = async (stagedRewrites: StagedResourceRewrite[], onlyKinds?: Set<string>) => {
  let synced = 0;
  let failed = 0;
  let conflicted = 0;
  const response = await request("sync.outbox.list", { limit: 100 });
  const memoIdMappings = new Map<string, string>();
  const syncedMemos = new Map<string, DesktopRpcResponses["memo.get"]["memo"]>();
  for (const item of response.items) {
    if (onlyKinds && !onlyKinds.has(item.kind)) continue;
    try {
      const result = await syncOutboxItem(item, stagedRewrites);
      if (item.kind === "memo.create" && result && typeof result === "object" && "id" in result && typeof result.id === "string") {
        memoIdMappings.set(item.entityId, result.id);
        // Remap the live editor and advance its cloud base as soon as the
        // create is acknowledged. Waiting for the workspace-wide sync to end
        // leaves a window where the next autosave still sends revision 0.
        notifyMemoIdRemapped(new Map([[item.entityId, result.id]]));
      }
      if (result && typeof result === "object" && "id" in result && typeof result.id === "string" && "contentJson" in result) {
        const syncedMemo = result as DesktopRpcResponses["memo.get"]["memo"];
        syncedMemos.set(result.id, syncedMemo);
        notifyMemoSyncAcknowledged(syncedMemo);
      }
      synced += 1;
    } catch (error) {
      const conflict = error instanceof ApiRequestError
        && (error.code === "revision_conflict" || error.code === "content_conflict" || error.code === "edit_session_conflict");
      await request("sync.outbox.fail", { id: item.id, version: item.version, error: error instanceof Error ? error.message : String(error), conflict });
      if (conflict) conflicted += 1;
      else failed += 1;
    }
  }
  return { attempted: onlyKinds ? synced + failed + conflicted : response.items.length, synced, failed, conflicted, memoIdMappings, syncedMemos };
};

const applyBootstrap = async (page: SyncBootstrapResponse) => {
  const changes = [
    ...orderBootstrapNotebooks(page.notebooks).map((notebook) => ({ entityType: "notebook" as const, operation: "upsert" as const, entityId: notebook.id, notebook, memo: null })),
    ...page.memos.map((memo) => ({ entityType: "memo" as const, operation: "upsert" as const, entityId: memo.id, memo, notebook: null })),
  ];
  if (changes.length > 0) await request("sync.apply", { changes });
};

export const hasDesktopSyncStateReset = (
  local: { cursor: number; syncIdentity: string },
  remote: Pick<SyncChangesResponse, "serverCursor" | "syncIdentity">,
) => remote.serverCursor < local.cursor || Boolean(
  remote.syncIdentity && remote.syncIdentity !== local.syncIdentity,
);

export const orderBootstrapNotebooks = (notebooks: SyncBootstrapResponse["notebooks"]) => {
  const remaining = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  const ordered: SyncBootstrapResponse["notebooks"] = [];

  while (remaining.size > 0) {
    let added = 0;
    for (const [id, notebook] of remaining) {
      if (notebook.parentId && remaining.has(notebook.parentId)) continue;
      ordered.push(notebook);
      remaining.delete(id);
      added += 1;
    }
    if (added === 0) {
      ordered.push(...remaining.values());
      break;
    }
  }

  return ordered;
};

const bootstrapDesktopMirror = async (reset: boolean) => {
  await request("sync.bootstrap.prepare", reset ? { reset: true } : {});
  let afterId: string | null = null;
  let firstPage = true;
  let snapshotCursor = 0;
  let syncIdentity = "";
  do {
    const page = await api.syncBootstrap({ afterId, limit: 200 });
    if (firstPage) {
      snapshotCursor = page.snapshotCursor;
      syncIdentity = page.syncIdentity ?? "";
      firstPage = false;
    }
    await applyBootstrap(page);
    afterId = page.nextAfterId;
  } while (afterId);
  await request("sync.cursor.set", { cursor: snapshotCursor, syncIdentity });
};

const pullRemoteChanges = async () => {
  const status = await request("sync.status", {});
  if (!status.syncIdentity) {
    await bootstrapDesktopMirror(false);
    return;
  }

  let cursor = status.cursor;
  let response: SyncChangesResponse = await api.syncChanges({ cursor, limit: 200 });
  if (hasDesktopSyncStateReset({ cursor: status.cursor, syncIdentity: status.syncIdentity }, response)) {
    await bootstrapDesktopMirror(true);
    return;
  }
  while (response.changes.length > 0) {
    await request("sync.apply", { changes: response.changes });
    cursor = response.cursor;
    if (!response.hasMore) break;
    response = await api.syncChanges({ cursor, limit: 200 });
    if (hasDesktopSyncStateReset({ cursor, syncIdentity: status.syncIdentity }, response)) {
      await bootstrapDesktopMirror(true);
      return;
    }
  }
  await request("sync.cursor.set", { cursor: response.cursor ?? cursor, syncIdentity: response.syncIdentity ?? status.syncIdentity });
};

export type DesktopSyncResult = {
  attempted: number;
  synced: number;
  failed: number;
  conflicted: number;
  memoIdMappings: Map<string, string>;
  syncedMemos: Map<string, DesktopRpcResponses["memo.get"]["memo"]>;
};

export const mergeMemoIdMappings = (
  target: Map<string, string>,
  source: ReadonlyMap<string, string>,
) => {
  for (const [temporaryId, remoteId] of source) target.set(temporaryId, remoteId);
  return target;
};

export const mergeSyncedMemos = <T>(target: Map<string, T>, source: ReadonlyMap<string, T>) => {
  for (const [memoId, memo] of source) target.set(memoId, memo);
  return target;
};

let activeSync: Promise<DesktopSyncResult> | null = null;

export const syncDesktopData = () => {
  if (activeSync) return activeSync;
  activeSync = (async () => {
    const memoIdMappings = new Map<string, string>();
    const syncedMemos = new Map<string, DesktopRpcResponses["memo.get"]["memo"]>();
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { attempted: 0, synced: 0, failed: 0, conflicted: 0, memoIdMappings, syncedMemos };
    }
    try {
      const creates = await syncOutbox([], new Set(["memo.create"]));
      mergeMemoIdMappings(memoIdMappings, creates.memoIdMappings);
      mergeSyncedMemos(syncedMemos, creates.syncedMemos);
      await remapStagedResourceMemoIds(creates.memoIdMappings);
      const stagedResources = await syncStagedResources(creates.memoIdMappings);
      const outbox = await syncOutbox(stagedResources.rewrites);
      mergeMemoIdMappings(memoIdMappings, outbox.memoIdMappings);
      mergeSyncedMemos(syncedMemos, outbox.syncedMemos);
      if (stagedResources.failed === 0 && outbox.failed === 0 && outbox.conflicted === 0 && creates.conflicted === 0) {
        await removeSyncedStagedResources(stagedResources.stagedIds);
      }
      const remaining = await request("sync.status", {});
      if (remaining.pending === 0 && remaining.syncing === 0 && remaining.error === 0 && remaining.conflict === 0
        && (typeof navigator === "undefined" || navigator.onLine)) await pullRemoteChanges();
      // Catch resources staged while the network sync itself was running.
      await remapStagedResourceMemoIds(creates.memoIdMappings);
      lastSyncFailed = false;
      return {
        attempted: creates.attempted + outbox.attempted + stagedResources.attempted,
        synced: creates.synced + outbox.synced + stagedResources.synced,
        failed: creates.failed + outbox.failed + stagedResources.failed,
        conflicted: creates.conflicted + outbox.conflicted,
        memoIdMappings,
        syncedMemos,
      };
    } catch (error) {
      lastSyncFailed = true;
      console.error("[desktop-sync] Sync failed", error);
      // A create may already have been acknowledged before a later upload or
      // pull failed. Preserve its id mapping so the UI cannot keep editing an
      // obsolete temporary id merely because the overall sync was partial.
      return { attempted: 0, synced: 0, failed: 1, conflicted: 0, memoIdMappings, syncedMemos };
    }
  })().finally(() => { activeSync = null; });
  return activeSync;
};

export const getDesktopSyncSummary = async () => {
  const status = await request("sync.status", {});
  const error = status.error + (lastSyncFailed ? 1 : 0);
  return { total: status.pending + status.syncing + status.conflict + error, pending: status.pending, syncing: status.syncing, conflict: status.conflict, error };
};

export const discardDesktopConflicts = async () => {
  const response = await request("sync.outbox.list", { limit: 200, includeConflicts: true });
  const conflicts = response.items.filter((item) => item.status === "conflict");
  let discarded = 0;

  for (const item of conflicts) {
    if (item.kind === "memo.update") {
      // Replace the local conflicted draft with the authoritative remote memo
      // before removing the queue item. If the remote read fails, keep the
      // conflict so the user's local changes remain recoverable.
      const remote = await api.getMemo(item.entityId, { includeDeleted: true });
      await request("sync.apply", {
        changes: [{ entityType: "memo", operation: "upsert", entityId: remote.memo.id, memo: remote.memo, notebook: null }],
      });
      await request("sync.outbox.ack", { id: item.id, version: item.version, remoteMemo: remote.memo });
    } else {
      await request("sync.outbox.discard", { id: item.id });
    }
    discarded += 1;
  }

  return discarded;
};

/**
 * Discard a single note's conflicted desktop outbox item and replace the local
 * store with the authoritative cloud memo.
 */
export const discardDesktopMemoConflict = async (memoId: string) => {
  const remote = await api.getMemo(memoId, { includeDeleted: true });
  await request("sync.apply", {
    changes: [{ entityType: "memo", operation: "upsert", entityId: remote.memo.id, memo: remote.memo, notebook: null }],
  });

  const response = await request("sync.outbox.list", { limit: 200, includeConflicts: true });
  for (const item of response.items) {
    if (item.entityId !== memoId || item.status !== "conflict") {
      continue;
    }
    if (item.kind === "memo.update") {
      await request("sync.outbox.ack", { id: item.id, version: item.version, remoteMemo: remote.memo });
    } else {
      await request("sync.outbox.discard", { id: item.id });
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
  }
  return remote.memo;
};
