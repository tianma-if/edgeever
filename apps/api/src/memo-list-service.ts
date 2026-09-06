import {
  createExcerpt,
  DEFAULT_MEMO_TITLE,
  docToText,
  markdownToDoc,
  type MemoSummary,
} from "@edgeever/shared";
import { parseJsonArray } from "./entity-utils";
import type { DatabaseAdapter } from "./storage-contract";

export type MemoSummaryRow = {
  id: string;
  notebook_id: string;
  title: string | null;
  excerpt: string;
  content_text?: string | null;
  content_markdown?: string | null;
  tags_json: string;
  is_pinned: number;
  is_archived: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
};

type MemoListSortMode = "updated-desc" | "created-desc" | "title-asc";
type MemoListFilterMode = "all" | "tagged" | "untagged" | "pinned";

type MemoListCursor = {
  sort: MemoListSortMode;
  id: string;
  pinned?: number;
  updatedAt?: string;
  createdAt?: string;
  deletedAt?: string | null;
  title?: string;
};

export type ListMemosInput = {
  workspaceId: string;
  notebookId?: string;
  includeNotebookDescendants?: boolean;
  query?: string;
  tag?: string;
  includeTrash?: boolean;
  sort?: string;
  filter?: string;
  limit?: number;
  cursor?: string;
};

export type ListMemosResult = {
  memos: MemoSummary[];
  totalCount: number;
  nextCursor: string | null;
};

const DEFAULT_MEMO_LIST_LIMIT = 100;
const MAX_MEMO_LIST_LIMIT = 200;

export const mapMemoSummary = (row: MemoSummaryRow): MemoSummary => ({
  id: row.id,
  notebookId: row.notebook_id,
  title: row.title,
  excerpt:
    row.excerpt ||
    createExcerpt(row.content_text ?? "") ||
    createExcerpt(docToText(markdownToDoc(row.content_markdown ?? ""))),
  tags: parseJsonArray(row.tags_json),
  isPinned: Boolean(row.is_pinned),
  isArchived: Boolean(row.is_archived),
  isDeleted: Boolean(row.is_deleted),
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});

const normalizeMemoTitle = (value: string | null | undefined) => {
  const title = value?.trim();
  return title || DEFAULT_MEMO_TITLE;
};

const normalizeMemoListSort = (value: string | undefined): MemoListSortMode =>
  value === "created-desc" || value === "title-asc" ? value : "updated-desc";

const normalizeMemoListFilter = (value: string | undefined): MemoListFilterMode =>
  value === "tagged" || value === "untagged" || value === "pinned" ? value : "all";

const clampNumber = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
};

const encodeMemoListCursor = (
  memo: MemoSummaryRow,
  sort: MemoListSortMode,
  includeTrash: boolean,
) => {
  const cursor: MemoListCursor = { sort, id: memo.id };
  if (includeTrash) cursor.deletedAt = memo.deleted_at;
  else cursor.pinned = memo.is_pinned;

  if (sort === "created-desc") cursor.createdAt = memo.created_at;
  else if (sort === "title-asc") {
    cursor.title = normalizeMemoTitle(memo.title).toLocaleLowerCase();
    cursor.updatedAt = memo.updated_at;
  } else cursor.updatedAt = memo.updated_at;

  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const decodeMemoListCursor = (
  value: string | undefined,
  sort: MemoListSortMode,
): MemoListCursor | null => {
  if (!value) return null;

  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    const cursor = JSON.parse(new TextDecoder().decode(bytes)) as Partial<MemoListCursor>;
    return cursor.sort === sort && typeof cursor.id === "string"
      ? cursor as MemoListCursor
      : null;
  } catch {
    return null;
  }
};

export const toFtsQuery = (value: string) => {
  const tokens = value.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return tokens
    .slice(0, 8)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" ");
};

export const escapeLike = (value: string) =>
  value.replace(/[\\%_]/g, (character) => `\\${character}`);

