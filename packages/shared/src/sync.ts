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
  serverCursor: number;
  syncIdentity?: string;
};

export type SyncCursorState = {
  cursor: number;
  syncIdentity: string;
};

export type SyncOutboxOperation =
  | "memo.create"
  | "memo.update"
  | "memo.delete"
  | "memo.restore"
  | "notebook.create"
  | "notebook.update"
  | "notebook.delete";
