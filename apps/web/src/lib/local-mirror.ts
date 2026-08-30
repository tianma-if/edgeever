import {
  createExcerpt,
  docToMarkdown,
  docToText,
  hasSyncCursorRewound,
  hasSyncStateReset,
  markdownToDoc,
  mergeMemoDocs,
  resolveMemoContentDoc,
  resolveMergedMemoTitle,
  type MemoDetail,
  type MemoRevision,
  type MemoSummary,
  type MemoTemplate,
  type Notebook,
  type ResourceListItem,
  type TagSummary,
  type TiptapDoc,
} from "@edgeever/shared";
import { liveQuery } from "dexie";
import type { MemoFilterMode, MemoSortMode } from "@/lib/app-helpers";
import { api, type SyncChangesResponse } from "@/lib/api";
import { localDb, selectNewestLocalDraft, type LocalDraft, type LocalMemo, type LocalNotebook, type LocalResource, type LocalRevision } from "@/lib/local-db";
import { cacheLocalResourceBytes, localResourceUrl, removeCachedLocalResourceBytes } from "@/lib/local-resource-cache";
import { isBrowserOffline } from "@/lib/network-status";
import { parseTagsText } from "@/lib/utils";
import { createClientUuid } from "@/lib/client-id";

export type LocalMemoListParams = {
  notebookId?: string | null;
  notebookIds?: string[];
  q?: string;
  tag?: string;
  trash?: boolean;
  sort?: MemoSortMode;
  filter?: MemoFilterMode;
  limit?: number;
  offset?: number;
};

export type LocalMemoListResponse = {
  memos: MemoSummary[];
  totalCount: number;
  nextCursor: string | null;
};

const BOOTSTRAP_PAGE_SIZE = 200;
const CHANGE_PAGE_SIZE = 200;
const SYNC_CURSOR_KEY = "cursor";
const SYNC_IDENTITY_KEY = "identity";
const activeSyncs = new Map<string, Promise<{ bootstrapped: boolean; changed: number }>>();

export const createLocalDataScope = (baseUrl: string, userId?: string | null) =>
  `${baseUrl.trim().toLowerCase()}|${userId ?? "anonymous"}`;

const getMeta = async (scope: string, key: string) =>
  (await localDb.syncMeta.get([scope, key]))?.value ?? null;

export const hasLocalSyncCursorRewound = hasSyncCursorRewound;

export const isLocalMirrorInitialized = async (scope: string) => Boolean(await getMeta(scope, SYNC_IDENTITY_KEY));

export const hasLocalMirrorData = async (scope: string) =>
  (await localDb.memos.where("scope").equals(scope).count()) > 0 ||
  (await localDb.notebooks.where("scope").equals(scope).count()) > 0;

const setMeta = async (scope: string, key: string, value: string) => {
  await localDb.syncMeta.put({ scope, key, value, updatedAt: new Date().toISOString() });
};

const toSummary = (memo: MemoDetail): MemoSummary => ({
  id: memo.id,
  notebookId: memo.notebookId,
  title: memo.title,
  excerpt: memo.excerpt,
  tags: memo.tags,
  isPinned: memo.isPinned,
  isArchived: memo.isArchived,
  isDeleted: memo.isDeleted,
  revision: memo.revision,
  createdAt: memo.createdAt,
  updatedAt: memo.updatedAt,
  deletedAt: memo.deletedAt,
});

const replaceScope = async (scope: string, notebooks: Notebook[], memos: MemoDetail[]) => {
  await localDb.transaction("rw", [localDb.notebooks, localDb.memos, localDb.revisions, localDb.resources], async () => {
    const pendingLocalResources = (await localDb.resources.where("scope").equals(scope).toArray())
      .filter((resource) => resource.id.startsWith("local_resource_"));
    await localDb.notebooks.where("scope").equals(scope).delete();
    await localDb.memos.where("scope").equals(scope).delete();
    await localDb.revisions.where("scope").equals(scope).delete();
    await localDb.resources.where("scope").equals(scope).delete();
    await localDb.notebooks.bulkPut(notebooks.map((notebook) => ({ ...notebook, scope })));
    await localDb.memos.bulkPut(memos.map((memo) => ({ ...memo, scope })));
    await localDb.resources.bulkPut(pendingLocalResources);
  });
};

