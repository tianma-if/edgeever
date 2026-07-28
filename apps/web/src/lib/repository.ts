import { markdownToDoc, type MemoDetail, type MemoRevision, type MemoSummary, type MemoTemplate, type Notebook, type Resource, type ResourceListItem, type ResourceStorageSummary, type TagSummary, type TiptapDoc } from "@edgeever/shared";
import { api } from "@/lib/api";
import {
  getLocalMemo,
  hasLocalMirrorData,
  isLocalMirrorInitialized,
  listLocalMemos,
  listLocalNotebooks,
  listLocalTemplates,
  putLocalTemplate,
  deleteLocalTemplate,
  listLocalTags,
  applyLocalTagRename,
  applyLocalTagDelete,
  applyLocalMemoMove,
  applyLocalMemoDeleteBatch,
  applyLocalEmptyTrash,
  applyLocalMemoPin,
  updateLocalNotebook,
  deleteLocalNotebook,
  createLocalNotebook,
  createLocalTemplate,
  updateLocalTemplate,
  mergeLocalMemos,
  listLocalMemoRevisions,
  getLocalMemoRevision,
  putLocalMemoRevisions,
  listLocalResources,
  replaceLocalResources,
  putLocalResource,
  createLocalResource,
  putLocalMemo,
  putLocalNotebook,
  putLocalMemoUpdate,
  restoreLocalMemo,
  syncLocalMirror,
  type LocalMemoListParams,
  type LocalMemoListResponse,
} from "@/lib/local-mirror";
import { queueLocalAction, queueMemoCreate, queueMemoDelete, queueMemoRestore, queueMemoUpdate } from "@/lib/sync-queue";
import type { MemoUpdateSyncPayload } from "@/lib/local-db";
import { createDesktopRepository } from "@/lib/desktop-repository";

export type EdgeEverRepository = {
  listNotebooks(): Promise<{ notebooks: Notebook[] }>;
  createNotebook(input: { name: string; parentId?: string | null }): Promise<{ notebook: Notebook }>;
  updateNotebook(notebookId: string, input: { name?: string; parentId?: string | null; sortOrder?: number }): Promise<{ notebook: Notebook }>;
  deleteNotebook(notebookId: string): Promise<{ ok: true }>;
  restoreNotebook(notebookId: string): Promise<{ notebook: Notebook }>;
  listTemplates(): Promise<{ templates: MemoTemplate[] }>;
  createTemplate(input: { name: string; description?: string | null; memoId?: string; title?: string | null; contentMarkdown?: string; tags?: string[] }): Promise<{ template: MemoTemplate }>;
  updateTemplate(templateId: string, input: { name?: string; description?: string | null; title?: string | null; contentMarkdown?: string; tags?: string[] }): Promise<{ template: MemoTemplate }>;
  deleteTemplate(templateId: string): Promise<{ ok: true }>;
  useTemplate(templateId: string, notebookId: string): Promise<{ memo: MemoDetail }>;
  uploadMemoResource(memoId: string, file: File): Promise<{ resource: Resource }>;
  listResources(): Promise<{ resources: ResourceListItem[]; summary: ResourceStorageSummary }>;
  listTags(): Promise<{ tags: TagSummary[] }>;
  renameTag(tag: string, name: string): Promise<{ ok: true; updated: number }>;
  deleteTag(tag: string): Promise<{ ok: true; updated: number }>;
  moveMemos(input: { memoIds: string[]; notebookId: string }): Promise<{ ok: true; moved: number }>;
  deleteMemos(input: { memoIds: string[]; permanent?: boolean }): Promise<{ ok: true; deleted: number }>;
  emptyTrash(): Promise<{ ok: true; deleted: number }>;
  pinMemos(input: { memoIds: string[]; isPinned: boolean }): Promise<{ ok: true; updated: number }>;
  mergeMemos(input: { memoIds: string[]; notebookId?: string; title?: string }): Promise<{ memo: MemoDetail }>;
  listMemos(params: LocalMemoListParams): Promise<LocalMemoListResponse>;
  getMemo(memoId: string, includeDeleted?: boolean): Promise<{ memo: MemoDetail }>;
  createMemo(input: { notebookId: string; title?: string; contentMarkdown?: string; tags?: string[] }): Promise<{ memo: MemoDetail }>;
  updateMemo(memo: MemoDetail, input: Omit<MemoUpdateSyncPayload, "memoId">): Promise<{ memo: MemoDetail; queued: true }>;
  deleteMemo(memoId: string, permanent?: boolean): Promise<{ ok: true }>;
  restoreMemo(memoId: string): Promise<{ memo: MemoDetail; queued: true }>;
  listMemoRevisions(memoId: string): Promise<{ revisions: MemoRevision[] }>;
  restoreMemoRevision(memoId: string, revisionId: string): Promise<{ memo: MemoDetail }>;
  sync(): Promise<{ bootstrapped: boolean; changed: number }>;
};

