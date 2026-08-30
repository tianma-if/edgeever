import type { MemoDetail, MemoSummary, MemoTemplate, Notebook, ResourceListItem, ResourceStorageSummary } from "./types";
import type { TiptapDoc } from "./content";

export const DESKTOP_SIDECAR_PROTOCOL_VERSION = 2;

export const DESKTOP_RPC_METHODS = [
  "system.info",
  "storage.health",
  "storage.backup",
  "storage.backups",
  "storage.restore",
  "sync.status",
  "sync.bootstrap.prepare",
  "sync.outbox.list",
  "sync.outbox.ack",
  "sync.outbox.fail",
  "sync.outbox.retry",
  "sync.outbox.recoverMemoUpdate",
  "sync.outbox.discard",
  "sync.apply",
  "sync.cursor.set",
  "notebook.list",
  "notebook.create",
  "notebook.update",
  "notebook.delete",
  "notebook.restore",
  "template.list",
  "template.cache",
  "template.create",
  "template.update",
  "template.delete",
  "resource.list",
  "resource.cache",
  "resource.delete",
  "tag.list",
  "tag.rename",
  "tag.delete",
  "memo.moveBatch",
  "memo.deleteBatch",
  "memo.emptyTrash",
  "memo.pinBatch",
  "memo.merge",
  "memo.list",
  "memo.get",
  "memo.create",
  "memo.update",
  "memo.delete",
  "memo.restore",
  "memo.revisions",
  "memo.restoreRevision",
  "memo.revision.cache",
] as const;

export type DesktopRpcMethod = (typeof DESKTOP_RPC_METHODS)[number];

export type DesktopMemoListParams = {
  notebookId?: string | null;
  notebookIds?: string[];
  q?: string;
  trash?: boolean;
  sort?: "updated-desc" | "created-desc" | "title-asc";
  filter?: "all" | "pinned" | "tagged" | "untagged";
  limit?: number;
  offset?: number;
};

export type DesktopMemoCreateParams = {
  notebookId: string;
  title?: string;
  contentMarkdown?: string;
  tags?: string[];
};

export type DesktopMemoUpdateParams = {
  memoId: string;
  expectedRevision?: number;
  expectedContentHash?: string;
  title: string;
  contentJson: TiptapDoc;
  contentMarkdown?: string;
  tags: string[];
};

export type DesktopRpcResponses = {
  "notebook.list": { notebooks: Notebook[] };
  "notebook.create": { notebook: Notebook };
  "notebook.update": { notebook: Notebook };
  "notebook.delete": { ok: true };
  "notebook.restore": { notebook: Notebook };
  "template.list": { templates: MemoTemplate[] };
  "template.cache": { template: MemoTemplate };
  "template.create": { template: MemoTemplate };
  "template.update": { template: MemoTemplate };
  "template.delete": { ok: true };
  "resource.list": { resources: ResourceListItem[]; summary: ResourceStorageSummary };
  "resource.cache": { ok: true };
  "resource.delete": { ok: true };
  "tag.list": { tags: import("./types").TagSummary[] };
  "tag.rename": { ok: true; updated: number };
  "tag.delete": { ok: true; updated: number };
  "memo.moveBatch": { ok: true; moved: number };
  "memo.deleteBatch": { ok: true; deleted: number };
  "memo.emptyTrash": { ok: true; deleted: number };
  "memo.pinBatch": { ok: true; updated: number };
  "memo.merge": { memo: MemoDetail };
  "memo.list": { memos: MemoSummary[]; totalCount: number; nextCursor: string | null };
  "memo.get": { memo: MemoDetail };
  "memo.create": { memo: MemoDetail };
  "memo.update": { memo: MemoDetail };
  "memo.delete": { ok: true };
  "memo.restore": { memo: MemoDetail };
  "memo.revisions": { revisions: import("./types").MemoRevision[] };
  "memo.restoreRevision": { memo: MemoDetail };
  "memo.revision.cache": { ok: true };
  "sync.status": { pending: number; syncing: number; conflict: number; error: number; cursor: number; syncIdentity: string | null; lastSyncedAt: string | null };
  "sync.bootstrap.prepare": { clearedSeedData: boolean; rebuiltMirror: boolean };
  "sync.outbox.list": { items: DesktopOutboxItem[] };
  "sync.outbox.ack": { ok: true; memo: MemoDetail | null; notebook: Notebook | null; template: MemoTemplate | null };
  "sync.outbox.fail": { ok: true };
  "sync.outbox.retry": { ok: true };
  "sync.outbox.recoverMemoUpdate": { ok: true; memo: MemoDetail };
  "sync.outbox.discard": { ok: true };
  "sync.apply": { applied: number };
  "sync.cursor.set": { ok: true };
  "system.info": { platform: string; architecture: string; dataDir: string; protocolVersion: number };
  "storage.health": { ok: true };
  "storage.backup": { ok: true; path: string };
  "storage.backups": { backups: Array<{ path: string; name: string; size: number; modifiedAt: string }> };
  "storage.restore": { ok: true; path: string };
};

