import {
  createExcerpt,
  DEFAULT_MEMO_TITLE,
  docToMarkdown,
  docToText,
  emptyDoc,
  normalizeTags,
  parseTableDocument,
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
import { SharedTableStore } from "./shared-table-store";
import { compactSharedMemo, readActiveTableStorage } from "./table-memo-storage";

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
  const collision = await db.prepare(
    `SELECT id FROM ${table} WHERE workspace_id <> ? AND id IN (SELECT value FROM json_each(?)) LIMIT 1`,
  ).bind(workspaceId, JSON.stringify(ids)).first<{ id: string }>();
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
  const rows = await db.prepare(
    `SELECT id FROM notebooks WHERE workspace_id = ? AND id IN (SELECT value FROM json_each(?))`,
  ).bind(workspaceId, JSON.stringify(uniqueIds)).all<{ id: string }>();
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
      id, workspace_id, parent_id, name, slug, icon, color, text_color, color_target, is_bold, icon_inverted, row_inverted, sort_order, is_deleted, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      parent_id = excluded.parent_id,
      name = excluded.name,
      slug = excluded.slug,
      icon = excluded.icon,
      color = excluded.color,
      text_color = excluded.text_color,
      color_target = excluded.color_target,
      is_bold = excluded.is_bold,
      icon_inverted = excluded.icon_inverted,
      row_inverted = excluded.row_inverted,
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
    notebook.textColor ?? null,
    notebook.colorTarget ?? "icon",
    Number(notebook.isBold ?? false),
    Number(notebook.iconInverted ?? false),
    Number(notebook.rowInverted ?? false),
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
  // Validate the whole page before writing, so an invalid note never leaves
  // the notes before it restored.
  if (backups.some((backup) => backup.revisions.some((revision) => revision.memoId !== backup.memo.id))) {
    throw new AppError("invalid_backup", "A backup revision belongs to a different memo.", 400);
  }

  const revisionOwners = new Map<string, string>();
  const revisionConflict = () => new AppError("backup_revision_id_conflict", "A backup revision ID is already used by another memo.", 409);
  for (const backup of backups) {
    for (const revision of backup.revisions) {
      const owner = revisionOwners.get(revision.id);
      if (owner && owner !== backup.memo.id) throw revisionConflict();
      revisionOwners.set(revision.id, backup.memo.id);
    }
  }
  const revisionIds = [...revisionOwners.keys()];
  for (let index = 0; index < revisionIds.length; index += 50) {
    const ids = revisionIds.slice(index, index + 50);
    const existing = await db.prepare(
      `SELECT id, memo_id FROM memo_revisions WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ).bind(...ids).all<{ id: string; memo_id: string }>();
    if (existing.results.some((row) => revisionOwners.get(row.id) !== row.memo_id)) throw revisionConflict();
  }

  for (const backup of backups) {
    const memo = backup.memo;
    const contentJson = parseBackupDoc(memo.contentJson);
    const contentMarkdown = memo.contentMarkdown || docToMarkdown(contentJson);
    const contentText = docToText(contentJson);
    const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
    const title = normalizeMemoTitle(memo.title);
    const tags = normalizeTags(memo.tags);
    const table = parseTableDocument(contentMarkdown);
    const historical = backup.revisions.map((revision) => {
      const doc = parseBackupDoc(revision.contentJson);
      const markdown = revision.contentMarkdown || docToMarkdown(doc);
      return { revision, doc, markdown, table: parseTableDocument(markdown) };
    });
    const snapshots = historical.flatMap((entry) => entry.table ? [entry.table] : []);
    if (table) snapshots.push(table);
    const active = snapshots.length ? await readActiveTableStorage(db, workspaceId, memo.id) : null;
    const shared = active ? await new SharedTableStore(db).planMemoSnapshotRestore(workspaceId, memo.id, active.run_id, snapshots) : null;
    const stored = shared && table ? compactSharedMemo(table) : {
      content_json: JSON.stringify(contentJson), content_markdown: contentMarkdown, content_text: contentText,
    };
    const reference = shared && table ? shared.revisions.at(-1)! : null;
    let tableRevisionIndex = 0;
    const revisionStatements = historical.map(({ revision, doc, markdown, table: historicalTable }) => {
      const stored = shared && historicalTable ? compactSharedMemo(historicalTable) : {
        content_json: JSON.stringify(doc), content_markdown: markdown, content_text: docToText(doc),
      };
      const reference = shared && historicalTable ? shared.revisions[tableRevisionIndex++] : null;
      return db.prepare(`INSERT INTO memo_revisions (
        id, memo_id, revision, title, content_json, content_markdown, content_hash,
        created_by, created_at, tags_json, content_text, shared_table_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(revision.id, memo.id, revision.revision, normalizeMemoTitle(revision.title),
          stored.content_json, stored.content_markdown, revision.contentHash || "",
          revision.createdBy, revision.createdAt, JSON.stringify(normalizeTags(revision.tags)), stored.content_text, reference);
    });

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
          memo_id, content_json, content_markdown, content_text, content_hash, revision, shared_table_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memo_id) DO UPDATE SET
          content_json = excluded.content_json,
          content_markdown = excluded.content_markdown,
          content_text = excluded.content_text,
          content_hash = excluded.content_hash,
          revision = excluded.revision,
          shared_table_revision = excluded.shared_table_revision,
          updated_at = excluded.updated_at`,
      ).bind(
        memo.id,
        stored.content_json,
        stored.content_markdown,
        stored.content_text,
        contentHash,
        memo.revision,
        reference,
        memo.createdAt,
        memo.updatedAt,
      ),
      upsertMemoSearchDocumentStatement(db, memo.id, title, stored.content_text, tags.join(" ")),
      db.prepare("DELETE FROM memo_revisions WHERE memo_id = ?").bind(memo.id),
      ...(shared ? [...shared.statements, ...revisionStatements] : []),
    ]);

    if (!shared) {
      for (let index = 0; index < revisionStatements.length; index += 50) {
        await db.batch(revisionStatements.slice(index, index + 50));
      }
    }
  }

  await audit(db, "user", null, "backup.restore", "backup", createId("restore"), {
    memoCount: backups.length,
  });
};