const applyChanges = async (scope: string, changes: SyncChangesResponse["changes"]) => {
  await localDb.transaction("rw", [localDb.notebooks, localDb.memos], async () => {
    for (const change of changes) {
      if (change.entityType === "memo") {
        if (change.operation === "delete" || !change.memo) {
          await localDb.memos.delete([scope, change.entityId]);
        } else {
          await localDb.memos.put({ ...change.memo, scope });
        }
        continue;
      }

      if (change.operation === "delete" || !change.notebook) {
        await localDb.notebooks.delete([scope, change.entityId]);
      } else {
        await localDb.notebooks.put({ ...change.notebook, scope });
      }
    }
  });
};

const bootstrapScope = async (scope: string) => {
  let afterId: string | null = null;
  let firstPage = true;
  let snapshotCursor = 0;
  let syncIdentity: string | undefined;
  const notebooks: Notebook[] = [];
  const memos: MemoDetail[] = [];

  do {
    const page = await api.syncBootstrap({ afterId, limit: BOOTSTRAP_PAGE_SIZE });
    if (firstPage) {
      snapshotCursor = page.snapshotCursor;
      syncIdentity = page.syncIdentity;
    }
    notebooks.push(...page.notebooks);
    memos.push(...page.memos);
    afterId = page.nextAfterId;
    firstPage = false;
  } while (afterId);

  await replaceScope(scope, notebooks, memos);
  await setMeta(scope, SYNC_CURSOR_KEY, String(snapshotCursor));
  if (syncIdentity) {
    await setMeta(scope, SYNC_IDENTITY_KEY, syncIdentity);
  }
  return memos.length;
};

const performSyncLocalMirror = async (scope: string) => {
  if (isBrowserOffline()) {
    return { bootstrapped: false, changed: 0 };
  }

  const storedCursor = Number(await getMeta(scope, SYNC_CURSOR_KEY));
  const cursor = Number.isFinite(storedCursor) ? storedCursor : null;
  const storedIdentity = await getMeta(scope, SYNC_IDENTITY_KEY);
  let changed = 0;

  if (cursor === null || !storedIdentity) {
    changed = await bootstrapScope(scope);
    return { bootstrapped: true, changed };
  }

  let currentCursor = cursor;
  let response = await api.syncChanges({ cursor: currentCursor, limit: CHANGE_PAGE_SIZE });

  if (hasSyncStateReset(
    { cursor: currentCursor, syncIdentity: storedIdentity },
    response,
  )) {
    // Restoring or clearing a server database can restart the change-log
    // sequence without replacing the workspace row. In that case the saved
    // browser cursor is ahead of the server and an incremental request looks
    // empty even though the IndexedDB mirror is stale. Rebuild from the
    // authoritative snapshot just as we do for a changed sync identity.
    changed = await bootstrapScope(scope);
    return { bootstrapped: true, changed };
  }

  while (response.changes.length > 0) {
    await applyChanges(scope, response.changes);
    changed += response.changes.length;
    currentCursor = response.cursor;
    await setMeta(scope, SYNC_CURSOR_KEY, String(currentCursor));
    if (!response.hasMore) break;
    response = await api.syncChanges({ cursor: currentCursor, limit: CHANGE_PAGE_SIZE });
  }

  if (response.syncIdentity) {
    await setMeta(scope, SYNC_IDENTITY_KEY, response.syncIdentity);
  }
  if (
    typeof response.serverCursor === "number"
    && response.serverCursor > currentCursor
    && response.changes.length === 0
  ) {
    await setMeta(scope, SYNC_CURSOR_KEY, String(response.cursor));
  }
  return { bootstrapped: false, changed };
};

