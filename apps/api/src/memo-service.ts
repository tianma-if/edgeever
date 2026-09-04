import {
  createExcerpt,
  DEFAULT_MEMO_TITLE,
  docToMarkdown,
  docToText,
  emptyDoc,
  markdownToDoc,
  mergeMemoDocs,
  resolveMemoContentDoc,
  resolveMergedMemoTitle,
  isSuspiciousMemoOverwrite,
  isMemoEditBindingValid,
  normalizeTags,
  type MemoDetail,
  type MemoEditSession,
  type MemoSummary,
  type MemoUpdateInput,
  type TiptapDoc,
} from "@edgeever/shared";
import { auditStatement } from "./audit";
import type { AppContext, AuditActor, AuthContext, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { sha256 } from "./hash-utils";
import { getRequiredString } from "./mcp-json-rpc";
import {
  escapeLike,
  listMemos,
  mapMemoSummary,
  toFtsQuery,
  type MemoSummaryRow,
} from "./memo-list-service";
import {
  deleteMemoSearchDocumentsStatement,
  upsertMemoSearchDocumentStatement,
} from "./memo-search-index";
import {
  createMemoRevisionStatement as createMemoRevisionStatementService,
  shouldSnapshotMemoRevision as shouldSnapshotMemoRevisionService,
} from "./memo-revision-service";
import { getNotebook } from "./notebook-service";
import { deleteStoredObjects } from "./object-storage";
import { getAuditActor, getWorkspaceId } from "./request-auth";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

// Internal callers can bind a reviewed operation and its receipt to the same
// atomic batch as the existing memo mutation. Never populated from HTTP input.
export type MemoMutationCommit = {
  before: PreparedStatementAdapter[];
  after: (memoId: string) => PreparedStatementAdapter[];
};

const clampNumber = (value: number, min: number, max: number) =>
  Number.isNaN(value) ? min : Math.min(Math.max(value, min), max);

export type MemoDetailRow = MemoSummaryRow & {
  content_json: string;
  content_markdown: string;
  content_text: string;
  source_memo_ids: string;
  merge_source_count: number;
  merged_into_memo_id: string | null;
  content_hash: string;
};

type MemoEditSessionRow = {
  id: string;
  memo_id: string;
  actor_type: "user" | "agent";
  actor_id: string | null;
  base_revision: number;
  base_content_hash: string;
  expires_at: string;
};

type WorkspaceIdentityRow = {
  workspace_id: string;
  workspace_name: string;
  is_personal: number;
  user_id: string;
  username: string;
  display_name: string | null;
  role: "owner" | "member";
};

type MemoImportSourceRow = {
  external_id: string;
  memo_id: string;
  source_updated_at: string | null;
};

export const mapMemoDetail = (row: MemoDetailRow): MemoDetail => ({
  ...mapMemoSummary(row),
  contentJson: parseDoc(row.content_json),
  contentMarkdown: row.content_markdown,
  contentText: row.content_text,
  contentHash: row.content_hash,
  sourceMemoIds: parseJsonArray(row.source_memo_ids),
  mergeSourceCount: row.merge_source_count,
  mergedIntoMemoId: row.merged_into_memo_id,
});

export const getCurrentWorkspaceIdentity = async (db: DatabaseAdapter, auth: AuthContext) => {
  const row = await db.prepare(
    `SELECT w.id AS workspace_id, w.name AS workspace_name, w.is_personal,
            u.id AS user_id, u.username, u.display_name, wm.role
     FROM workspaces w
     INNER JOIN workspace_members wm ON wm.workspace_id = w.id
     INNER JOIN users u ON u.id = wm.user_id
     WHERE w.id = ?
     ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, wm.created_at ASC
     LIMIT 1`
  ).bind(auth.workspaceId, auth.kind === "user" ? auth.actorId : null).first<WorkspaceIdentityRow>();

  if (!row) {
    throw new AppError("workspace_identity_not_found", "The authenticated workspace has no associated user.", 404);
  }

  return {
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
    },
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      isPersonal: row.is_personal === 1,
    },
    authorization: {
      kind: auth.kind === "agent" ? "api_token" : "user_session",
      ...(auth.kind === "agent" ? { tokenName: auth.username, scopes: auth.scopes } : {}),
    },
    dataIsolation: {
      workspaceScoped: true,
      statement:
        "Every notebook and memo returned by this MCP server belongs to this workspace; data from other users is excluded.",
    },
  };
};

