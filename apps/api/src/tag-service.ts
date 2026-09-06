import { normalizeTags, type TagSummary } from "@edgeever/shared";
import type { AuditActor } from "./api-context";
import { AppError } from "./app-error";
import { auditStatement } from "./audit";
import { isoNow, parseJsonArray } from "./entity-utils";
import { upsertMemoSearchDocumentStatement } from "./memo-search-index";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

type TagSummaryRow = {
  name: string;
  memo_count: number;
  updated_at: string | null;
};

type MemoTagUpdateRow = {
  notebook_id: string;
  id: string;
  title: string | null;
  tags_json: string;
  content_text: string;
};

const mapTagSummary = (row: TagSummaryRow): TagSummary => ({
  name: row.name,
  memoCount: row.memo_count,
  updatedAt: row.updated_at,
});

const getMemoRowsByTag = async (db: DatabaseAdapter, workspaceId: string, tag: string) => {
  const rows = await db
    .prepare(
      `SELECT m.id, m.title, m.tags_json, m.notebook_id, c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.workspace_id = ? AND m.is_deleted = 0
         AND EXISTS (
           SELECT 1
           FROM memo_tags mt
           WHERE mt.memo_id = m.id AND mt.workspace_id = ? AND mt.name = ?
         )`
    )
    .bind(workspaceId, workspaceId, tag)
    .all<MemoTagUpdateRow>();

  return rows.results;
};

const replaceTag = (currentTags: string[], oldTag: string, nextTag: string | null) =>
  normalizeTags(
    currentTags.flatMap((tag) => {
      if (tag !== oldTag) return [tag];
      return nextTag ? [nextTag] : [];
    })
  );

export const listTagSummaries = async (db: DatabaseAdapter, workspaceId: string): Promise<TagSummary[]> => {
  const rows = await db
    .prepare(
      `SELECT mt.name AS name,
              COUNT(DISTINCT m.id) AS memo_count,
              MAX(m.updated_at) AS updated_at
       FROM memo_tags mt
       INNER JOIN memos m ON m.id = mt.memo_id AND m.workspace_id = mt.workspace_id
       WHERE mt.workspace_id = ? AND m.is_deleted = 0
       GROUP BY mt.name
       ORDER BY mt.normalized_name ASC, mt.name ASC`
    )
    .bind(workspaceId)
    .all<TagSummaryRow>();

  return rows.results
    .filter((row) => typeof row.name === "string" && row.name.trim())
    .map(mapTagSummary);
};

export const updateTagAcrossMemos = async (
  db: DatabaseAdapter,
  workspaceId: string,
  oldTag: string,
  nextTag: string | null,
  actor: AuditActor,
  actorLabel: string
) => {
  const normalizedOld = normalizeTags([oldTag])[0];
  const normalizedNext = nextTag === null ? null : normalizeTags([nextTag])[0];

  if (!normalizedOld || normalizedOld === normalizedNext) return 0;

  const rows = await getMemoRowsByTag(db, workspaceId, normalizedOld);
  const now = isoNow();
  const statements: PreparedStatementAdapter[] = [];
  let updated = 0;

  for (const row of rows) {
    const currentTags = parseJsonArray(row.tags_json);
    if (!currentTags.includes(normalizedOld)) continue;

    const nextTags = replaceTag(currentTags, normalizedOld, normalizedNext);
    statements.push(
      db
        .prepare(
          `UPDATE memos
           SET tags_json = ?, updated_by = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
        )
        .bind(JSON.stringify(nextTags), actorLabel, now, row.id, workspaceId),
      upsertMemoSearchDocumentStatement(db, row.id, row.title, row.content_text, nextTags.join(" ")),
      auditStatement(db, actor.actorType, actor.actorId, normalizedNext ? "tag.rename" : "tag.delete", "memo", row.id, {
        from: normalizedOld,
        to: normalizedNext,
      })
    );
    updated += 1;
  }

  if (statements.length > 0) await db.batch(statements);
  return updated;
};

export const previewTagRename = async (
  db: DatabaseAdapter,
  workspaceId: string,
  oldTag: string,
  nextTag: string | null
) => {
  const normalizedOld = normalizeTags([oldTag])[0];
  const normalizedNext = nextTag === null ? null : normalizeTags([nextTag])[0];

  if (!normalizedOld || normalizedOld === normalizedNext) {
    return { dryRun: true, updated: 0, changes: [] };
  }

  const rows = await getMemoRowsByTag(db, workspaceId, normalizedOld);
  const changes = rows.map((row) => {
    const currentTags = parseJsonArray(row.tags_json);
    return {
      memoId: row.id,
      title: row.title,
      currentTags,
      nextTags: replaceTag(currentTags, normalizedOld, normalizedNext),
    };
  });

  return { dryRun: true, updated: changes.length, changes };
};

export const updateTagsForMemos = async (
  db: DatabaseAdapter,
  input: {
    workspaceId: string;
    memoIds: string[];
    tags: string[];
    mode: "add" | "remove";
    dryRun: boolean;
    actor: AuditActor;
    actorLabel: string;
  }
) => {
  const memoIds = Array.from(new Set(input.memoIds));
  const tags = normalizeTags(input.tags);

  if (memoIds.length === 0 || tags.length === 0) {
    throw new AppError("invalid_params", "memoIds and tags must include at least one item", 400);
  }

  const placeholders = memoIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT m.id, m.title, m.tags_json, m.notebook_id, c.content_text
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.workspace_id = ? AND m.is_deleted = 0 AND m.id IN (${placeholders})`
    )
    .bind(input.workspaceId, ...memoIds)
    .all<MemoTagUpdateRow>();

  if (rows.results.length !== memoIds.length) {
    throw new AppError("missing_memos", "One or more memos cannot be updated.", 400);
  }

  const changes = rows.results
    .map((row) => {
      const currentTags = parseJsonArray(row.tags_json);
      const nextTags = input.mode === "add"
        ? normalizeTags([...currentTags, ...tags])
        : currentTags.filter((tag) => !tags.includes(tag));
      return { notebookId: row.notebook_id, memoId: row.id, title: row.title, currentTags, nextTags, contentText: row.content_text };
    })
    .filter((change) => JSON.stringify(change.currentTags) !== JSON.stringify(change.nextTags));

  if (input.dryRun) {
    return {
      dryRun: true,
      updated: changes.length,
      changes: changes.map(({ contentText: _contentText, ...change }) => change),
    };
  }

  if (changes.length === 0) return { ok: true, updated: 0 };

  const now = isoNow();
  const statements: PreparedStatementAdapter[] = [];
  for (const change of changes) {
    statements.push(
      db
        .prepare(
          `UPDATE memos
           SET tags_json = ?, updated_by = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
        )
        .bind(JSON.stringify(change.nextTags), input.actorLabel, now, change.memoId, input.workspaceId),
      upsertMemoSearchDocumentStatement(
        db,
        change.memoId,
        change.title,
        change.contentText,
        change.nextTags.join(" "),
      ),
      auditStatement(
        db,
        input.actor.actorType,
        input.actor.actorId,
        input.mode === "add" ? "tag.add" : "tag.remove",
        "memo",
        change.memoId,
        { tags, learning: { version: 1, workspaceId: input.workspaceId,
          fromNotebookId: change.notebookId, toNotebookId: change.notebookId,
          beforeTags: change.currentTags, afterTags: change.nextTags } }
      )
    );
  }

  await db.batch(statements);
  return { ok: true, updated: changes.length };
};