export const syncLocalMirror = (scope: string) => {
  const active = activeSyncs.get(scope);
  if (active) return active;

  const operation = performSyncLocalMirror(scope).finally(() => {
    activeSyncs.delete(scope);
  });
  activeSyncs.set(scope, operation);
  return operation;
};

export const listLocalNotebooks = async (scope: string): Promise<{ notebooks: Notebook[] }> => {
  const notebooks = await localDb.notebooks.where("scope").equals(scope).toArray();
  const memos = await localDb.memos.where("scope").equals(scope).toArray();
  const activeMemos = memos.filter((memo) => !memo.isDeleted);
  const counts = new Map<string, { count: number; last: string | null }>();

  for (const memo of activeMemos) {
    const current = counts.get(memo.notebookId) ?? { count: 0, last: null };
    current.count += 1;
    if (!current.last || memo.updatedAt > current.last) current.last = memo.updatedAt;
    counts.set(memo.notebookId, current);
  }

  return {
    notebooks: notebooks
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
      .map(({ scope: _scope, ...notebook }) => ({
        ...notebook,
        memoCount: counts.get(notebook.id)?.count ?? 0,
        lastMemoUpdatedAt: counts.get(notebook.id)?.last ?? null,
      })),
  };
};

export const listLocalMemos = async (scope: string, params: LocalMemoListParams): Promise<LocalMemoListResponse> => {
  let memos = await localDb.memos.where("scope").equals(scope).toArray();
  const notebookIds = params.notebookIds ?? (params.notebookId ? [params.notebookId] : null);
  const q = params.q?.trim().toLocaleLowerCase();
  const tag = params.tag?.trim().toLocaleLowerCase();

  memos = memos.filter((memo) => {
    if (memo.isDeleted !== Boolean(params.trash)) return false;
    if (notebookIds?.length && !notebookIds.includes(memo.notebookId)) return false;
    if (tag && !memo.tags.some((memoTag) => memoTag.toLocaleLowerCase() === tag)) return false;
    if (params.filter === "tagged" && memo.tags.length === 0) return false;
    if (params.filter === "untagged" && memo.tags.length > 0) return false;
    if (params.filter === "pinned" && !memo.isPinned) return false;
    if (q && ![memo.title, memo.excerpt, memo.contentText, memo.tags.join(" ")].some((value) => value?.toLocaleLowerCase().includes(q))) return false;
    return true;
  });

  memos.sort((left, right) => {
    if (params.trash) return (right.deletedAt ?? "").localeCompare(left.deletedAt ?? "") || right.id.localeCompare(left.id);
    if (params.sort === "created-desc") return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
    if (params.sort === "title-asc") return (left.title || left.excerpt).localeCompare(right.title || right.excerpt, "zh-CN") || right.updatedAt.localeCompare(left.updatedAt);
    return Number(right.isPinned) - Number(left.isPinned) || right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
  });

  const totalCount = memos.length;
  const offset = Math.max(0, params.offset ?? 0);
  const page = memos.slice(offset, offset + (params.limit ?? 50));
  return {
    memos: page.map(toSummary),
    totalCount,
    nextCursor: offset + page.length < totalCount ? String(offset + page.length) : null,
  };
};

export const getLocalMemo = async (scope: string, memoId: string) => {
  const memo = await localDb.memos.get([scope, memoId]);
  if (!memo) return null;
  const { scope: _scope, ...detail } = memo;
  return detail;
};

export const putLocalMemo = async (scope: string, memo: MemoDetail) => {
  await localDb.memos.put({ ...memo, scope });
};

export const isLocalMemoId = (memoId: string) => memoId.startsWith("local_");