export const searchMemoSummaries = async (
  db: DatabaseAdapter,
  options: {
    workspaceId: string;
    query?: string | null;
    notebookId?: string | null;
    tags?: string[];
    createdAfter?: string | null;
    createdBefore?: string | null;
    updatedAfter?: string | null;
    updatedBefore?: string | null;
    isPinned?: boolean | null;
    hasResources?: boolean | null;
    limit: number;
  }
): Promise<MemoSummary[]> => {
  const q = options.query?.trim();
  const notebookId = options.notebookId?.trim() || null;
  const tags = normalizeTags(options.tags ?? []);
  const limit = clampNumber(options.limit, 1, 100);
  const filters = ["m.workspace_id = ?", "m.is_deleted = 0"];
  const binds: unknown[] = [options.workspaceId];

  if (notebookId) {
    filters.push("m.notebook_id = ?");
    binds.push(notebookId);
  }

  for (const tag of tags) {
    filters.push("EXISTS (SELECT 1 FROM memo_tags mt WHERE mt.memo_id = m.id AND mt.workspace_id = ? AND mt.name = ?)");
    binds.push(options.workspaceId, tag);
  }

  if (options.createdAfter) {
    filters.push("m.created_at >= ?");
    binds.push(options.createdAfter);
  }

  if (options.createdBefore) {
    filters.push("m.created_at <= ?");
    binds.push(options.createdBefore);
  }

  if (options.updatedAfter) {
    filters.push("m.updated_at >= ?");
    binds.push(options.updatedAfter);
  }

  if (options.updatedBefore) {
    filters.push("m.updated_at <= ?");
    binds.push(options.updatedBefore);
  }

  if (options.isPinned !== null && options.isPinned !== undefined) {
    filters.push("m.is_pinned = ?");
    binds.push(options.isPinned ? 1 : 0);
  }

  if (options.hasResources !== null && options.hasResources !== undefined) {
    filters.push(
      options.hasResources
        ? "EXISTS (SELECT 1 FROM resources r WHERE r.memo_id = m.id AND r.is_deleted = 0)"
        : "NOT EXISTS (SELECT 1 FROM resources r WHERE r.memo_id = m.id AND r.is_deleted = 0)"
    );
  }

  if (q) {
    const ftsQuery = toFtsQuery(q);
    const likeQuery = `%${escapeLike(q)}%`;

    if (ftsQuery) {
      const rows = await db
        .prepare(
          `WITH raw_matches(memo_id, rank) AS (
             SELECT memo_id, bm25(memos_fts)
             FROM memos_fts
             WHERE memos_fts MATCH ?

             UNION ALL

             SELECT m.id, 100.0
             FROM memos m
             INNER JOIN memo_contents c ON c.memo_id = m.id
             WHERE m.title LIKE ? ESCAPE '\\'
                OR c.content_text LIKE ? ESCAPE '\\'
                OR m.tags_json LIKE ? ESCAPE '\\'
           ),
           search_matches AS (
             SELECT memo_id, MIN(rank) AS rank
             FROM raw_matches
             GROUP BY memo_id
           )
           SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                  m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
                  c.content_text
           FROM search_matches s
           INNER JOIN memos m ON m.id = s.memo_id
           INNER JOIN memo_contents c ON c.memo_id = m.id
           WHERE ${filters.join(" AND ")}
           ORDER BY s.rank ASC, m.is_pinned DESC, m.updated_at DESC
           LIMIT ?`
        )
        .bind(ftsQuery, likeQuery, likeQuery, likeQuery, ...binds, limit)
        .all<MemoSummaryRow>();

      return rows.results.map(mapMemoSummary);
    }
  }

  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE ${filters.join(" AND ")}
       ORDER BY m.is_pinned DESC, m.updated_at DESC
       LIMIT ?`
    )
    .bind(...binds, limit)
    .all<MemoSummaryRow>();

  return rows.results.map(mapMemoSummary);
};

export const listMemosForMcp = async (
  db: DatabaseAdapter,
  options: { workspaceId: string; notebookId?: string | null; limit: number; offset: number; includeContent: boolean; includeDeleted: boolean }
) => {
  const notebookId = options.notebookId?.trim() || null;
  const limit = clampNumber(options.limit, 1, 100);
  const offset = clampNumber(options.offset, 0, 100_000);
  const pageSize = limit + 1;
  const deletedFilter = options.includeDeleted ? "1 = 1" : "m.is_deleted = 0";

  if (options.includeContent) {
    const rows = await db
      .prepare(
        `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
                c.content_json, c.content_markdown, c.content_text, c.content_hash,
                m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
         FROM memos m
         INNER JOIN memo_contents c ON c.memo_id = m.id
         WHERE m.workspace_id = ? AND ${deletedFilter}
           AND (? IS NULL OR m.notebook_id = ?)
         ORDER BY m.updated_at DESC, m.id ASC
         LIMIT ? OFFSET ?`
      )
      .bind(options.workspaceId, notebookId, notebookId, pageSize, offset)
      .all<MemoDetailRow>();
    const page = rows.results.slice(0, limit).map(mapMemoDetail);

    return {
      memos: page,
      limit,
      offset,
      nextOffset: rows.results.length > limit ? offset + limit : null,
      hasMore: rows.results.length > limit,
    };
  }

  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.workspace_id = ? AND ${deletedFilter}
         AND (? IS NULL OR m.notebook_id = ?)
       ORDER BY m.updated_at DESC, m.id ASC
       LIMIT ? OFFSET ?`
    )
    .bind(options.workspaceId, notebookId, notebookId, pageSize, offset)
    .all<MemoSummaryRow>();
  const page = rows.results.slice(0, limit).map(mapMemoSummary);

  return {
    memos: page,
    limit,
    offset,
    nextOffset: rows.results.length > limit ? offset + limit : null,
    hasMore: rows.results.length > limit,
  };
};

