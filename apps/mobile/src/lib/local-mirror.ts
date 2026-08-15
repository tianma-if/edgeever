import type { createEdgeEverClient, ListMemosResponse, MemoFilterMode, MemoSortMode } from "@edgeever/client";
import type { MemoDetail, MemoSummary, Notebook, TagSummary } from "@edgeever/shared";
import * as SQLite from "expo-sqlite";
import { hasMobileSyncCursorRewound, hasMobileSyncIdentityChanged, isMobileSyncMetadataInitialized, splitMobileBootstrapWriteBatches } from "./mobile-sync-protocol";
import { summarizeMobileTags } from "./mobile-tags";

const DATABASE_NAME = "edgeever-mobile.db";
const BOOTSTRAP_PAGE_SIZE = 200;
const BOOTSTRAP_WRITE_BATCH_SIZE = 50;
const CHANGE_PAGE_SIZE = 200;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
const syncPromises = new Map<string, Promise<number>>();

type StoredMemoRow = { data_json: string };
type StoredNotebookRow = { data_json: string; memo_count: number; last_memo_updated_at: string | null };
type CursorRow = { value: string };
type SyncMetaRow = CursorRow & { key: string };
type IdMappingRow = { remote_id: string };

export type LocalMemoListParams = {
  notebookId?: string | null;
  notebookIds?: string[];
  q?: string;
  trash?: boolean;
  sort?: MemoSortMode;
  filter?: MemoFilterMode;
  limit?: number;
  offset?: number;
};

export type MobileBootstrapProgress = {
  loadedCount: number;
  totalCount: number;
};

type MobileLocalMirrorSyncOptions = {
  onBootstrapProgress?: (progress: MobileBootstrapProgress) => void | Promise<void>;
};

export const createMobileDataScope = (baseUrl: string, userId?: string | null) =>
  `${baseUrl.trim().toLowerCase()}|${userId ?? "anonymous"}`;

export const isMobileLocalMirrorInitialized = async (scope: string) => {
  const db = await getDatabase();
  const rows = await db.getAllAsync<SyncMetaRow>(
    `SELECT key, value FROM mobile_sync_meta WHERE scope = ? AND key IN ('cursor', 'identity')`,
    scope
  );
  const metadata = new Map(rows.map((row) => [row.key, row.value]));
  const cursorValue = metadata.get("cursor");
  const identityValue = metadata.get("identity");
  return isMobileSyncMetadataInitialized(cursorValue, identityValue);
};

export const listLocalNotebooks = async (scope: string): Promise<{ notebooks: Notebook[] }> => {
  const db = await getDatabase();
  const rows = await db.getAllAsync<StoredNotebookRow>(
    `SELECT n.data_json,
            COUNT(CASE WHEN m.is_deleted = 0 THEN 1 END) AS memo_count,
            MAX(CASE WHEN m.is_deleted = 0 THEN m.updated_at END) AS last_memo_updated_at
     FROM mobile_notebooks n
     LEFT JOIN mobile_memos m ON m.scope = n.scope AND m.notebook_id = n.id
     WHERE n.scope = ?
     GROUP BY n.id, n.data_json
     ORDER BY n.sort_order ASC, n.name COLLATE NOCASE ASC`,
    scope
  );

  return {
    notebooks: rows.map((row) => ({
      ...(JSON.parse(row.data_json) as Notebook),
      memoCount: row.memo_count,
      lastMemoUpdatedAt: row.last_memo_updated_at,
    })),
  };
};

export const listLocalTags = async (scope: string): Promise<{ tags: TagSummary[] }> => {
  const db = await getDatabase();
  const rows = await db.getAllAsync<StoredMemoRow>(
    "SELECT data_json FROM mobile_memos WHERE scope = ? AND is_deleted = 0",
    scope
  );
  const memos = rows.flatMap((row) => {
    try {
      return [JSON.parse(row.data_json) as MemoDetail];
    } catch {
      return [];
    }
  });
  return { tags: summarizeMobileTags(memos) };
};