export const createLocalMemo = async (
  scope: string,
  input: {
    notebookId: string;
    title?: string;
    contentMarkdown?: string;
    contentJson?: TiptapDoc;
    tags?: string[];
    createdAt?: string;
    updatedAt?: string;
  },
) => {
  const now = new Date().toISOString();
  const contentJson = input.contentJson ?? markdownToDoc(input.contentMarkdown ?? "");
  const contentMarkdown = input.contentMarkdown ?? docToMarkdown(contentJson);
  const contentText = docToText(contentJson);
  const memo: MemoDetail = {
    id: `local_${createClientUuid()}`,
    notebookId: input.notebookId,
    title: input.title?.trim() || null,
    excerpt: createExcerpt(contentText),
    tags: input.tags ?? [],
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    revision: 0,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    deletedAt: null,
    contentJson,
    contentMarkdown,
    contentText,
    contentHash: "0".repeat(64),
    sourceMemoIds: [],
    mergeSourceCount: 0,
    mergedIntoMemoId: null,
  };
  await putLocalMemo(scope, memo);
  return memo;
};

const draftTimestamp = (draft: LocalDraft | null | undefined) => {
  const timestamp = draft ? Date.parse(draft.updatedAt) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const remapLocalDraftMemoId = async (temporaryId: string, remoteId: string) => {
  if (temporaryId === remoteId) return;
  await localDb.transaction("rw", localDb.drafts, async () => {
    const temporaryDraft = await localDb.drafts.get(temporaryId);
    if (!temporaryDraft) return;
    const remoteDraft = await localDb.drafts.get(remoteId);
    const newestDraft = selectNewestLocalDraft(temporaryDraft, remoteDraft);
    if (newestDraft) {
      await localDb.drafts.put({ ...newestDraft, memoId: remoteId });
    }
    await localDb.drafts.delete(temporaryId);
  });
};

export const listLocalMemoIdMappings = async (scope: string) => new Map(
  (await localDb.idMappings.where("scope").equals(scope).toArray())
    .map(({ temporaryId, remoteId }) => [temporaryId, remoteId] as const),
);

export const observeLocalMemoIdMappings = (
  scope: string,
  onChange: (mappings: ReadonlyMap<string, string>) => void,
) => {
  const subscription = liveQuery(() => listLocalMemoIdMappings(scope)).subscribe({
    next: onChange,
    error: () => onChange(new Map()),
  });

  return () => subscription.unsubscribe();
};

export const replaceLocalMemoId = async (scope: string, temporaryId: string, memo: MemoDetail) => {
  return localDb.transaction("rw", [localDb.memos, localDb.idMappings, localDb.drafts], async () => {
    const [temporaryMemo, temporaryDraft, remoteDraft] = await Promise.all([
      localDb.memos.get([scope, temporaryId]),
      localDb.drafts.get(temporaryId),
      localDb.drafts.get(memo.id),
    ]);
    const draft = selectNewestLocalDraft(temporaryDraft, remoteDraft);
    const localIsNewer = Boolean(temporaryMemo && Date.parse(temporaryMemo.updatedAt) > Date.parse(memo.updatedAt));
    const draftIsNewer = Boolean(draft && draftTimestamp(draft) >= Date.parse(memo.updatedAt));
    const contentSource = draftIsNewer && draft
      ? {
          title: draft.title.trim() || null,
          tags: parseTagsText(draft.tagsText),
          contentJson: draft.contentJson,
          contentMarkdown: docToMarkdown(draft.contentJson),
          contentText: docToText(draft.contentJson),
          updatedAt: draft.updatedAt,
        }
      : localIsNewer && temporaryMemo
        ? {
            title: temporaryMemo.title,
            tags: temporaryMemo.tags,
            contentJson: temporaryMemo.contentJson,
            contentMarkdown: temporaryMemo.contentMarkdown,
            contentText: temporaryMemo.contentText,
            updatedAt: temporaryMemo.updatedAt,
          }
        : null;
    const remappedMemo: MemoDetail = contentSource
      ? {
          ...memo,
          ...contentSource,
          excerpt: createExcerpt(contentSource.contentText),
        }
      : memo;

    await localDb.memos.put({ ...remappedMemo, scope });
    await localDb.memos.delete([scope, temporaryId]);
    if (draft) {
      await localDb.drafts.put({ ...draft, memoId: memo.id });
    }
    await localDb.drafts.delete(temporaryId);
    await localDb.idMappings.put({
      scope,
      temporaryId,
      remoteId: memo.id,
      createdAt: new Date().toISOString(),
    });
    return remappedMemo;
  });
};

export const putLocalMemoUpdate = async (
  scope: string,
  memo: MemoDetail,
  input: { title: string; contentJson: TiptapDoc; contentMarkdown?: string; tags: string[] },
) => {
  const contentText = docToText(input.contentJson);
  const updatedMemo: MemoDetail = {
    ...memo,
    title: input.title.trim() || null,
    excerpt: createExcerpt(contentText),
    tags: input.tags,
    contentJson: input.contentJson,
    contentMarkdown: input.contentMarkdown ?? docToMarkdown(input.contentJson),
    contentText,
    updatedAt: new Date().toISOString(),
  };
  await putLocalMemo(scope, updatedMemo);
  return updatedMemo;
};

export const putLocalNotebook = async (scope: string, notebook: Notebook) => {
  await localDb.notebooks.put({ ...notebook, scope });
};

export const listLocalMemoRevisions = async (scope: string, memoId: string): Promise<{ revisions: MemoRevision[] }> => {
  const revisions = await localDb.revisions.where("scope").equals(scope).toArray();
  return {
    revisions: revisions
      .filter((revision) => revision.memoId === memoId)
      .sort((left, right) => right.revision - left.revision || right.createdAt.localeCompare(left.createdAt))
      .map(({ scope: _scope, ...revision }) => revision),
  };
};

export const getLocalMemoRevision = async (scope: string, memoId: string, revisionId: string) => {
  const revision = await localDb.revisions.get([scope, revisionId]);
  if (!revision || revision.memoId !== memoId) return null;
  const { scope: _scope, ...result } = revision;
  return result;
};

export const putLocalMemoRevisions = async (scope: string, revisions: MemoRevision[]) => {
  await localDb.revisions.bulkPut(revisions.map((revision): LocalRevision => ({ ...revision, scope })));
};

const getResourceSummary = (resources: ResourceListItem[]) => ({
  totalCount: resources.length,
  totalBytes: resources.reduce((total, resource) => total + resource.byteSize, 0),
  imageCount: resources.filter((resource) => resource.kind === "image").length,
  attachmentCount: resources.filter((resource) => resource.kind === "attachment").length,
});

export const listLocalResources = async (scope: string): Promise<{ resources: ResourceListItem[]; summary: ReturnType<typeof getResourceSummary> }> => {
  const stored = await localDb.resources.where("scope").equals(scope).sortBy("updatedAt");
  const resources = stored.reverse().map(({ scope: _scope, ...resource }) => resource);
  return { resources, summary: getResourceSummary(resources) };
};

export const replaceLocalResources = async (scope: string, resources: ResourceListItem[]) => {
  await localDb.transaction("rw", localDb.resources, async () => {
    const pendingLocalResources = (await localDb.resources.where("scope").equals(scope).toArray())
      .filter((resource) => resource.id.startsWith("local_resource_"));
    await localDb.resources.where("scope").equals(scope).delete();
    await localDb.resources.bulkPut([
      ...resources.map((resource): LocalResource => ({ ...resource, scope })),
      ...pendingLocalResources,
    ]);
  });
};

export const putLocalResource = async (scope: string, resource: ResourceListItem) => {
  await localDb.resources.put({ ...resource, scope });
};

export const renameLocalResource = async (scope: string, resourceId: string, filename: string) => {
  const resource = await localDb.resources.get([scope, resourceId]);
  if (!resource) return;
  await localDb.resources.put({ ...resource, filename, updatedAt: new Date().toISOString() });
};

export const deleteLocalResource = async (scope: string, resourceId: string) => {
  const resource = await localDb.resources.get([scope, resourceId]);
  if (!resource) return;
  await localDb.resources.delete([scope, resourceId]);
  await removeCachedLocalResourceBytes(resource.url);
};

export const createLocalResource = async (scope: string, memoId: string, file: File) => {
  const now = new Date().toISOString();
  const id = `local_resource_${createClientUuid()}`;
  const url = localResourceUrl(id);
  await cacheLocalResourceBytes(url, file);
  const resource: ResourceListItem = {
    id,
    memoId,
    originalMemoId: null,
    kind: file.type.startsWith("image/") ? "image" : "attachment",
    mimeType: file.type || null,
    filename: file.name,
    byteSize: file.size,
    sha256: null,
    width: null,
    height: null,
    createdAt: now,
    updatedAt: now,
    url,
    memoTitle: null,
    memoExcerpt: null,
    memoDeleted: false,
  };
  await putLocalResource(scope, resource);
  return resource;
};

export const replaceLocalResource = async (scope: string, localResourceId: string, resource: ResourceListItem) => {
  const current = await localDb.resources.get([scope, localResourceId]);
  if (current) await localDb.resources.delete([scope, localResourceId]);
  await putLocalResource(scope, resource);
  if (current) await removeCachedLocalResourceBytes(current.url);
};

export const getLocalNotebook = async (scope: string, notebookId: string) => {
  const notebook = await localDb.notebooks.get([scope, notebookId]);
  if (!notebook) return null;
  const { scope: _scope, ...result } = notebook;
  return result;
};

export const updateLocalNotebook = async (scope: string, notebookId: string, input: Partial<Pick<Notebook, "name" | "parentId" | "sortOrder">>) => {
  const notebook = await getLocalNotebook(scope, notebookId);
  if (!notebook) return null;
  const updated = { ...notebook, ...input, updatedAt: new Date().toISOString() };
  await putLocalNotebook(scope, updated);
  return updated;
};

export const deleteLocalNotebook = async (scope: string, notebookId: string) => {
  const notebook = await getLocalNotebook(scope, notebookId);
  if (!notebook) return false;
  await localDb.notebooks.delete([scope, notebookId]);
  return true;
};

export const createLocalNotebook = async (scope: string, input: { name: string; parentId?: string | null }) => {
  const now = new Date().toISOString();
  const notebook: Notebook = {
    id: `local_${createClientUuid()}`,
    parentId: input.parentId ?? null,
    name: input.name.trim(),
    slug: null,
    icon: null,
    color: null,
    sortOrder: 0,
    memoCount: 0,
    lastMemoUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await putLocalNotebook(scope, notebook);
  return notebook;
};

export const createLocalTemplate = async (scope: string, input: { name: string; description?: string | null; title?: string | null; contentMarkdown?: string; tags?: string[] }) => {
  const now = new Date().toISOString();
  const contentMarkdown = input.contentMarkdown ?? "";
  const template: MemoTemplate = {
    id: `local_${createClientUuid()}`,
    name: input.name.trim(),
    description: input.description ?? null,
    title: input.title ?? null,
    contentJson: markdownToDoc(contentMarkdown),
    contentMarkdown,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await putLocalTemplate(scope, template);
  return template;
};

export const updateLocalTemplate = async (scope: string, templateId: string, input: Partial<Omit<MemoTemplate, "id" | "createdAt" | "updatedAt" | "contentJson">> & { contentMarkdown?: string }) => {
  const current = (await localDb.templates.get([scope, templateId]));
  if (!current) return null;
  const contentMarkdown = input.contentMarkdown ?? current.contentMarkdown;
  const { scope: _scope, ...template } = current;
  const updated: MemoTemplate = {
    ...template,
    ...input,
    contentMarkdown,
    contentJson: input.contentMarkdown === undefined ? current.contentJson : markdownToDoc(contentMarkdown),
    updatedAt: new Date().toISOString(),
  };
  await putLocalTemplate(scope, updated);
  return updated;
};

export const listLocalTemplates = async (scope: string): Promise<{ templates: MemoTemplate[] }> => {
  const templates = await localDb.templates.where("scope").equals(scope).sortBy("updatedAt");
  return { templates: templates.reverse().map(({ scope: _scope, ...template }) => template) };
};

export const putLocalTemplate = async (scope: string, template: MemoTemplate) => {
  await localDb.templates.put({ ...template, scope });
};

export const deleteLocalTemplate = async (scope: string, templateId: string) => {
  await localDb.templates.delete([scope, templateId]);
};

export const listLocalTags = async (scope: string): Promise<{ tags: TagSummary[] }> => {
  const memos = await localDb.memos.where("scope").equals(scope).toArray();
  const tags = new Map<string, { memoCount: number; updatedAt: string | null }>();
  for (const memo of memos) {
    if (memo.isDeleted) continue;
    for (const name of new Set(memo.tags.map((tag) => tag.trim()))) {
      if (!name) continue;
      const current = tags.get(name) ?? { memoCount: 0, updatedAt: null };
      current.memoCount += 1;
      if (!current.updatedAt || memo.updatedAt > current.updatedAt) current.updatedAt = memo.updatedAt;
      tags.set(name, current);
    }
  }
  return {
    tags: [...tags.entries()]
      .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: "base" }))
      .map(([name, value]) => ({ name, memoCount: value.memoCount, updatedAt: value.updatedAt })),
  };
};