export const getMemoDetailRow = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  includeDeleted = false
): Promise<MemoDetailRow | null> =>
  db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_json, c.content_markdown, c.content_text, c.content_hash,
              m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.id = ? AND m.workspace_id = ? AND (? = 1 OR m.is_deleted = 0)`
    )
    .bind(id, workspaceId, includeDeleted ? 1 : 0)
    .first<MemoDetailRow>();

export const getMemoDetail = async (db: DatabaseAdapter, workspaceId: string, id: string, includeDeleted = false): Promise<MemoDetail | null> => {
  const row = await getMemoDetailRow(db, workspaceId, id, includeDeleted);
  return row ? mapMemoDetail(row) : null;
};

export const createMemoEditSession = async (c: AppContext, memoId: string): Promise<MemoEditSession | null> => {
  const current = await getMemoDetailRow(c.env.storage.db, getWorkspaceId(c), memoId);
  if (!current) return null;

  const actor = getAuditActor(c);
  const now = isoNow();
  const existing = await c.env.storage.db.prepare(
    `SELECT id, memo_id, base_revision, base_content_hash, expires_at
     FROM memo_edit_sessions
     WHERE memo_id = ? AND actor_type = ? AND actor_id IS ?
       AND base_revision = ? AND base_content_hash = ? AND expires_at > ?
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).bind(
    memoId,
    actor.actorType,
    actor.actorId,
    current.revision,
    current.content_hash,
    now,
  ).first<{
    id: string;
    memo_id: string;
    base_revision: number;
    base_content_hash: string;
    expires_at: string;
  }>();

  if (existing) {
    return {
      id: existing.id,
      memoId: existing.memo_id,
      baseRevision: existing.base_revision,
      baseContentHash: existing.base_content_hash,
      expiresAt: existing.expires_at,
    };
  }

  const session: MemoEditSession = {
    id: createId("edit"),
    memoId,
    baseRevision: current.revision,
    baseContentHash: current.content_hash,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
  };

  await c.env.storage.db.batch([
    c.env.storage.db.prepare(`DELETE FROM memo_edit_sessions WHERE expires_at <= ?`).bind(now),
    c.env.storage.db.prepare(
      `INSERT INTO memo_edit_sessions (
         id, memo_id, actor_type, actor_id, base_revision, base_content_hash,
         expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      session.id,
      memoId,
      actor.actorType,
      actor.actorId,
      session.baseRevision,
      session.baseContentHash,
      session.expiresAt,
      now,
      now,
    ),
  ]);

  return session;
};

export const deleteMemosRecord = async (
  env: Bindings,
  workspaceId: string,
  memoIds: string[],
  permanent: boolean,
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const db = env.storage.db;
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const expectedDeletedState = permanent ? 1 : 0;
  const rows = await db
    .prepare(
      `SELECT id
       FROM memos
       WHERE workspace_id = ? AND is_deleted = ? AND id IN (${placeholders})`
    )
    .bind(workspaceId, expectedDeletedState, ...uniqueMemoIds)
    .all<{ id: string }>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError(
      "missing_memos",
      permanent ? "One or more memos cannot be permanently deleted." : "One or more memos cannot be deleted.",
      400
    );
  }

  const now = isoNow();
  const statements: PreparedStatementAdapter[] = [];

  if (permanent) {
    const resourceRows = await db
      .prepare(
        `SELECT object_key, storage_config_id
         FROM resources
         WHERE memo_id IN (${placeholders})`
      )
      .bind(...uniqueMemoIds)
      .all<{ object_key: string; storage_config_id: string }>();

    if (resourceRows.results.length > 0) {
      await deleteStoredObjects(env, resourceRows.results);
    }

    statements.push(
      db.prepare(`DELETE FROM resources WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds),
      db.prepare(`DELETE FROM memo_revisions WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds),
      db.prepare(`DELETE FROM memo_contents WHERE memo_id IN (${placeholders})`).bind(...uniqueMemoIds),
      db.prepare(`DELETE FROM memos WHERE workspace_id = ? AND is_deleted = 1 AND id IN (${placeholders})`).bind(workspaceId, ...uniqueMemoIds)
    );

    for (const memoId of uniqueMemoIds) {
      statements.push(auditStatement(db, actor.actorType, actor.actorId, "memo.delete_permanent", "memo", memoId, {}));
    }
  } else {
    statements.push(
      db.prepare(`DELETE FROM memo_shares WHERE workspace_id = ? AND memo_id IN (${placeholders})`).bind(workspaceId, ...uniqueMemoIds),
      db
        .prepare(
          `UPDATE memos
           SET is_deleted = 1, deleted_at = ?, updated_at = ?
           WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${placeholders})`
        )
        .bind(now, now, workspaceId, ...uniqueMemoIds),
      db
        .prepare(
          `UPDATE resources
           SET is_deleted = 1, deleted_at = ?, updated_at = ?
           WHERE is_deleted = 0 AND memo_id IN (${placeholders})`
        )
        .bind(now, now, ...uniqueMemoIds),
      deleteMemoSearchDocumentsStatement(db, uniqueMemoIds)
    );

    for (const memoId of uniqueMemoIds) {
      statements.push(auditStatement(db, actor.actorType, actor.actorId, "memo.delete", "memo", memoId, {}));
    }
  }

  await db.batch(statements);
  return uniqueMemoIds.length;
};

export const deleteMemoRecord = async (
  env: Bindings,
  workspaceId: string,
  memoId: string,
  permanent: boolean,
  actor: AuditActor,
) => {
  const current = await getMemoDetailRow(env.storage.db, workspaceId, memoId, permanent);

  if (permanent && (!current || current.is_deleted === 0)) {
    throw new AppError("not_found", "Memo not found in trash", 404);
  }

  // Soft deletion historically treats an unknown/already-deleted memo as an idempotent no-op.
  if (!permanent && !current) return;

  await deleteMemosRecord(env, workspaceId, [memoId], permanent, actor);
};

export const getMemosForBulkAction = async (db: DatabaseAdapter, workspaceId: string, memoIds: string[], deletedState: 0 | 1) => {
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return [];
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.workspace_id = ? AND m.is_deleted = ?
         AND m.id IN (${placeholders})
       ORDER BY m.updated_at DESC, m.id ASC`
    )
    .bind(workspaceId, deletedState, ...uniqueMemoIds)
    .all<MemoSummaryRow>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be found for this action in the expected state.", 400);
  }

  return rows.results.map(mapMemoSummary);
};