export const listLocalMemos = async (scope: string, params: LocalMemoListParams): Promise<ListMemosResponse> => {
  const db = await getDatabase();
  const conditions = ["scope = ?", "is_deleted = ?"];
  const binds: (string | number)[] = [scope, params.trash ? 1 : 0];

  if (params.notebookIds?.length) {
    conditions.push(`notebook_id IN (${params.notebookIds.map(() => "?").join(", ")})`);
    binds.push(...params.notebookIds);
  } else if (params.notebookId) {
    conditions.push("notebook_id = ?");
    binds.push(params.notebookId);
  }
  if (params.q?.trim()) {
    conditions.push("(title LIKE ? OR content_text LIKE ? OR tags_text LIKE ?)");
    const q = `%${params.q.trim()}%`;
    binds.push(q, q, q);
  }
  if (params.filter === "tagged") {
    conditions.push("tags_text <> ''");
  } else if (params.filter === "untagged") {
    conditions.push("tags_text = ''");
  } else if (params.filter === "pinned") {
    conditions.push("is_pinned = 1");
  }

  const orderBy = params.trash
    ? "deleted_at DESC, id DESC"
    : params.sort === "created-desc"
      ? "is_pinned DESC, created_at DESC, id DESC"
      : params.sort === "title-asc"
        ? "is_pinned DESC, title COLLATE NOCASE ASC, updated_at DESC, id DESC"
        : "is_pinned DESC, updated_at DESC, id DESC";
  const countRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM mobile_memos WHERE ${conditions.join(" AND ")}`,
    ...binds
  );
  const limit = params.limit ?? 50;
  const offset = Math.max(0, params.offset ?? 0);
  const rows = await db.getAllAsync<StoredMemoRow>(
    `SELECT data_json FROM mobile_memos WHERE ${conditions.join(" AND ")} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ...binds,
    limit,
    offset
  );
  const totalCount = countRow?.count ?? rows.length;
  const nextOffset = offset + rows.length;

  return {
    memos: rows.map((row) => toMemoSummary(JSON.parse(row.data_json) as MemoDetail)),
    totalCount,
    nextCursor: nextOffset < totalCount ? String(nextOffset) : null,
  };
};

export const getLocalMemo = async (scope: string, memoId: string): Promise<MemoDetail | null> => {
  const db = await getDatabase();
  const row = await db.getFirstAsync<StoredMemoRow>(
    `SELECT data_json FROM mobile_memos WHERE scope = ? AND id = ?`,
    scope,
    memoId
  );
  return row ? JSON.parse(row.data_json) as MemoDetail : null;
};

export const resolveLocalMemo = async (scope: string, memoId: string): Promise<MemoDetail | null> => {
  const direct = await getLocalMemo(scope, memoId);
  if (direct) {
    return direct;
  }
  const db = await getDatabase();
  const mapping = await db.getFirstAsync<IdMappingRow>(
    `SELECT remote_id FROM mobile_id_mappings WHERE scope = ? AND temporary_id = ?`,
    scope,
    memoId
  );
  return mapping ? getLocalMemo(scope, mapping.remote_id) : null;
};

export const upsertLocalMemo = async (scope: string, memo: MemoDetail) => {
  const db = await getDatabase();
  await upsertMemo(db, scope, memo);
};

