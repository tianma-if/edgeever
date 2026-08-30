import {
  createExcerpt,
  DEFAULT_MEMO_TITLE,
  docToMarkdown,
  docToText,
  emptyDoc,
  normalizeTags,
  type JsonBackupMemo,
  type JsonBackupNotebook,
  type TiptapDoc,
} from "@edgeever/shared";
import { AppError } from "./app-error";
import { audit } from "./audit";
import { createId } from "./entity-utils";
import { sha256 } from "./hash-utils";
import { upsertMemoSearchDocumentStatement } from "./memo-search-index";
import type { DatabaseAdapter } from "./storage-contract";

const parseBackupDoc = (value: unknown): TiptapDoc => {
  try {
    const parsed = JSON.parse(JSON.stringify(value));
    return parsed && typeof parsed === "object" ? parsed as TiptapDoc : emptyDoc();
  } catch {
    return emptyDoc();
  }
};

const normalizeMemoTitle = (value: string | null | undefined) => {
  const title = value?.trim();
  return title || DEFAULT_MEMO_TITLE;
};

const assertIdsAvailableInWorkspace = async (
  db: DatabaseAdapter,
  table: "notebooks" | "memos",
  workspaceId: string,
  ids: string[],
) => {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  const collision = await db.prepare(
    `SELECT id FROM ${table} WHERE workspace_id <> ? AND id IN (${placeholders}) LIMIT 1`,
  ).bind(workspaceId, ...ids).first<{ id: string }>();
  if (collision) {
    throw new AppError("cross_workspace_id_conflict", "Backup contains an ID already used by another user.", 409);
  }
};

const assertNotebookIdsInWorkspace = async (
  db: DatabaseAdapter,
  workspaceId: string,
  ids: string[],
) => {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return;
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = await db.prepare(
    `SELECT id FROM notebooks WHERE workspace_id = ? AND id IN (${placeholders})`,
  ).bind(workspaceId, ...uniqueIds).all<{ id: string }>();
  if (rows.results.length !== uniqueIds.length) {
    throw new AppError("invalid_backup_workspace", "Backup references a notebook outside the current workspace.", 400);
  }
};

export const restoreJsonNotebooks = async (
  db: DatabaseAdapter,
  workspaceId: string,
  notebooks: JsonBackupNotebook[],
) => {
  await assertIdsAvailableInWorkspace(db, "notebooks", workspaceId, notebooks.map((notebook) => notebook.id));
  const importedIds = new Set(notebooks.map((notebook) => notebook.id));
  const externalParentIds = notebooks
    .map((notebook) => notebook.parentId)
    .filter((id): id is string => Boolean(id) && !importedIds.has(id as string));
  await assertNotebookIdsInWorkspace(db, workspaceId, externalParentIds);

  await db.batch(notebooks.map((notebook) => db.prepare(
    `INSERT INTO notebooks (
      id, workspace_id, parent_id, name, slug, icon, color, sort_order, is_deleted, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      parent_id = excluded.parent_id,
      name = excluded.name,
      slug = excluded.slug,
      icon = excluded.icon,
      color = excluded.color,
      sort_order = excluded.sort_order,
      is_deleted = 0,
      updated_at = excluded.updated_at,
      deleted_at = NULL`,
  ).bind(
    notebook.id,
    workspaceId,
    notebook.parentId,
    notebook.name,
    notebook.slug,
    notebook.icon,
    notebook.color,
    notebook.sortOrder,
    notebook.createdAt,
    notebook.updatedAt,
  )));
};