export const listMemos = async (
  database: DatabaseAdapter,
  input: ListMemosInput,
): Promise<ListMemosResult> => {
  const notebookId = input.notebookId;
  const query = input.query?.trim();
  const tag = input.tag?.trim();
  const includeTrash = input.includeTrash === true;
  const sort = normalizeMemoListSort(input.sort);
  const filter = normalizeMemoListFilter(input.filter);
  const limit = clampNumber(input.limit ?? DEFAULT_MEMO_LIST_LIMIT, 1, MAX_MEMO_LIST_LIMIT);
  const cursor = decodeMemoListCursor(input.cursor, sort);
  const deletedClause = includeTrash ? "m.is_deleted = 1" : "m.is_deleted = 0";
  const titleSortExpression = `LOWER(COALESCE(NULLIF(m.title, ''), '${DEFAULT_MEMO_TITLE}'))`;
  const baseConditions = ["m.workspace_id = ?", deletedClause];
  const baseBinds: unknown[] = [input.workspaceId];

  if (notebookId) {
    if (input.includeNotebookDescendants) {
      baseConditions.push(
        `m.notebook_id IN (
           WITH RECURSIVE descendants(id) AS (
             SELECT id
             FROM notebooks
             WHERE workspace_id = ? AND id = ? AND is_deleted = 0

             UNION

             SELECT n.id
             FROM notebooks n
             INNER JOIN descendants d ON n.parent_id = d.id
             WHERE n.workspace_id = ? AND n.is_deleted = 0
           )
           SELECT id FROM descendants
         )`,
      );
      baseBinds.push(input.workspaceId, notebookId, input.workspaceId);
    } else {
      baseConditions.push("m.notebook_id = ?");
      baseBinds.push(notebookId);
    }
  }

  if (tag) {
    baseConditions.push(
      "EXISTS (SELECT 1 FROM memo_tags mt WHERE mt.memo_id = m.id AND mt.workspace_id = ? AND mt.normalized_name = LOWER(?))",
    );
    baseBinds.push(input.workspaceId, tag);
  }

  if (filter === "tagged") baseConditions.push("m.tags_json <> '[]'");
  else if (filter === "untagged") baseConditions.push("m.tags_json = '[]'");
  else if (filter === "pinned") baseConditions.push("m.is_pinned = 1");

  const getOrderBy = () => {
    if (includeTrash) return "m.deleted_at DESC, m.id DESC";
    if (sort === "created-desc") return "m.is_pinned DESC, m.created_at DESC, m.id DESC";
    if (sort === "title-asc") {
      return `m.is_pinned DESC, ${titleSortExpression} ASC, m.updated_at DESC, m.id DESC`;
    }
    return "m.is_pinned DESC, m.updated_at DESC, m.id DESC";
  };

  const cursorConditions = [...baseConditions];
  const cursorBinds = [...baseBinds];
  if (cursor) {
    if (includeTrash) {
      cursorConditions.push("(m.deleted_at < ? OR (m.deleted_at = ? AND m.id < ?))");
      cursorBinds.push(cursor.deletedAt ?? "", cursor.deletedAt ?? "", cursor.id);
    } else if (sort === "created-desc") {
      cursorConditions.push("(m.is_pinned < ? OR (m.is_pinned = ? AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))))");
      cursorBinds.push(cursor.pinned ?? 0, cursor.pinned ?? 0, cursor.createdAt ?? "", cursor.createdAt ?? "", cursor.id);
    } else if (sort === "title-asc") {
      cursorConditions.push(
        `(m.is_pinned < ? OR (m.is_pinned = ? AND (${titleSortExpression} > ? OR (${titleSortExpression} = ? AND (m.updated_at < ? OR (m.updated_at = ? AND m.id < ?))))))`,
      );
      cursorBinds.push(cursor.pinned ?? 0, cursor.pinned ?? 0, cursor.title ?? "", cursor.title ?? "", cursor.updatedAt ?? "", cursor.updatedAt ?? "", cursor.id);
    } else {
      cursorConditions.push("(m.is_pinned < ? OR (m.is_pinned = ? AND (m.updated_at < ? OR (m.updated_at = ? AND m.id < ?))))");
      cursorBinds.push(cursor.pinned ?? 0, cursor.pinned ?? 0, cursor.updatedAt ?? "", cursor.updatedAt ?? "", cursor.id);
    }
  }

  const pageLimit = limit + 1;
  const finish = (rows: MemoSummaryRow[], totalCount: number | undefined): ListMemosResult => {
    const page = rows.slice(0, limit);
    return {
      memos: page.map(mapMemoSummary),
      totalCount: totalCount ?? page.length,
      nextCursor: rows.length > limit
        ? encodeMemoListCursor(page[page.length - 1], sort, includeTrash)
        : null,
    };
  };

  if (query) {
    const ftsQuery = toFtsQuery(query);
    const likeQuery = `%${escapeLike(query)}%`;
    if (ftsQuery) {
      const searchPrefix = [ftsQuery, likeQuery, likeQuery, likeQuery];
      const [rows, totalRow] = await Promise.all([
        database.prepare(
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
                  m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
                  mc.content_text, mc.content_markdown
           FROM search_matches s
           INNER JOIN memos m ON m.id = s.memo_id
           INNER JOIN memo_contents mc ON mc.memo_id = m.id
           WHERE ${cursorConditions.join(" AND ")}
           ORDER BY ${getOrderBy()}
           LIMIT ?`,
        ).bind(...searchPrefix, ...cursorBinds, pageLimit).all<MemoSummaryRow>(),
        database.prepare(
          `WITH raw_matches(memo_id) AS (
             SELECT memo_id
             FROM memos_fts
             WHERE memos_fts MATCH ?

             UNION ALL

             SELECT m.id
             FROM memos m
             INNER JOIN memo_contents c ON c.memo_id = m.id
             WHERE m.title LIKE ? ESCAPE '\\'
                OR c.content_text LIKE ? ESCAPE '\\'
                OR m.tags_json LIKE ? ESCAPE '\\'
           ),
           search_matches AS (
             SELECT memo_id
             FROM raw_matches
             GROUP BY memo_id
           )
           SELECT COUNT(*) AS count
           FROM search_matches s
           INNER JOIN memos m ON m.id = s.memo_id
           WHERE ${baseConditions.join(" AND ")}`,
        ).bind(...searchPrefix, ...baseBinds).first<{ count: number }>(),
      ]);
      return finish(rows.results, totalRow?.count);
    }

    const searchClause = "(m.title LIKE ? ESCAPE '\\' OR mc.content_text LIKE ? ESCAPE '\\' OR m.tags_json LIKE ? ESCAPE '\\')";
    const searchConditions = [...baseConditions, searchClause];
    const searchBinds = [...baseBinds, likeQuery, likeQuery, likeQuery];
    const searchCursorConditions = [...cursorConditions, searchClause];
    const searchCursorBinds = [...cursorBinds, likeQuery, likeQuery, likeQuery];
    const [rows, totalRow] = await Promise.all([
      database.prepare(
        `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
                mc.content_text, mc.content_markdown
         FROM memos m
         INNER JOIN memo_contents mc ON mc.memo_id = m.id
         WHERE ${searchCursorConditions.join(" AND ")}
         ORDER BY ${getOrderBy()}
         LIMIT ?`,
      ).bind(...searchCursorBinds, pageLimit).all<MemoSummaryRow>(),
      database.prepare(
        `SELECT COUNT(*) AS count
         FROM memos m
         INNER JOIN memo_contents mc ON mc.memo_id = m.id
         WHERE ${searchConditions.join(" AND ")}`,
      ).bind(...searchBinds).first<{ count: number }>(),
    ]);
    return finish(rows.results, totalRow?.count);
  }

  const [rows, totalRow] = await Promise.all([
    database.prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
              mc.content_text, mc.content_markdown
       FROM memos m
       INNER JOIN memo_contents mc ON mc.memo_id = m.id
       WHERE ${cursorConditions.join(" AND ")}
       ORDER BY ${getOrderBy()}
       LIMIT ?`,
    ).bind(...cursorBinds, pageLimit).all<MemoSummaryRow>(),
    database.prepare(
      `SELECT COUNT(*) AS count
       FROM memos m
       WHERE ${baseConditions.join(" AND ")}`,
    ).bind(...baseBinds).first<{ count: number }>(),
  ]);
  return finish(rows.results, totalRow?.count);
};