export const deleteLocalMemo = async (scope: string, memoId: string) => {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM mobile_memos WHERE scope = ? AND id = ?`, scope, memoId);
};

/** Soft-delete a mirror row so list views hide it without waiting for a remote sync. */
export const softDeleteLocalMemo = async (scope: string, memoId: string) => {
  const memo = await getLocalMemo(scope, memoId);
  if (!memo || memo.isDeleted) {
    return false;
  }
  const now = new Date().toISOString();
  await upsertLocalMemo(scope, {
    ...memo,
    isDeleted: true,
    deletedAt: now,
    updatedAt: now,
  });
  return true;
};

export const replaceLocalMemoId = async (scope: string, temporaryId: string, memo: MemoDetail) => {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await upsertMemo(tx, scope, memo);
    await tx.runAsync(`DELETE FROM mobile_memos WHERE scope = ? AND id = ?`, scope, temporaryId);
    await tx.runAsync(
      `INSERT OR REPLACE INTO mobile_id_mappings (scope, temporary_id, remote_id, created_at) VALUES (?, ?, ?, ?)`,
      scope,
      temporaryId,
      memo.id,
      new Date().toISOString()
    );
  });
};

export const syncMobileLocalMirror = async (
  client: ReturnType<typeof createEdgeEverClient>,
  scope: string,
  options: MobileLocalMirrorSyncOptions = {}
) => {
  const existing = syncPromises.get(scope);
  if (existing) {
    return existing;
  }
  const operation = performMobileLocalMirrorSync(client, scope, options).finally(() => {
    syncPromises.delete(scope);
  });
  syncPromises.set(scope, operation);
  return operation;
};

const performMobileLocalMirrorSync = async (
  client: ReturnType<typeof createEdgeEverClient>,
  scope: string,
  options: MobileLocalMirrorSyncOptions = {}
) => {
  const db = await getDatabase();
  const cursorRow = await db.getFirstAsync<CursorRow>(
    `SELECT value FROM mobile_sync_meta WHERE scope = ? AND key = 'cursor'`,
    scope
  );
  const identityRow = await db.getFirstAsync<CursorRow>(
    `SELECT value FROM mobile_sync_meta WHERE scope = ? AND key = 'identity'`,
    scope
  );
  let cursor = cursorRow ? Number(cursorRow.value) : null;
  let syncIdentity = identityRow?.value ?? null;

  if (cursor === null || !Number.isFinite(cursor) || syncIdentity === null) {
    let afterId: string | null = null;
    let loadedCount = 0;
    let snapshotCursor = 0;
    let snapshotIdentity = "legacy";
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(`DELETE FROM mobile_notebooks WHERE scope = ?`, scope);
      // Offline-created memos are owned by the local sync queue and must
      // survive a remote snapshot rebuild.
      await tx.runAsync(`DELETE FROM mobile_memos WHERE scope = ? AND id NOT LIKE 'local:%'`, scope);
    });

    while (true) {
      const page = await client.getMobileSyncBootstrapPage(afterId, BOOTSTRAP_PAGE_SIZE);
      if (afterId === null) {
        snapshotCursor = page.snapshotCursor;
        snapshotIdentity = page.syncIdentity || "legacy";
      }
      const writeBatches = splitMobileBootstrapWriteBatches(page.memos, BOOTSTRAP_WRITE_BATCH_SIZE);
      for (const [batchIndex, memos] of writeBatches.entries()) {
        await db.withExclusiveTransactionAsync(async (tx) => {
          if (batchIndex === 0) {
            for (const notebook of page.notebooks) {
              await upsertNotebook(tx, scope, notebook);
            }
          }
          for (const memo of memos) {
            await upsertMemo(tx, scope, memo);
          }
        });
        loadedCount += memos.length;
        await options.onBootstrapProgress?.({ loadedCount, totalCount: page.totalCount });
      }
      if (page.nextAfterId === null) {
        break;
      }
      afterId = page.nextAfterId;
    }
    cursor = snapshotCursor;
    syncIdentity = snapshotIdentity;
    await setCursor(db, scope, cursor);
    await setSyncIdentity(db, scope, syncIdentity);
  }

  while (true) {
    const page = await client.getMobileSyncChanges(cursor, CHANGE_PAGE_SIZE);
    if (hasMobileSyncCursorRewound(cursor, page.serverCursor) || hasMobileSyncIdentityChanged(syncIdentity, page.syncIdentity)) {
      // A restored/replaced server database can legitimately restart its
      // change sequence. Rebuild the mirror instead of treating the stale
      // local cursor as proof that no remote notes exist.
      await db.runAsync(`DELETE FROM mobile_sync_meta WHERE scope = ? AND key IN ('cursor', 'identity')`, scope);
      return performMobileLocalMirrorSync(client, scope, options);
    }
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const change of page.changes) {
        if (change.entityType === "memo") {
          if (change.memo) {
            await upsertMemo(tx, scope, change.memo);
          } else {
            await tx.runAsync(`DELETE FROM mobile_memos WHERE scope = ? AND id = ?`, scope, change.entityId);
          }
        } else if (change.notebook) {
          await upsertNotebook(tx, scope, change.notebook);
        } else {
          await tx.runAsync(`DELETE FROM mobile_notebooks WHERE scope = ? AND id = ?`, scope, change.entityId);
        }
      }
      await setCursor(tx, scope, page.cursor);
    });
    cursor = page.cursor;
    if (!page.hasMore) {
      return cursor;
    }
  }
};

const getDatabase = async () => {
  databasePromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS mobile_notebooks (
        scope TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL,
        data_json TEXT NOT NULL, PRIMARY KEY (scope, id)
      );
      CREATE TABLE IF NOT EXISTS mobile_memos (
        scope TEXT NOT NULL, id TEXT NOT NULL, notebook_id TEXT NOT NULL, title TEXT NOT NULL,
        content_text TEXT NOT NULL, tags_text TEXT NOT NULL, is_pinned INTEGER NOT NULL,
        is_deleted INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        deleted_at TEXT, data_json TEXT NOT NULL, PRIMARY KEY (scope, id)
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_memos_feed ON mobile_memos(scope, is_deleted, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mobile_memos_notebook ON mobile_memos(scope, notebook_id, is_deleted, updated_at DESC);
      CREATE TABLE IF NOT EXISTS mobile_sync_meta (
        scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (scope, key)
      );
      CREATE TABLE IF NOT EXISTS mobile_id_mappings (
        scope TEXT NOT NULL, temporary_id TEXT NOT NULL, remote_id TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (scope, temporary_id)
      );
    `);
    return db;
  });
  return databasePromise;
};