export const createWebRepository = (scope: string): EdgeEverRepository => {
  const isOffline = () => typeof navigator !== "undefined" && !navigator.onLine;

  return ({
  async listNotebooks() {
    const local = await listLocalNotebooks(scope);
    if (local.notebooks.length > 0 || isOffline()) {
      if (!isOffline()) void api.listNotebooks().then((remote) => Promise.all(remote.notebooks.map((notebook) => putLocalNotebook(scope, notebook)))).catch(() => {});
      return local;
    }

    const remote = await api.listNotebooks();
    await Promise.all(remote.notebooks.map((notebook) => putLocalNotebook(scope, notebook)));
    return remote;
  },

  async createNotebook(input) {
    const notebook = await createLocalNotebook(scope, input);
    await queueLocalAction(scope, "notebook.create", notebook.id, { ...input, temporaryId: notebook.id });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { notebook };
  },

  async updateNotebook(notebookId, input) {
    const local = await updateLocalNotebook(scope, notebookId, input);
    if (!local) {
      if (isOffline()) throw new Error("Notebook is not available in the local mirror");
      const result = await api.updateNotebook(notebookId, input);
      await putLocalNotebook(scope, result.notebook);
      return result;
    }
    await queueLocalAction(scope, "notebook.update", notebookId, { notebookId, ...input });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { notebook: local };
  },

  async deleteNotebook(notebookId) {
    await deleteLocalNotebook(scope, notebookId);
    await queueLocalAction(scope, "notebook.delete", notebookId, { notebookId });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { ok: true as const };
  },

  restoreNotebook: async (notebookId) => {
    if (isOffline()) throw new Error("Notebook restore requires a connection");
    const result = await api.restoreNotebook(notebookId);
    await putLocalNotebook(scope, result.notebook);
    return result;
  },

  async listTemplates() {
    const local = await listLocalTemplates(scope);
    if (local.templates.length > 0 || isOffline()) {
      if (!isOffline()) void api.listTemplates().then((remote) => Promise.all(remote.templates.map((template) => putLocalTemplate(scope, template)))).catch(() => {});
      return local;
    }
    const remote = await api.listTemplates();
    await Promise.all(remote.templates.map((template) => putLocalTemplate(scope, template)));
    return remote;
  },
  createTemplate: async (input) => {
    const template = await createLocalTemplate(scope, input);
    await queueLocalAction(scope, "template.create", template.id, { ...input, temporaryId: template.id });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { template };
  },
  updateTemplate: async (templateId, input) => {
    const template = await updateLocalTemplate(scope, templateId, input);
    if (!template) {
      if (isOffline()) throw new Error("Template is not available in the local mirror");
      const result = await api.updateTemplate(templateId, input);
      await putLocalTemplate(scope, result.template);
      return result;
    }
    await queueLocalAction(scope, "template.update", templateId, { templateId, ...input });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { template };
  },
  deleteTemplate: async (templateId) => {
    await deleteLocalTemplate(scope, templateId);
    await queueLocalAction(scope, "template.delete", templateId, { templateId });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { ok: true as const };
  },
  useTemplate: async (templateId, notebookId) => {
    const template = (await listLocalTemplates(scope)).templates.find((candidate) => candidate.id === templateId);
    if (!template) {
      if (isOffline()) throw new Error("Template is not available offline");
      const result = await api.useTemplate(templateId, notebookId);
      await putLocalMemo(scope, result.memo);
      return result;
    }
    const { createLocalMemo } = await import("@/lib/local-mirror");
    const memo = await createLocalMemo(scope, {
      notebookId,
      title: template.title ?? "",
      contentMarkdown: template.contentMarkdown,
      tags: template.tags,
    });
    await queueMemoCreate(scope, {
      temporaryId: memo.id,
      notebookId,
      title: template.title ?? "",
      contentMarkdown: template.contentMarkdown,
      tags: template.tags,
      createdAt: memo.createdAt,
      updatedAt: memo.updatedAt,
    });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { memo };
  },
  uploadMemoResource: async (memoId, file) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const resource = await createLocalResource(scope, memoId, file);
      await queueLocalAction(scope, "resource.create", resource.id, {
        resourceId: resource.id,
        memoId,
        filename: resource.filename,
        mimeType: resource.mimeType,
        url: resource.url,
      }, memoId);
      window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
      return { resource };
    }
    const result = await api.uploadMemoResource(memoId, file);
    await putLocalResource(scope, { ...result.resource, memoTitle: null, memoExcerpt: null, memoDeleted: false });
    return result;
  },
  async listResources() {
    const local = await listLocalResources(scope);
    if (local.resources.length > 0 || isOffline()) {
      if (!isOffline()) void api.listResources().then((remote) => replaceLocalResources(scope, remote.resources)).catch(() => {});
      return local;
    }
    const remote = await api.listResources();
    await replaceLocalResources(scope, remote.resources);
    return remote;
  },
  async listTags() {
    const local = await listLocalTags(scope);
    if (local.tags.length > 0 || isOffline()) return local;
    return api.listTags();
  },
  renameTag: async (tag, name) => {
    const updated = await applyLocalTagRename(scope, tag, name);
    await queueLocalAction(scope, "tag.rename", tag, { tag, name });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { ok: true as const, updated };
  },
  deleteTag: async (tag) => {
    const updated = await applyLocalTagDelete(scope, tag);
    await queueLocalAction(scope, "tag.delete", tag, { tag });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { ok: true as const, updated };
  },
  moveMemos: async (input) => {
    const moved = await applyLocalMemoMove(scope, input.memoIds, input.notebookId);
    await queueLocalAction(scope, "memo.moveBatch", input.memoIds.join(","), input);
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { ok: true as const, moved };
  },
  deleteMemos: async (input) => {
    const deleted = await applyLocalMemoDeleteBatch(scope, input.memoIds, input.permanent);
    await queueLocalAction(scope, "memo.deleteBatch", input.memoIds.join(","), input);
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { ok: true as const, deleted };
  },
  emptyTrash: async () => {
    const deleted = await applyLocalEmptyTrash(scope);
    await queueLocalAction(scope, "memo.emptyTrash", "trash", {});
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { ok: true as const, deleted };
  },
  pinMemos: async ({ memoIds, isPinned }) => {
    const updated = await applyLocalMemoPin(scope, memoIds, isPinned);
    await queueLocalAction(scope, "memo.pinBatch", memoIds.join(","), { memoIds, isPinned });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { ok: true as const, updated };
  },
  mergeMemos: async (input) => {
    const memo = await mergeLocalMemos(scope, input);
    if (!memo) {
      if (isOffline()) throw new Error("Memos are not available in the local mirror");
      return api.mergeMemos(input);
    }
    await queueLocalAction(scope, "memo.merge", memo.id, { ...input, temporaryId: memo.id });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { memo };
  },

  async listMemos(params) {
    if (await isLocalMirrorInitialized(scope) || await hasLocalMirrorData(scope)) {
      return listLocalMemos(scope, params);
    }

    const remote = await api.listMemos({
      notebookId: params.notebookId,
      includeDescendants: Boolean(params.notebookIds?.length),
      q: params.q,
      trash: params.trash,
      filter: params.filter,
      sort: params.sort,
      cursor: params.offset ? String(params.offset) : null,
      limit: params.limit,
    });
    return remote;
  },

  async getMemo(memoId, includeDeleted = false) {
    const local = await getLocalMemo(scope, memoId);
    if (local && (includeDeleted || !local.isDeleted)) return { memo: local };

    if (isOffline()) throw new Error("Memo is not available in the local mirror");
    const remote = await api.getMemo(memoId, { includeDeleted });
    await putLocalMemo(scope, remote.memo);
    return remote;
  },

  async createMemo(input) {
    const { createLocalMemo } = await import("@/lib/local-mirror");
    const memo = await createLocalMemo(scope, input);
    await queueMemoCreate(scope, {
      temporaryId: memo.id,
      notebookId: input.notebookId,
      title: input.title ?? "",
      contentMarkdown: input.contentMarkdown,
      tags: input.tags ?? [],
      createdAt: memo.createdAt,
      updatedAt: memo.updatedAt,
    });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { memo };
  },

  async updateMemo(memo, input) {
    const payload: MemoUpdateSyncPayload = { ...input, memoId: memo.id };
    const updated = await putLocalMemoUpdate(scope, memo, payload);
    await queueMemoUpdate(payload, scope);
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { memo: updated, queued: true };
  },

  async deleteMemo(memoId, permanent = false) {
    const { deleteLocalMemo } = await import("@/lib/local-mirror");
    await deleteLocalMemo(scope, memoId, permanent);
    await queueMemoDelete(scope, { memoId, permanent });
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { ok: true as const };
  },

  async restoreMemo(memoId) {
    await restoreLocalMemo(scope, memoId);
    await queueMemoRestore(scope, { memoId });
    const memo = await getLocalMemo(scope, memoId);
    if (!memo) throw new Error("Memo is not available in the local mirror");
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { memo, queued: true };
  },

  async listMemoRevisions(memoId) {
    const local = await listLocalMemoRevisions(scope, memoId);
    if (local.revisions.length > 0 || isOffline()) {
      if (!isOffline()) void api.listMemoRevisions(memoId).then((remote) => putLocalMemoRevisions(scope, remote.revisions)).catch(() => {});
      return local;
    }
    const remote = await api.listMemoRevisions(memoId);
    await putLocalMemoRevisions(scope, remote.revisions);
    return remote;
  },
  async restoreMemoRevision(memoId, revisionId) {
    const [memo, revision] = await Promise.all([getLocalMemo(scope, memoId), getLocalMemoRevision(scope, memoId, revisionId)]);
    if (!memo || !revision) {
      if (isOffline()) throw new Error("Revision is not available offline");
      return api.restoreMemoRevision(memoId, revisionId);
    }
    const contentJson = markdownToDoc(revision.contentMarkdown);
    const updated = await putLocalMemoUpdate(scope, memo, {
      title: revision.title ?? "",
      contentJson,
      contentMarkdown: revision.contentMarkdown,
      tags: revision.tags,
    });
    await queueMemoUpdate({
      memoId,
      expectedRevision: memo.revision,
      expectedContentHash: memo.contentHash,
      editSessionId: `offline-revision:${revisionId}`,
      title: revision.title ?? "",
      contentJson,
      contentMarkdown: revision.contentMarkdown,
      tags: revision.tags,
    }, scope);
    window.dispatchEvent(new CustomEvent("edgeever:sync-queue-changed"));
    return { memo: updated };
  },

  sync: () => syncLocalMirror(scope),
  });
};

export const createRepository = (scope: string): EdgeEverRepository => {
  if (typeof window !== "undefined" && window.edgeeverDesktop?.isAvailable) {
    return createDesktopRepository();
  }
  return createWebRepository(scope);
};