const updateLocalMemos = async (scope: string, memoIds: string[], update: (memo: MemoDetail) => MemoDetail | null) => {
  const wanted = new Set(memoIds);
  let updated = 0;
  await localDb.transaction("rw", localDb.memos, async () => {
    const memos = await localDb.memos.where("scope").equals(scope).toArray();
    for (const stored of memos) {
      if (wanted.size > 0 && !wanted.has(stored.id)) continue;
      const { scope: _scope, ...memo } = stored;
      const next = update(memo);
      if (!next) {
        await localDb.memos.delete([scope, memo.id]);
      } else {
        await localDb.memos.put({ ...next, scope });
      }
      updated += 1;
    }
  });
  return updated;
};

export const applyLocalTagRename = async (scope: string, tag: string, name: string) => {
  const normalizedTag = tag.trim();
  const normalizedName = name.trim();
  const memoIds = (await localDb.memos.where("scope").equals(scope).toArray())
    .filter((memo) => memo.tags.includes(normalizedTag))
    .map((memo) => memo.id);
  return updateLocalMemos(scope, memoIds, (memo) => ({
    ...memo,
    tags: memo.tags.map((current) => current === normalizedTag ? normalizedName : current).filter((current, index, all) => current && all.indexOf(current) === index),
    updatedAt: new Date().toISOString(),
  }));
};