export const restoreJsonMemos = async (
  db: DatabaseAdapter,
  workspaceId: string,
  backups: JsonBackupMemo[],
) => {
  await assertIdsAvailableInWorkspace(db, "memos", workspaceId, backups.map((backup) => backup.memo.id));
  await assertNotebookIdsInWorkspace(db, workspaceId, backups.map((backup) => backup.memo.notebookId));

  for (const backup of backups) {
    const memo = backup.memo;
    const contentJson = parseBackupDoc(memo.contentJson);
    const contentMarkdown = memo.contentMarkdown || docToMarkdown(contentJson);
    const contentText = docToText(contentJson);
    const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
    const title = normalizeMemoTitle(memo.title);
    const tags = normalizeTags(memo.tags);

    if (backup.revisions.some((revision) => revision.memoId !== memo.id)) {
      throw new AppError("invalid_backup", "A backup revision belongs to a different memo.", 400);
    }

    await db.batch([
      db.prepare(
        `INSERT INTO memos (
          id, workspace_id, notebook_id, title, excerpt, tags_json, is_pinned, is_archived, is_deleted,
          source_memo_ids, merge_source_count, merged_into_memo_id,
          created_by, updated_by, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, 'restore', 'restore', ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          notebook_id = excluded.notebook_id,
          title = excluded.title,
          excerpt = excluded.excerpt,
          tags_json = excluded.tags_json,
          is_pinned = excluded.is_pinned,
          is_archived = excluded.is_archived,
          is_deleted = 0,
          source_memo_ids = excluded.source_memo_ids,
          merge_source_count = excluded.merge_source_count,
          merged_into_memo_id = NULL,
          updated_by = 'restore',
          updated_at = excluded.updated_at,
          deleted_at = NULL`,
      ).bind(
        memo.id,
        workspaceId,
        memo.notebookId,
        title,
        createExcerpt(contentText),
        JSON.stringify(tags),
        memo.isPinned ? 1 : 0,
        memo.isArchived ? 1 : 0,
        JSON.stringify(memo.sourceMemoIds),
        memo.mergeSourceCount,
        memo.createdAt,
        memo.updatedAt,
      ),
      db.prepare(
        `INSERT INTO memo_contents (
          memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memo_id) DO UPDATE SET
          content_json = excluded.content_json,
          content_markdown = excluded.content_markdown,
          content_text = excluded.content_text,
          content_hash = excluded.content_hash,
          revision = excluded.revision,
          updated_at = excluded.updated_at`,
      ).bind(
        memo.id,
        JSON.stringify(contentJson),
        contentMarkdown,
        contentText,
        contentHash,
        memo.revision,
        memo.createdAt,
        memo.updatedAt,
      ),
      upsertMemoSearchDocumentStatement(db, memo.id, title, contentText, tags.join(" ")),
      db.prepare("DELETE FROM memo_revisions WHERE memo_id = ?").bind(memo.id),
    ]);

    for (let index = 0; index < backup.revisions.length; index += 50) {
      const statements = backup.revisions.slice(index, index + 50).map((revision) => {
        const revisionJson = parseBackupDoc(revision.contentJson);
        const revisionMarkdown = revision.contentMarkdown || docToMarkdown(revisionJson);
        const revisionText = docToText(revisionJson);
        return db.prepare(
          `INSERT INTO memo_revisions (
            id, memo_id, revision, title, content_json, content_markdown,
            content_hash, created_by, created_at, tags_json, content_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            memo_id = excluded.memo_id,
            revision = excluded.revision,
            title = excluded.title,
            content_json = excluded.content_json,
            content_markdown = excluded.content_markdown,
            content_hash = excluded.content_hash,
            created_by = excluded.created_by,
            created_at = excluded.created_at,
            tags_json = excluded.tags_json,
            content_text = excluded.content_text`,
        ).bind(
          revision.id,
          memo.id,
          revision.revision,
          normalizeMemoTitle(revision.title),
          JSON.stringify(revisionJson),
          revisionMarkdown,
          revision.contentHash || "",
          revision.createdBy,
          revision.createdAt,
          JSON.stringify(normalizeTags(revision.tags)),
          revisionText,
        );
      });
      await db.batch(statements);
    }
  }

  await audit(db, "user", null, "backup.restore", "backup", createId("restore"), {
    memoCount: backups.length,
  });
};