const upsertNotebook = (db: SQLite.SQLiteDatabase, scope: string, notebook: Notebook) =>
  db.runAsync(
    `INSERT OR REPLACE INTO mobile_notebooks (scope, id, name, sort_order, data_json) VALUES (?, ?, ?, ?, ?)`,
    scope,
    notebook.id,
    notebook.name,
    notebook.sortOrder,
    JSON.stringify(notebook)
  );

const upsertMemo = (db: SQLite.SQLiteDatabase, scope: string, memo: MemoDetail) =>
  db.runAsync(
    `INSERT OR REPLACE INTO mobile_memos
      (scope, id, notebook_id, title, content_text, tags_text, is_pinned, is_deleted, created_at, updated_at, deleted_at, data_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    scope,
    memo.id,
    memo.notebookId,
    memo.title ?? "",
    memo.contentText,
    memo.tags.join(" "),
    memo.isPinned ? 1 : 0,
    memo.isDeleted ? 1 : 0,
    memo.createdAt,
    memo.updatedAt,
    memo.deletedAt,
    JSON.stringify(memo)
  );

const setCursor = (db: SQLite.SQLiteDatabase, scope: string, cursor: number) =>
  db.runAsync(
    `INSERT OR REPLACE INTO mobile_sync_meta (scope, key, value) VALUES (?, 'cursor', ?)`,
    scope,
    String(cursor)
  );

const setSyncIdentity = (db: SQLite.SQLiteDatabase, scope: string, identity: string) =>
  db.runAsync(
    `INSERT OR REPLACE INTO mobile_sync_meta (scope, key, value) VALUES (?, 'identity', ?)`,
    scope,
    identity
  );

const toMemoSummary = (memo: MemoDetail): MemoSummary => ({
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