export const restoreMemosRecord = async (
  db: DatabaseAdapter,
  workspaceId: string,
  memoIds: string[],
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.tags_json, c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.workspace_id = ? AND m.is_deleted = 1 AND m.id IN (${placeholders})`
    )
    .bind(workspaceId, ...uniqueMemoIds)
    .all<{ id: string; notebook_id: string; title: string | null; tags_json: string; content_text: string }>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be restored.", 400);
  }

  const notebookIds = Array.from(new Set(rows.results.map((row) => row.notebook_id)));
  const notebookPlaceholders = notebookIds.map(() => "?").join(", ");
  const notebookRows = await db
    .prepare(`SELECT id FROM notebooks WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${notebookPlaceholders})`)
    .bind(workspaceId, ...notebookIds)
    .all<{ id: string }>();
  const activeNotebookIds = new Set(notebookRows.results.map((row) => row.id));

  const needsInbox = rows.results.some((row) => !activeNotebookIds.has(row.notebook_id));

  const inbox = needsInbox
    ? await db.prepare(`SELECT id FROM notebooks WHERE workspace_id = ? AND slug = 'inbox' AND is_deleted = 0 LIMIT 1`).bind(workspaceId).first<{ id: string }>()
    : null;
  if (needsInbox && !inbox) {
    throw new AppError("restore_notebook_missing", "Original notebooks were deleted and the default inbox is unavailable.", 409);
  }

  const now = isoNow();
  const statements: PreparedStatementAdapter[] = [];

  for (const row of rows.results) {
    const restoreNotebookId = activeNotebookIds.has(row.notebook_id) ? row.notebook_id : inbox!.id;
    const tags = parseJsonArray(row.tags_json);

    statements.push(
      db
        .prepare(
          `UPDATE memos
           SET notebook_id = ?, is_deleted = 0, deleted_at = NULL, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND is_deleted = 1`
        )
        .bind(restoreNotebookId, now, row.id, workspaceId),
      db
        .prepare(
          `UPDATE resources
           SET is_deleted = 0, deleted_at = NULL, updated_at = ?
           WHERE memo_id = ? AND is_deleted = 1`
        )
        .bind(now, row.id),
      upsertMemoSearchDocumentStatement(db, row.id, row.title, row.content_text, tags.join(" ")),
      auditStatement(db, actor.actorType, actor.actorId, "memo.restore", "memo", row.id, {
        fromNotebookId: row.notebook_id,
        toNotebookId: restoreNotebookId,
      })
    );
  }

  await db.batch(statements);
  return uniqueMemoIds.length;
};

export const restoreMemoRecord = async (
  db: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
  actor: AuditActor,
): Promise<MemoDetail> => {
  const current = await getMemoDetailRow(db, workspaceId, memoId, true);
  if (!current || current.is_deleted === 0) {
    throw new AppError("not_found", "Memo not found in trash", 404);
  }

  await restoreMemosRecord(db, workspaceId, [memoId], actor);
  const memo = await getMemoDetail(db, workspaceId, memoId);
  if (!memo) throw new AppError("not_found", "Memo not found after restore", 404);
  return memo;
};

export const emptyTrashMemosRecord = async (
  env: Bindings,
  workspaceId: string,
  actor: { actorType: "user" | "agent"; actorId: string | null }
) => {
  const db = env.storage.db;
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM memos
       WHERE workspace_id = ? AND is_deleted = 1`
    )
    .bind(workspaceId).first<{ count: number }>();
  const deleted = countRow?.count ?? 0;

  if (deleted === 0) {
    return 0;
  }

  const resourceRows = await db
    .prepare(
      `SELECT r.object_key, r.storage_config_id
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE m.workspace_id = ? AND m.is_deleted = 1`
    )
    .bind(workspaceId).all<{ object_key: string; storage_config_id: string }>();

  if (resourceRows.results.length > 0) {
    await deleteStoredObjects(env, resourceRows.results);
  }

  await db.batch([
    db.prepare(`UPDATE resources SET original_memo_id = NULL WHERE original_memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM resources WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM memo_revisions WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM memo_contents WHERE memo_id IN (SELECT id FROM memos WHERE workspace_id = ? AND is_deleted = 1)`).bind(workspaceId),
    db.prepare(`DELETE FROM memos WHERE workspace_id = ? AND is_deleted = 1`).bind(workspaceId),
    auditStatement(db, actor.actorType, actor.actorId, "memo.trash_empty", "trash", "memos", { deleted }),
  ]);

  return deleted;
};