export const applyLocalTagDelete = async (scope: string, tag: string) =>
  applyLocalTagRename(scope, tag, "");

export const applyLocalMemoMove = (scope: string, memoIds: string[], notebookId: string) =>
  updateLocalMemos(scope, memoIds, (memo) => ({ ...memo, notebookId, updatedAt: new Date().toISOString() }));

export const applyLocalMemoPin = (scope: string, memoIds: string[], isPinned: boolean) =>
  updateLocalMemos(scope, memoIds, (memo) => ({ ...memo, isPinned, updatedAt: new Date().toISOString() }));

export const applyLocalMemoDeleteBatch = async (scope: string, memoIds: string[], permanent = false) => {
  if (permanent) return updateLocalMemos(scope, memoIds, () => null);
  return updateLocalMemos(scope, memoIds, (memo) => ({ ...memo, isDeleted: true, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
};

export const applyLocalEmptyTrash = async (scope: string) => {
  const deletedIds = (await localDb.memos.where("scope").equals(scope).toArray()).filter((memo) => memo.isDeleted).map((memo) => memo.id);
  return updateLocalMemos(scope, deletedIds, () => null);
};

export const mergeLocalMemos = async (scope: string, input: { memoIds: string[]; notebookId?: string; title?: string }) => {
  const sources = (await Promise.all(input.memoIds.map((memoId) => getLocalMemo(scope, memoId)))).filter((memo): memo is MemoDetail => Boolean(memo));
  if (sources.length < 2) return null;
  const sourceDocs = sources.map((memo) => {
    const doc = resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown);
    if (!docToText(doc).trim() && memo.contentText.trim()) {
      throw new Error("Source note content could not be recovered safely. Merge was cancelled.");
    }
    return doc;
  });
  const contentJson = mergeMemoDocs(sourceDocs);
  const contentMarkdown = docToMarkdown(contentJson);
  const memo = await createLocalMemo(scope, {
    notebookId: input.notebookId ?? sources[0]!.notebookId,
    title: resolveMergedMemoTitle(input.title, sources),
    contentMarkdown,
    contentJson,
    tags: [...new Set(sources.flatMap((source) => source.tags))],
  });
  const merged = {
    ...memo,
    sourceMemoIds: sources.map((source) => source.id),
    mergeSourceCount: sources.length,
  };
  await putLocalMemo(scope, merged);
  await updateLocalMemos(scope, sources.map((source) => source.id), (source) => ({
    ...source,
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    mergedIntoMemoId: memo.id,
    updatedAt: new Date().toISOString(),
  }));
  return merged;
};

export const deleteLocalMemo = async (scope: string, memoId: string, permanent = false) => {
  if (permanent) {
    await localDb.memos.delete([scope, memoId]);
    return;
  }

  const memo = await getLocalMemo(scope, memoId);
  if (!memo) return;
  await putLocalMemo(scope, {
    ...memo,
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
};

export const restoreLocalMemo = async (scope: string, memoId: string) => {
  const memo = await getLocalMemo(scope, memoId);
  if (!memo) return;
  await putLocalMemo(scope, {
    ...memo,
    isDeleted: false,
    deletedAt: null,
    updatedAt: new Date().toISOString(),
  });
};

export const clearLocalScope = async (scope: string) => {
  const scopedResources = await localDb.resources.where("scope").equals(scope).toArray();
  await localDb.transaction("rw", [localDb.drafts, localDb.notebooks, localDb.memos, localDb.templates, localDb.revisions, localDb.resources, localDb.syncQueue, localDb.syncMeta, localDb.idMappings], async () => {
    const scopedMemos = await localDb.memos.where("scope").equals(scope).toArray();
    const scopedMemoIds = new Set(scopedMemos.map((memo) => memo.id));
    const queuedItems = await localDb.syncQueue.toArray();
    await localDb.drafts.bulkDelete([...scopedMemoIds]);
    await localDb.notebooks.where("scope").equals(scope).delete();
    await localDb.memos.where("scope").equals(scope).delete();
    await localDb.templates.where("scope").equals(scope).delete();
    await localDb.revisions.where("scope").equals(scope).delete();
    await localDb.resources.where("scope").equals(scope).delete();
    await localDb.syncQueue.bulkDelete(queuedItems.filter((item) => item.scope === scope || scopedMemoIds.has(item.memoId)).map((item) => item.id));
    await localDb.syncMeta.where("scope").equals(scope).delete();
    await localDb.idMappings.where("scope").equals(scope).delete();
  });
  await Promise.all(scopedResources
    .filter((resource) => resource.id.startsWith("local_resource_"))
    .map((resource) => removeCachedLocalResourceBytes(resource.url)));
};

export type { LocalMemo, LocalNotebook };
