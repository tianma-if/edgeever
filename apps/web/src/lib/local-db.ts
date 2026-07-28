import type { MemoDetail, MemoRevision, MemoTemplate, Notebook, ResourceListItem, TiptapDoc } from "@edgeever/shared";
import Dexie, { type Table } from "dexie";

export type LocalDraft = {
  memoId: string;
  expectedRevision?: number;
  title: string;
  contentJson: TiptapDoc;
  tagsText: string;
  updatedAt: string;
};

export type MemoUpdateSyncPayload = {
  memoId: string;
  expectedRevision: number;
  expectedContentHash: string;
  editSessionId: string;
  title: string;
  contentJson: TiptapDoc;
  contentMarkdown?: string;
  tags: string[];
};

export type MemoCreateSyncPayload = {
  temporaryId: string;
  notebookId: string;
  title: string;
  contentMarkdown?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type MemoDeleteSyncPayload = {
  memoId: string;
  permanent: boolean;
};

export type MemoRestoreSyncPayload = {
  memoId: string;
};

export type LocalActionKind = "tag.rename" | "tag.delete" | "memo.moveBatch" | "memo.deleteBatch" | "memo.emptyTrash" | "memo.pinBatch" | "memo.merge" | "notebook.create" | "notebook.update" | "notebook.delete" | "template.create" | "template.update" | "template.delete" | "resource.create";
export type LocalActionPayload = Record<string, unknown>;

export type SyncQueueStatus = "pending" | "syncing" | "conflict" | "error";

export type SyncQueueItem = {
  id: string;
  kind: "memo.update" | "memo.create" | "memo.delete" | "memo.restore" | LocalActionKind;
  scope?: string;
  memoId: string;
  status: SyncQueueStatus;
  payload: MemoUpdateSyncPayload | MemoCreateSyncPayload | MemoDeleteSyncPayload | MemoRestoreSyncPayload | LocalActionPayload;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  claimId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocalNotebook = Notebook & { scope: string };
export type LocalMemo = MemoDetail & { scope: string };
export type LocalTemplate = MemoTemplate & { scope: string };
export type LocalSyncMeta = {
  key: string;
  scope: string;
  value: string;
  updatedAt: string;
};
export type LocalIdMapping = {
  temporaryId: string;
  scope: string;
  remoteId: string;
  createdAt: string;
};
export type LocalRevision = MemoRevision & { scope: string };
export type LocalResource = ResourceListItem & { scope: string };

class EdgeEverLocalDb extends Dexie {
  drafts!: Table<LocalDraft, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  notebooks!: Table<LocalNotebook, [string, string]>;
  memos!: Table<LocalMemo, [string, string]>;
  templates!: Table<LocalTemplate, [string, string]>;
  syncMeta!: Table<LocalSyncMeta, [string, string]>;
  idMappings!: Table<LocalIdMapping, [string, string]>;
  revisions!: Table<LocalRevision, [string, string]>;
  resources!: Table<LocalResource, [string, string]>;

  constructor() {
    super("edgeever-local");
    this.version(1).stores({
      drafts: "memoId, updatedAt",
    });
    this.version(2).stores({
      drafts: "memoId, updatedAt",
      syncQueue: "id, memoId, status, updatedAt, nextAttemptAt",
    });
    this.version(3).stores({
      drafts: "memoId, updatedAt",
      syncQueue: "id, memoId, status, updatedAt, nextAttemptAt",
      notebooks: "[scope+id], scope, parentId, sortOrder, updatedAt",
      memos: "[scope+id], scope, notebookId, isDeleted, updatedAt, createdAt",
      templates: "[scope+id], scope, updatedAt",
      syncMeta: "[scope+key], scope, updatedAt",
    });
    this.version(4).stores({
      drafts: "memoId, updatedAt",
      syncQueue: "id, memoId, status, updatedAt, nextAttemptAt",
      notebooks: "[scope+id], scope, parentId, sortOrder, updatedAt",
      memos: "[scope+id], scope, notebookId, isDeleted, updatedAt, createdAt",
      templates: "[scope+id], scope, updatedAt",
      syncMeta: "[scope+key], scope, updatedAt",
      idMappings: "[scope+temporaryId], scope, remoteId, createdAt",
    });
    this.version(5).stores({
      drafts: "memoId, updatedAt",
      syncQueue: "id, memoId, status, updatedAt, nextAttemptAt",
      notebooks: "[scope+id], scope, parentId, sortOrder, updatedAt",
      memos: "[scope+id], scope, notebookId, isDeleted, updatedAt, createdAt",
      templates: "[scope+id], scope, updatedAt",
      syncMeta: "[scope+key], scope, updatedAt",
      idMappings: "[scope+temporaryId], scope, remoteId, createdAt",
      revisions: "[scope+id], scope, memoId, revision, createdAt",
    });
    this.version(6).stores({
      drafts: "memoId, updatedAt",
      syncQueue: "id, memoId, status, updatedAt, nextAttemptAt",
      notebooks: "[scope+id], scope, parentId, sortOrder, updatedAt",
      memos: "[scope+id], scope, notebookId, isDeleted, updatedAt, createdAt",
      templates: "[scope+id], scope, updatedAt",
      syncMeta: "[scope+key], scope, updatedAt",
      idMappings: "[scope+temporaryId], scope, remoteId, createdAt",
      revisions: "[scope+id], scope, memoId, revision, createdAt",
      resources: "[scope+id], scope, memoId, updatedAt, createdAt",
    });
  }
}

export const localDb = new EdgeEverLocalDb();