export const moveMemosToNotebook = async (
  db: DatabaseAdapter,
  workspaceId: string,
  memoIds: string[],
  notebookId: string,
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
) => {
  const uniqueMemoIds = Array.from(new Set(memoIds));

  if (uniqueMemoIds.length === 0) {
    return 0;
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT id, notebook_id
       FROM memos
       WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${placeholders})`
    )
    .bind(workspaceId, ...uniqueMemoIds)
    .all<{ id: string; notebook_id: string }>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be moved.", 400);
  }

  const now = isoNow();
  const statements: PreparedStatementAdapter[] = [
    db
      .prepare(
        `UPDATE memos
         SET notebook_id = ?, updated_by = ?, updated_at = ?
         WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${placeholders})`
      )
      .bind(notebookId, actorLabel, now, workspaceId, ...uniqueMemoIds),
  ];

  for (const row of rows.results) {
    statements.push(
      auditStatement(db, actor.actorType, actor.actorId, "memo.move", "memo", row.id, {
        fromNotebookId: row.notebook_id,
        toNotebookId: notebookId,
      })
    );
  }

  await db.batch(statements);
  return uniqueMemoIds.length;
};

export const moveMemosRecord = async (
  db: DatabaseAdapter,
  workspaceId: string,
  memoIds: string[],
  notebookId: string,
  actor: AuditActor,
  actorLabel: string,
) => {
  if (!(await getNotebook(db, workspaceId, notebookId))) {
    throw new AppError("not_found", "Target notebook not found", 404);
  }
  return moveMemosToNotebook(db, workspaceId, memoIds, notebookId, actor, actorLabel);
};

export const mergeMemosRecord = async (
  db: DatabaseAdapter,
  workspaceId: string,
  input: { memoIds: string[]; notebookId?: string; title?: string },
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string,
  commit?: MemoMutationCommit,
) => {
  const uniqueMemoIds = Array.from(new Set(input.memoIds));

  if (uniqueMemoIds.length < 2) {
    throw new AppError("bad_request", "At least two memos are required to merge.", 400);
  }

  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, c.revision,
              c.content_json, c.content_markdown, c.content_text, c.content_hash,
              m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.workspace_id = ? AND m.id IN (${placeholders})`
    )
    .bind(workspaceId, ...uniqueMemoIds)
    .all<MemoDetailRow>();

  if (rows.results.length !== uniqueMemoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be merged.", 400);
  }

  const activeRows = rows.results.filter((row) => !row.is_deleted);
  if (activeRows.length !== uniqueMemoIds.length) {
    // A desktop outbox retry can arrive after the first merge committed but
    // before the client acknowledged its local placeholder. When every source
    // now points at the same live merge result, return that result instead of
    // treating the retry as a new merge. This makes the operation recoverable
    // after a lost response without ever creating a second server-side memo.
    const mergedTargetIds = new Set(
      rows.results
        .filter((row) => row.is_deleted && row.merged_into_memo_id)
        .map((row) => row.merged_into_memo_id as string),
    );
    if (!commit && activeRows.length === 0 && mergedTargetIds.size === 1) {
      const [mergedTargetId] = mergedTargetIds;
      const completedMerge = await getMemoDetail(db, workspaceId, mergedTargetId);
      const completedSourceIds = new Set(completedMerge?.sourceMemoIds ?? []);
      if (
        completedMerge
        && completedMerge.sourceMemoIds.length === uniqueMemoIds.length
        && uniqueMemoIds.every((memoId) => completedSourceIds.has(memoId))
      ) {
        return completedMerge;
      }
    }
    throw new AppError("missing_memos", "One or more memos cannot be merged.", 400);
  }

  if (input.notebookId && !(await getNotebook(db, workspaceId, input.notebookId))) {
    throw new AppError("not_found", "Target notebook not found", 404);
  }

  const ordered = uniqueMemoIds
    .map((memoId) => rows.results.find((row) => row.id === memoId))
    .filter((row): row is MemoDetailRow => Boolean(row));
  const notebookId = input.notebookId ?? ordered[0].notebook_id;
  const title = resolveMergedMemoTitle(input.title, ordered);
  const sourceDocs = ordered.map((memo) => {
    const contentJson = parseDoc(memo.content_json);
    const doc = resolveMemoContentDoc(contentJson, memo.content_markdown);
    if (!docToText(doc).trim() && memo.content_text.trim()) {
      throw new AppError("merge_content_unavailable", "One or more memo bodies could not be recovered safely.", 409);
    }
    return doc;
  });
  const contentJson = mergeMemoDocs(sourceDocs);
  const mergedMarkdown = docToMarkdown(contentJson);
  const contentText = docToText(contentJson);
  const tags = Array.from(new Set(ordered.flatMap((memo) => parseJsonArray(memo.tags_json))));
  const excerpt = createExcerpt(contentText || title);
  const contentHash = await sha256(mergedMarkdown + JSON.stringify(contentJson));
  const newMemoId = createId("memo");
  const now = isoNow();

  await db.batch([
    ...(commit?.before ?? []),
    db
      .prepare(
        `INSERT INTO memos (
          id, workspace_id, notebook_id, title, excerpt, tags_json, source_memo_ids, merge_source_count,
          created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newMemoId,
        workspaceId,
        notebookId,
        title,
        excerpt,
        JSON.stringify(tags),
        JSON.stringify(uniqueMemoIds),
        uniqueMemoIds.length,
        actorLabel,
        actorLabel,
        now,
        now
      ),
    db
      .prepare(
        `INSERT INTO memo_contents (
          memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(newMemoId, JSON.stringify(contentJson), mergedMarkdown, contentText, contentHash, now, now),
    upsertMemoSearchDocumentStatement(db, newMemoId, title, contentText, tags.join(" ")),
    db
      .prepare(
        `UPDATE memos
         SET is_deleted = 1, deleted_at = ?, merged_into_memo_id = ?, merged_at = ?, updated_at = ?
         WHERE workspace_id = ? AND id IN (${placeholders})`
      )
      .bind(now, newMemoId, now, now, workspaceId, ...uniqueMemoIds),
    db.prepare(`DELETE FROM memo_shares WHERE workspace_id = ? AND memo_id IN (${placeholders})`).bind(workspaceId, ...uniqueMemoIds),
    deleteMemoSearchDocumentsStatement(db, uniqueMemoIds),
    db
      .prepare(
        `UPDATE resources
         SET original_memo_id = COALESCE(original_memo_id, memo_id),
             memo_id = ?,
             updated_at = ?
         WHERE memo_id IN (${placeholders})`
      )
      .bind(newMemoId, now, ...uniqueMemoIds),
    auditStatement(db, actor.actorType, actor.actorId, "memo.merge", "memo", newMemoId, {
      sourceMemoIds: uniqueMemoIds,
    }),
    ...(commit?.after(newMemoId) ?? []),
  ]);

  const memo = await getMemoDetail(db, workspaceId, newMemoId);

  if (!memo) {
    throw new AppError("not_found", "Merged memo not found after create.", 404);
  }

  return memo;
};

export const createMemoRecord = async (
  db: DatabaseAdapter,
  workspaceId: string,
  input: { notebookId: string; title?: string; contentMarkdown?: string; tags?: string[]; createdAt?: string; updatedAt?: string },
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string
): Promise<MemoDetail> => {
  const tags = normalizeTags(input.tags);
  const contentMarkdown = input.contentMarkdown ?? "";
  const contentJson = markdownToDoc(contentMarkdown);
  const contentText = docToText(contentJson);
  const title = normalizeMemoTitle(input.title);
  const excerpt = createExcerpt(contentText);
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const id = createId("memo");
  const now = isoNow();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;

  await db.batch([
    db
      .prepare(
        `INSERT INTO memos (
          id, workspace_id, notebook_id, title, excerpt, tags_json, created_by, updated_by, created_at, updated_at
        ) SELECT ?, ?, id, ?, ?, ?, ?, ?, ?, ? FROM notebooks WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
      )
      .bind(id, workspaceId, title, excerpt, JSON.stringify(tags), actorLabel, actorLabel, createdAt, updatedAt, input.notebookId, workspaceId),
    db
      .prepare(
        `INSERT INTO memo_contents (
          memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(id, JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, createdAt, updatedAt),
    upsertMemoSearchDocumentStatement(db, id, title, contentText, tags.join(" ")),
    auditStatement(db, actor.actorType, actor.actorId, "memo.create", "memo", id, {
      notebookId: input.notebookId,
    }),
  ]);

  const memo = await getMemoDetail(db, workspaceId, id);

  if (!memo) {
    throw new Error("Memo was created but could not be read.");
  }

  return memo;
};

const normalizeImportSource = (value: string) => {
  const source = value.trim().toLocaleLowerCase("en-US");
  if (source.length > 80 || !/^[a-z0-9._-]+$/.test(source)) {
    throw new AppError(
      "invalid_import_source",
      "source must contain only letters, numbers, dots, underscores, or hyphens and be at most 80 characters",
      400,
    );
  }
  return source;
};

const parseImportDateTime = (value: unknown, field: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be a valid ISO 8601 date-time`);
  }
  return value.trim();
};

const parseMemoImportItem = (value: unknown, index: number) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`items[${index}] must be an object`);
  }

  const item = value as Record<string, unknown>;
  const externalId = getRequiredString(item.externalId, `items[${index}].externalId`);
  if (externalId.length > 512) {
    throw new Error(`items[${index}].externalId must be at most 512 characters`);
  }
  if (item.title !== undefined && typeof item.title !== "string") {
    throw new Error(`items[${index}].title must be a string`);
  }
  const title = typeof item.title === "string" ? item.title.trim() : undefined;
  if (title && title.length > 160) {
    throw new Error(`items[${index}].title must be at most 160 characters`);
  }
  if (item.contentMarkdown !== undefined && typeof item.contentMarkdown !== "string") {
    throw new Error(`items[${index}].contentMarkdown must be a string`);
  }
  if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== "string"))) {
    throw new Error(`items[${index}].tags must be an array of strings`);
  }
  if (Array.isArray(item.tags) && item.tags.length > 100) {
    throw new Error(`items[${index}].tags must contain at most 100 items`);
  }

  return {
    externalId,
    title: title || undefined,
    contentMarkdown: typeof item.contentMarkdown === "string" ? item.contentMarkdown : "",
    tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
    createdAt: parseImportDateTime(item.createdAt, `items[${index}].createdAt`),
    updatedAt: parseImportDateTime(item.updatedAt, `items[${index}].updatedAt`),
  };
};

const getMemoImportSource = async (db: DatabaseAdapter, workspaceId: string, source: string, externalId: string) =>
  db.prepare(
    `SELECT external_id, memo_id, source_updated_at
     FROM memo_import_sources
     WHERE workspace_id = ? AND source = ? AND external_id = ?`
  ).bind(workspaceId, source, externalId).first<MemoImportSourceRow>();

const discardUnlinkedImportedMemo = async (db: DatabaseAdapter, workspaceId: string, memoId: string) => {
  await db.batch([
    db.prepare(`DELETE FROM memo_revisions WHERE memo_id = ?`).bind(memoId),
    db.prepare(`DELETE FROM memo_contents WHERE memo_id = ?`).bind(memoId),
    db.prepare(`DELETE FROM memos WHERE id = ? AND workspace_id = ?`).bind(memoId, workspaceId),
  ]);
};

export const importMemosRecord = async (
  db: DatabaseAdapter,
  workspaceId: string,
  input: {
    source: string;
    notebookId: string;
    items: unknown;
    dryRun: boolean;
    actor: { actorType: "user" | "agent"; actorId: string | null };
    actorLabel: string;
  },
) => {
  const source = normalizeImportSource(input.source);
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 25) {
    throw new AppError("invalid_import_items", "items must contain between 1 and 25 memos", 400);
  }
  const notebook = await getNotebook(db, workspaceId, input.notebookId);
  if (!notebook) {
    throw new AppError("not_found", "Import destination notebook not found in the authenticated user's workspace.", 404);
  }

  const results: Array<Record<string, unknown>> = [];

  for (const [index, rawItem] of input.items.entries()) {
    let externalId: string | null = null;
    let createdMemoId: string | null = null;

    try {
      const item = parseMemoImportItem(rawItem, index);
      externalId = item.externalId;
      const existing = await getMemoImportSource(db, workspaceId, source, externalId);
      if (existing) {
        results.push({
          index,
          externalId,
          status: "skipped",
          reason: "already_imported",
          memo: await getMemoDetail(db, workspaceId, existing.memo_id, true),
          sourceUpdatedAt: existing.source_updated_at,
        });
        continue;
      }

      if (input.dryRun) {
        results.push({ index, externalId, status: "would_create" });
        continue;
      }

      const memo = await createMemoRecord(db, workspaceId, {
        notebookId: notebook.id,
        title: item.title,
        contentMarkdown: item.contentMarkdown,
        tags: item.tags,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }, input.actor, input.actorLabel);
      createdMemoId = memo.id;
      const now = isoNow();
      await db.batch([
        db.prepare(
          `INSERT INTO memo_import_sources (
             workspace_id, source, external_id, memo_id, source_updated_at, content_hash, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(workspaceId, source, externalId, memo.id, item.updatedAt ?? null, memo.contentHash, now, now),
        auditStatement(db, input.actor.actorType, input.actor.actorId, "memo.import", "memo", memo.id, {
          source,
          externalId,
          notebookId: notebook.id,
        }),
      ]);
      results.push({ index, externalId, status: "created", memo });
    } catch (error) {
      if (createdMemoId) {
        await discardUnlinkedImportedMemo(db, workspaceId, createdMemoId);
        const winner = externalId ? await getMemoImportSource(db, workspaceId, source, externalId) : null;
        if (winner) {
          results.push({
            index,
            externalId,
            status: "skipped",
            reason: "already_imported",
            memo: await getMemoDetail(db, workspaceId, winner.memo_id, true),
            sourceUpdatedAt: winner.source_updated_at,
          });
          continue;
        }
      }

      results.push({
        index,
        externalId,
        status: "failed",
        error: error instanceof Error ? error.message : "Import failed",
      });
    }
  }

  const count = (status: string) => results.filter((result) => result.status === status).length;
  return {
    dryRun: input.dryRun,
    source,
    notebookId: notebook.id,
    total: results.length,
    created: count("created"),
    skipped: count("skipped"),
    failed: count("failed"),
    wouldCreate: count("would_create"),
    results,
  };
};