export type DesktopRpcParams = {
  "notebook.list": Record<string, never>;
  "notebook.create": { name: string; parentId?: string | null };
  "notebook.update": { notebookId: string; name?: string; parentId?: string | null; sortOrder?: number };
  "notebook.delete": { notebookId: string };
  "notebook.restore": { notebookId: string };
  "template.list": Record<string, never>;
  "template.cache": { template: MemoTemplate };
  "template.create": { name: string; description?: string | null; memoId?: string; title?: string | null; contentMarkdown?: string; tags?: string[] };
  "template.update": { templateId: string; name?: string; description?: string | null; title?: string | null; contentMarkdown?: string; tags?: string[] };
  "template.delete": { templateId: string };
  "resource.list": { limit?: number };
  "resource.cache": { resource: import("./types").Resource };
  "resource.delete": { resourceId: string };
  "tag.list": Record<string, never>;
  "tag.rename": { tag: string; name: string };
  "tag.delete": { tag: string };
  "memo.moveBatch": { memoIds: string[]; notebookId: string };
  "memo.deleteBatch": { memoIds: string[]; permanent?: boolean };
  "memo.emptyTrash": Record<string, never>;
  "memo.pinBatch": { memoIds: string[]; isPinned: boolean };
  "memo.merge": { memoIds: string[]; notebookId?: string; title?: string };
  "memo.list": DesktopMemoListParams;
  "memo.get": { memoId: string; includeDeleted?: boolean };
  "memo.create": DesktopMemoCreateParams;
  "memo.update": DesktopMemoUpdateParams;
  "memo.delete": { memoId: string; permanent?: boolean };
  "memo.restore": { memoId: string };
  "memo.revisions": { memoId: string; limit?: number };
  "memo.restoreRevision": { memoId: string; revisionId: string };
  "memo.revision.cache": { revision: import("./types").MemoRevision };
  "sync.status": Record<string, never>;
  "sync.bootstrap.prepare": { reset?: boolean };
  "sync.outbox.list": { limit?: number; includeConflicts?: boolean };
  "sync.outbox.ack": { id: number; version?: number; remoteMemo?: MemoDetail; remoteNotebook?: Notebook; remoteTemplate?: MemoTemplate };
  "sync.outbox.fail": { id: number; version?: number; error: string; errorCode?: string | null; conflict?: boolean; retryable?: boolean; nextAttemptAt?: string | null };
  "sync.outbox.retry": { id: number; version?: number };
  "sync.outbox.recoverMemoUpdate": { id: number; version?: number; notebookId: string };
  "sync.outbox.discard": { id: number; version?: number };
  "sync.apply": { changes: Array<{ entityType: "memo" | "notebook"; operation: "upsert" | "delete"; memo?: MemoDetail | null; notebook?: Notebook | null; entityId: string }> };
  "sync.cursor.set": { cursor: number; syncIdentity: string };
  "system.info": Record<string, never>;
  "storage.health": Record<string, never>;
  "storage.backup": Record<string, never>;
  "storage.backups": Record<string, never>;
  "storage.restore": { path: string };
};

type DesktopRpcContractMismatch =
  | Exclude<DesktopRpcMethod, keyof DesktopRpcParams>
  | Exclude<keyof DesktopRpcParams, DesktopRpcMethod>
  | Exclude<DesktopRpcMethod, keyof DesktopRpcResponses>
  | Exclude<keyof DesktopRpcResponses, DesktopRpcMethod>;

type AssertNoDesktopRpcContractMismatch<Mismatch extends never> = Mismatch;

export type DesktopRpcContractIsComplete =
  AssertNoDesktopRpcContractMismatch<DesktopRpcContractMismatch>;

export type DesktopOutboxItem = {
  id: number;
  kind: "memo.create" | "memo.update" | "memo.delete" | "memo.restore" | "memo.move" | "memo.deleteBatch" | "memo.emptyTrash" | "memo.pinBatch" | "memo.merge" | "notebook.create" | "notebook.update" | "notebook.delete" | "notebook.restore" | "template.create" | "template.update" | "template.delete" | "tag.rename" | "tag.delete";
  entityId: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  version: number;
  status?: "pending" | "syncing" | "conflict" | "error";
  lastError?: string | null;
  lastErrorCode?: string | null;
  retryable?: boolean;
  nextAttemptAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};
