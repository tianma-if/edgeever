import {
  createExcerpt,
  DEFAULT_MEMO_TITLE,
  docToMarkdown,
  docToText,
  emptyDoc,
  type MemoDetail,
  type MemoRevision,
  type TiptapDoc,
} from "@edgeever/shared";
import type { AuditActor } from "./api-context";
import { AppError } from "./app-error";
import { auditStatement } from "./audit";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { sha256 } from "./hash-utils";
import { upsertMemoSearchDocumentStatement } from "./memo-search-index";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

const REVISION_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

export type MemoRevisionRow = {
  id: string;
  memo_id: string;
  revision: number;
  title: string | null;
  tags_json: string;
  content_json: string;
  content_markdown: string;
  content_text: string;
  content_hash: string;
  created_by: string;
  created_at: string;
};

export type MemoRevisionSourceRow = {
  id: string;
  revision: number;
  title: string | null;
  tags_json: string;
  content_json: string;
  content_markdown: string;
  content_text: string;
  content_hash: string;
};

type MemoRevisionDependencies = {
  getMemoDetail: (
    db: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
    includeDeleted?: boolean,
  ) => Promise<MemoDetail | null>;
  getMemoDetailRow: (
    db: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
  ) => Promise<MemoRevisionSourceRow | null>;
};

const parseDoc = (json: string): TiptapDoc => {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? value as TiptapDoc : emptyDoc();
  } catch {
    return emptyDoc();
  }
};

const normalizeMemoTitle = (value: string | null | undefined) => {
  const title = value?.trim();
  return title || DEFAULT_MEMO_TITLE;
};

export const mapMemoRevision = (row: MemoRevisionRow): MemoRevision => ({
  id: row.id,
  memoId: row.memo_id,
  revision: row.revision,
  title: row.title,
  tags: parseJsonArray(row.tags_json),
  contentMarkdown: row.content_markdown,
  contentText: row.content_text,
  contentHash: row.content_hash,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

export const getMemoRevisionRow = async (
  db: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
  revisionId: string,
): Promise<MemoRevisionRow | null> => db.prepare(
  `SELECT mr.id, mr.memo_id, mr.revision, mr.title, mr.tags_json, mr.content_json, mr.content_markdown,
          mr.content_text, mr.content_hash, mr.created_by, mr.created_at
   FROM memo_revisions mr
   INNER JOIN memos m ON m.id = mr.memo_id
   WHERE mr.id = ? AND mr.memo_id = ? AND m.workspace_id = ?`,
).bind(revisionId, memoId, workspaceId).first<MemoRevisionRow>();

export const listMemoRevisions = async (
  db: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
  limit: number,
  getMemoDetail: MemoRevisionDependencies["getMemoDetail"],
  includeDeleted = true,
): Promise<MemoRevision[]> => {
  const memo = await getMemoDetail(db, workspaceId, memoId, includeDeleted);
  if (!memo) throw new AppError("not_found", "Memo not found", 404);

  const rows = await db.prepare(
    `SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown,
            content_text, content_hash, created_by, created_at
     FROM memo_revisions
     WHERE memo_id = ?
     ORDER BY revision DESC, created_at DESC
     LIMIT ?`,
  ).bind(memoId, limit).all<MemoRevisionRow>();

  return rows.results.map(mapMemoRevision);
};

export const createMemoRevisionStatement = (
  db: DatabaseAdapter,
  current: MemoRevisionSourceRow,
  actorLabel: string,
  createdAt: string,
): PreparedStatementAdapter => db.prepare(
  `INSERT INTO memo_revisions (
    id, memo_id, revision, title, content_json, content_markdown,
    content_hash, created_by, created_at, tags_json, content_text
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).bind(
  createId("rev"),
  current.id,
  current.revision,
  current.title,
  current.content_json,
  current.content_markdown,
  current.content_hash,
  actorLabel,
  createdAt,
  current.tags_json,
  current.content_text,
);

const getLatestMemoRevisionRow = (
  db: DatabaseAdapter,
  memoId: string,
) => db.prepare(
  `SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown,
          content_text, content_hash, created_by, created_at
   FROM memo_revisions
   WHERE memo_id = ?
   ORDER BY created_at DESC, revision DESC
   LIMIT 1`,
).bind(memoId).first<MemoRevisionRow>();

export const shouldSnapshotMemoRevision = async (
  db: DatabaseAdapter,
  current: MemoRevisionSourceRow,
  nextTitle: string | null,
  nextTagsJson: string,
  nextContentHash: string,
  now: string,
) => {
  const changed = (current.title ?? "") !== (nextTitle ?? "")
    || current.tags_json !== nextTagsJson
    || current.content_hash !== nextContentHash;
  if (!changed) return false;

  const latest = await getLatestMemoRevisionRow(db, current.id);
  if (!latest) return true;

  const alreadyCapturedCurrent = (latest.title ?? "") === (current.title ?? "")
    && latest.tags_json === current.tags_json
    && latest.content_hash === current.content_hash;
  if (alreadyCapturedCurrent) return false;

  return Date.parse(now) - Date.parse(latest.created_at) >= REVISION_SNAPSHOT_INTERVAL_MS;
};

export const restoreMemoRevision = async (
  db: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
  revisionId: string,
  actor: AuditActor,
  actorLabel: string,
  dependencies: Pick<MemoRevisionDependencies, "getMemoDetail" | "getMemoDetailRow">,
) => {
  const current = await dependencies.getMemoDetailRow(db, workspaceId, memoId);
  if (!current) throw new AppError("not_found", "Memo not found", 404);

  const revision = await getMemoRevisionRow(db, workspaceId, memoId, revisionId);
  if (!revision) throw new AppError("not_found", "Memo revision not found", 404);

  const tags = parseJsonArray(revision.tags_json);
  const contentJson = parseDoc(revision.content_json);
  const contentMarkdown = revision.content_markdown || docToMarkdown(contentJson);
  const contentText = revision.content_text || docToText(contentJson);
  const title = normalizeMemoTitle(revision.title);
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const nextRevision = current.revision + 1;
  const now = isoNow();

  await db.batch([
    createMemoRevisionStatement(db, current, actorLabel, now),
    db.prepare(
      `UPDATE memos
       SET title = ?, excerpt = ?, tags_json = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND is_deleted = 0`,
    ).bind(title, createExcerpt(contentText), JSON.stringify(tags), actorLabel, now, memoId, workspaceId),
    db.prepare(
      `UPDATE memo_contents
       SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
           revision = ?, updated_at = ?
       WHERE memo_id = ?`,
    ).bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, now, memoId),
    upsertMemoSearchDocumentStatement(db, memoId, title, contentText, tags.join(" ")),
    auditStatement(db, actor.actorType, actor.actorId, "memo.revision_restore", "memo", memoId, {
      revisionId,
      restoredRevision: revision.revision,
      revision: nextRevision,
    }),
  ]);

  const memo = await dependencies.getMemoDetail(db, workspaceId, memoId);
  if (!memo) throw new AppError("not_found", "Memo not found after revision restore", 404);
  return memo;
};