export const updateMemoRecord = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  input: MemoUpdateInput,
  actor: { actorType: "user" | "agent"; actorId: string | null },
  actorLabel: string,
  requireEditSession = false,
  commit?: MemoMutationCommit,
): Promise<
  | { memo: MemoDetail; error?: never; message?: never; status?: never; details?: never }
  | { error: string; message: string; status?: number; details?: Record<string, unknown> }
> => {
  const current = await getMemoDetailRow(db, workspaceId, id);

  if (!current) {
    return { error: "not_found", message: "Memo not found" };
  }

  if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    return {
      error: "revision_conflict",
      message: "Memo was updated elsewhere. Reload before saving.",
      status: 409,
      details: {
        expectedRevision: input.expectedRevision,
        currentRevision: current.revision,
      },
    };
  }

  const hasDocumentUpdate = input.contentJson !== undefined || input.contentMarkdown !== undefined;
  let editSession: MemoEditSessionRow | null = null;

  if (requireEditSession && hasDocumentUpdate) {
    if (!input.editSessionId || !input.expectedContentHash || input.expectedRevision === undefined) {
      return {
        error: "edit_session_required",
        message: "A bound edit session is required to save note content.",
        status: 428,
      };
    }

    if (input.expectedContentHash !== current.content_hash) {
      return {
        error: "content_conflict",
        message: "Note content changed after this edit session started.",
        status: 409,
      };
    }

    editSession = await db.prepare(
      `SELECT id, memo_id, actor_type, actor_id, base_revision, base_content_hash, expires_at
       FROM memo_edit_sessions
       WHERE id = ? AND memo_id = ? AND actor_type = ? AND actor_id IS ? AND expires_at > ?`,
    )
      .bind(input.editSessionId, id, actor.actorType, actor.actorId, isoNow())
      .first<MemoEditSessionRow>();

    if (
      !editSession ||
      !isMemoEditBindingValid(
        { memoId: id, revision: current.revision, contentHash: current.content_hash },
        {
          id: editSession.id,
          memoId: editSession.memo_id,
          baseRevision: editSession.base_revision,
          baseContentHash: editSession.base_content_hash,
        },
        {
          editSessionId: input.editSessionId,
          memoId: id,
          expectedRevision: input.expectedRevision,
          expectedContentHash: input.expectedContentHash,
        },
      )
    ) {
      return {
        error: "edit_session_conflict",
        message: "The edit session is stale or belongs to another note.",
        status: 409,
      };
    }
  }

  const isPinned = input.isPinned ?? Boolean(current.is_pinned);
  const hasContentUpdate =
    input.notebookId !== undefined ||
    input.title !== undefined ||
    input.contentJson !== undefined ||
    input.contentMarkdown !== undefined ||
    input.tags !== undefined ||
    input.createdAt !== undefined ||
    input.updatedAt !== undefined;
  const now = isoNow();
  const updatedAt = input.updatedAt ?? now;

  if (!hasContentUpdate) {
    if (input.isPinned === undefined || isPinned === Boolean(current.is_pinned)) {
      if (commit) await db.batch([...commit.before, ...commit.after(id)]);
      const memo = await getMemoDetail(db, workspaceId, id);

      if (!memo) {
        return { error: "not_found", message: "Memo not found after update" };
      }

      return { memo };
    }

    await db.batch([
      ...(commit?.before ?? []),
      db
        .prepare(
          `UPDATE memos
           SET is_pinned = ?, updated_by = ?, updated_at = ?, created_at = COALESCE(?, created_at)
           WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
        )
        .bind(isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id, workspaceId),
      auditStatement(db, actor.actorType, actor.actorId, isPinned ? "memo.pin" : "memo.unpin", "memo", id, {}),
      ...(commit?.after(id) ?? []),
    ]);

    const memo = await getMemoDetail(db, workspaceId, id);

    if (!memo) {
      return { error: "not_found", message: "Memo not found after update" };
    }

    return { memo };
  }

  const currentContentJson = parseDoc(current.content_json);
  const contentJson =
    input.contentJson !== undefined
      ? input.contentJson
      : input.contentMarkdown !== undefined
        ? markdownToDoc(input.contentMarkdown)
        : currentContentJson;
  const contentMarkdown =
    input.contentMarkdown !== undefined
      ? input.contentMarkdown
      : input.contentJson !== undefined
        ? docToMarkdown(contentJson)
        : current.content_markdown;
  const contentText = hasDocumentUpdate ? docToText(contentJson) : current.content_text;
  const title =
    input.title !== undefined ? normalizeMemoTitle(input.title) : normalizeMemoTitle(current.title);
  if (
    !input.allowDestructiveOverwrite &&
    isSuspiciousMemoOverwrite(current.title, current.content_text, title, contentText)
  ) {
    return {
      error: "suspicious_memo_overwrite",
      message: "Save blocked because the title changed while most of the note content disappeared.",
    };
  }
  const tags = input.tags === undefined ? parseJsonArray(current.tags_json) : normalizeTags(input.tags);
  const excerpt = createExcerpt(contentText);
  const notebookId = input.notebookId ?? current.notebook_id;
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const unchanged =
    notebookId === current.notebook_id
    && title === normalizeMemoTitle(current.title)
    && JSON.stringify(tags) === current.tags_json
    && isPinned === Boolean(current.is_pinned)
    && contentHash === current.content_hash
    && input.createdAt === undefined
    && input.updatedAt === undefined;

  if (unchanged) {
    if (commit) await db.batch([...commit.before, ...commit.after(id)]);
    return { memo: mapMemoDetail(current) };
  }

  const nextRevision = current.revision + 1;
  const revisionStatements = (await shouldSnapshotMemoRevisionService(db, current, title, JSON.stringify(tags), contentHash, updatedAt))
    ? [createMemoRevisionStatementService(db, current, actorLabel, updatedAt)]
    : [];
  const editSessionStatements = editSession
    ? [
        db.prepare(
          `UPDATE memo_edit_sessions
           SET base_revision = ?, base_content_hash = ?, updated_at = ?
           WHERE id = ? AND memo_id = ? AND base_revision = ? AND base_content_hash = ?`,
        ).bind(nextRevision, contentHash, updatedAt, editSession.id, id, current.revision, current.content_hash),
      ]
    : requireEditSession
      ? [
          db.prepare(
            `UPDATE memo_edit_sessions
             SET base_revision = ?, base_content_hash = ?, updated_at = ?
             WHERE memo_id = ? AND actor_type = ? AND actor_id IS ?
               AND base_revision = ? AND base_content_hash = ? AND expires_at > ?`,
          ).bind(
            nextRevision,
            contentHash,
            updatedAt,
            id,
            actor.actorType,
            actor.actorId,
            current.revision,
            current.content_hash,
            updatedAt,
          ),
        ]
      : [];

  await db.batch([
    ...(commit?.before ?? []),
    ...revisionStatements,
    db
      .prepare(
        `UPDATE memos
         SET notebook_id = ?, title = ?, excerpt = ?, tags_json = ?, is_pinned = ?, updated_by = ?, updated_at = ?, created_at = COALESCE(?, created_at)
         WHERE id = ? AND workspace_id = ? AND is_deleted = 0
           AND EXISTS (SELECT 1 FROM notebooks n WHERE n.id = ? AND n.workspace_id = ? AND n.is_deleted = 0)`
      )
      .bind(notebookId, title, excerpt, JSON.stringify(tags), isPinned ? 1 : 0, actorLabel, updatedAt, input.createdAt ?? null, id, workspaceId, notebookId, workspaceId),
    db
      .prepare(
        `UPDATE memo_contents
         SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
             revision = ?, updated_at = ?, created_at = COALESCE(?, created_at)
         WHERE memo_id = ?`
      )
      .bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, updatedAt, input.createdAt ?? null, id),
    upsertMemoSearchDocumentStatement(db, id, title, contentText, tags.join(" ")),
    ...editSessionStatements,
    auditStatement(db, actor.actorType, actor.actorId, "memo.update", "memo", id, {
      revision: nextRevision,
    }),
    ...(commit?.after(id) ?? []),
  ]);

  const memo = await getMemoDetail(db, workspaceId, id);

  if (!memo) {
    return { error: "not_found", message: "Memo not found after update" };
  }

  return { memo };
};

const parseDoc = (json: string): TiptapDoc => {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? (value as TiptapDoc) : emptyDoc();
  } catch {
    return emptyDoc();
  }
};

const normalizeMemoTitle = (value: string | null | undefined) => {
  const title = value?.trim();
  return title || DEFAULT_MEMO_TITLE;
};
