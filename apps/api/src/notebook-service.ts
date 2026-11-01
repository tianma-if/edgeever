import type { Notebook, NotebookCreateInput, NotebookUpdateInput } from "@edgeever/shared";
import type { AuditActor } from "./api-context";
import { AppError } from "./app-error";
import { auditStatement } from "./audit";
import { createId, isoNow, slugify } from "./entity-utils";
import type { DatabaseAdapter } from "./storage-contract";
import { isInboxNotebook, workspaceInboxId } from "./workspace-provisioning";

export { isInboxNotebook, workspaceInboxId } from "./workspace-provisioning";

/** SQL identity for the workspace inbox: stable id first, slug as a fallback. */
export const inboxNotebookIdentitySql = (alias: string) =>
  `(${alias}.id = ${alias}.workspace_id || '_inbox' OR ${alias}.id = 'nb_inbox' OR ${alias}.slug = 'inbox')`;

export type NotebookRow = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string | null;
  icon: string | null;
  color: string | null;
  text_color?: string | null;
  color_target?: Notebook["colorTarget"];
  is_bold?: number;
  icon_inverted?: number;
  row_inverted?: number;
  sort_order: number;
  memo_count: number | null;
  last_memo_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export const mapNotebook = (row: NotebookRow): Notebook => ({
  id: row.id,
  parentId: row.parent_id,
  name: row.name,
  slug: row.slug,
  icon: row.icon,
  color: row.color,
  textColor: row.text_color ?? null,
  colorTarget: row.color_target ?? "icon",
  isBold: row.is_bold === 1,
  iconInverted: row.icon_inverted === 1,
  rowInverted: row.row_inverted === 1,
  sortOrder: row.sort_order,
  memoCount: row.memo_count ?? 0,
  lastMemoUpdatedAt: row.last_memo_updated_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const notebookSelectSql = (tail: string) => `
  SELECT n.id,
         n.parent_id,
         n.name,
         n.slug,
         n.icon,
         n.color,
         n.text_color,
         n.color_target,
         n.is_bold,
         n.icon_inverted,
         n.row_inverted,
         n.sort_order,
         COUNT(m.id) AS memo_count,
         MAX(m.updated_at) AS last_memo_updated_at,
         n.created_at,
         n.updated_at
  FROM notebooks n
  LEFT JOIN memos m ON m.notebook_id = n.id AND m.is_deleted = 0
  ${tail}
`;

export const listNotebooks = async (db: DatabaseAdapter, workspaceId: string): Promise<Notebook[]> => {
  const rows = await db
    .prepare(
      notebookSelectSql(
        `WHERE n.workspace_id = ? AND n.is_deleted = 0
         GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.text_color, n.color_target, n.is_bold, n.icon_inverted, n.row_inverted, n.sort_order, n.created_at, n.updated_at
         ORDER BY n.parent_id IS NOT NULL, n.sort_order ASC, n.name ASC`
      )
    )
    .bind(workspaceId).all<NotebookRow>();

  return rows.results.map(mapNotebook);
};

const normalizeNotebookLookupName = (value: string) => value.trim().toLocaleLowerCase("en-US");

export const findNotebooks = async (
  db: DatabaseAdapter,
  workspaceId: string,
  options: { name: string; parentId?: string | null; exact: boolean; limit: number },
) => {
  const query = normalizeNotebookLookupName(options.name);
  const notebooks = await listNotebooks(db, workspaceId);
  return notebooks
    .filter((notebook) => {
      if (options.parentId !== undefined && notebook.parentId !== options.parentId) {
        return false;
      }
      const name = normalizeNotebookLookupName(notebook.name);
      return options.exact ? name === query : name.includes(query);
    })
    .slice(0, options.limit);
};

export const resolveNotebookPath = async (db: DatabaseAdapter, workspaceId: string, path: string) => {
  const segments = path.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new AppError("invalid_params", "path must contain at least one notebook name", 400);
  }

  const notebooks = await listNotebooks(db, workspaceId);
  const matched: Notebook[] = [];
  let parentId: string | null = null;

  for (const [index, segment] of segments.entries()) {
    const normalizedSegment = normalizeNotebookLookupName(segment);
    const candidates = notebooks.filter(
      (notebook) => notebook.parentId === parentId && normalizeNotebookLookupName(notebook.name) === normalizedSegment,
    );

    if (candidates.length !== 1) {
      return {
        resolved: false,
        path,
        segments,
        matched,
        failedAt: index,
        failedSegment: segment,
        reason: candidates.length === 0 ? "not_found" : "ambiguous",
        candidates,
      };
    }

    matched.push(candidates[0]);
    parentId = candidates[0].id;
  }

  return {
    resolved: true,
    path,
    segments,
    notebook: matched.at(-1),
    matched,
  };
};

export const getNotebook = async (db: DatabaseAdapter, workspaceId: string, id: string): Promise<Notebook | null> => {
  const row = await db
    .prepare(
      notebookSelectSql(
        `WHERE n.id = ? AND n.workspace_id = ? AND n.is_deleted = 0
         GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.text_color, n.color_target, n.is_bold, n.icon_inverted, n.row_inverted, n.sort_order, n.created_at, n.updated_at`
      )
    )
    .bind(id, workspaceId)
    .first<NotebookRow>();

  return row ? mapNotebook(row) : null;
};

/** Existence checks do not need the notebook's potentially large memo aggregate. */
export const notebookExists = async (db: DatabaseAdapter, workspaceId: string, id: string): Promise<boolean> =>
  Boolean(await db.prepare(
    "SELECT id FROM notebooks WHERE id = ? AND workspace_id = ? AND is_deleted = 0",
  ).bind(id, workspaceId).first<{ id: string }>());

export const createNotebookRecord = async (
  db: DatabaseAdapter,
  workspaceId: string,
  input: NotebookCreateInput & { sortOrder?: number },
  actor: AuditActor
) => {
  const parentId = input.parentId ?? null;

  if (parentId && !(await notebookExists(db, workspaceId, parentId))) {
    throw new AppError("not_found", "Parent notebook not found", 404);
  }

  const id = createId("nb");
  const now = isoNow();
  const sortOrder = input.sortOrder ?? Date.now();

  await db.batch([
    db
      .prepare(
        `INSERT INTO notebooks (id, workspace_id, parent_id, name, slug, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, workspaceId, parentId, input.name, slugify(input.name), sortOrder, now, now),
    auditStatement(db, actor.actorType, actor.actorId, "notebook.create", "notebook", id, {
      name: input.name,
      parentId,
      sortOrder,
    }),
  ]);

  const notebook = await getNotebook(db, workspaceId, id);

  if (!notebook) {
    throw new AppError("not_found", "Notebook not found after create", 404);
  }

  return notebook;
};

export const updateNotebookRecord = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  input: NotebookUpdateInput,
  actor: AuditActor
) => {
  const current = await getNotebook(db, workspaceId, id);

  if (!current) {
    throw new AppError("not_found", "Notebook not found", 404);
  }

  const nextName = input.name ?? current.name;
  const nextParentId = input.parentId === undefined ? current.parentId : input.parentId;
  const nextSortOrder = input.sortOrder ?? current.sortOrder;
  const nextSlug = isInboxNotebook(current, workspaceId) ? "inbox" : slugify(nextName);
  const now = isoNow();

  if (nextParentId === id) {
    throw new AppError("bad_request", "Notebook cannot be its own parent", 400);
  }

  if (nextParentId) {
    if (!(await notebookExists(db, workspaceId, nextParentId))) {
      throw new AppError("not_found", "Parent notebook not found", 404);
    }

    if (await isNotebookDescendant(db, workspaceId, nextParentId, id)) {
      throw new AppError("notebook_cycle", "Notebook cannot be moved into its own descendant.", 409);
    }
  }

  await db.batch([
    db
      .prepare(
        `UPDATE notebooks
         SET name = ?, slug = ?, parent_id = ?, sort_order = ?, icon = ?, color = ?, text_color = ?, color_target = ?, is_bold = ?, icon_inverted = ?, row_inverted = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
      )
      .bind(nextName, nextSlug, nextParentId ?? null, nextSortOrder,
        input.icon === undefined ? current.icon : input.icon,
        input.color === undefined ? current.color : input.color,
        input.textColor === undefined ? current.textColor : input.textColor,
        input.colorTarget ?? current.colorTarget ?? "icon", Number(input.isBold ?? current.isBold ?? false), Number(input.iconInverted ?? current.iconInverted ?? false), Number(input.rowInverted ?? current.rowInverted ?? false), now, id, workspaceId),
    auditStatement(db, actor.actorType, actor.actorId, "notebook.update", "notebook", id, input),
  ]);

  const notebook = await getNotebook(db, workspaceId, id);

  if (!notebook) {
    throw new AppError("not_found", "Notebook not found after update", 404);
  }

  return notebook;
};

const NOTEBOOK_DELETE_ID_CHUNK = 80;

const chunkValues = <T>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

// Active notebooks in this subtree. The anchor may already be deleted so a
// retried parent delete can still remove descendants that were left behind.
const listActiveNotebookTree = async (db: DatabaseAdapter, workspaceId: string, id: string) => {
  const rows = await db.prepare(
    `WITH RECURSIVE tree(id) AS (
       SELECT id FROM notebooks WHERE workspace_id = ? AND id = ?
       UNION ALL
       SELECT n.id
       FROM notebooks n
       INNER JOIN tree t ON n.parent_id = t.id
       WHERE n.workspace_id = ?
     )
     SELECT n.id, n.slug, n.parent_id
     FROM notebooks n
     INNER JOIN tree t ON t.id = n.id
     WHERE n.workspace_id = ? AND n.is_deleted = 0`
  ).bind(workspaceId, id, workspaceId, workspaceId).all<{ id: string; slug: string | null; parent_id: string | null }>();

  return rows.results;
};

const hasActiveMemosInNotebooks = async (db: DatabaseAdapter, workspaceId: string, notebookIds: string[]) => {
  for (const chunk of chunkValues(notebookIds, NOTEBOOK_DELETE_ID_CHUNK)) {
    const placeholders = chunk.map(() => "?").join(", ");
    const row = await db.prepare(
      `SELECT 1 AS found FROM memos WHERE workspace_id = ? AND is_deleted = 0 AND notebook_id IN (${placeholders}) LIMIT 1`
    ).bind(workspaceId, ...chunk).first<{ found: number }>();
    if (row) return true;
  }
  return false;
};

export const deleteNotebookTree = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  actor: AuditActor,
  options: { dryRun?: boolean; guardConcurrentChanges?: boolean } = {},
) => {
  const result = (notebookIds: string[]) => ({
    notebookId: id, notebookIds, notebookCount: notebookIds.length,
    dryRun: options.dryRun === true, deleted: options.dryRun !== true,
  });
  const current = await db.prepare(
    `SELECT id, slug, is_deleted FROM notebooks WHERE id = ? AND workspace_id = ?`
  ).bind(id, workspaceId).first<{ id: string; slug: string | null; is_deleted: number }>();
  if (!current) throw new AppError("not_found", "Notebook not found", 404);
  if (isInboxNotebook(current, workspaceId)) {
    if (current.is_deleted) return result([]);
    throw new AppError("bad_request", "等待分类不能删除。", 400);
  }

  const tree = await listActiveNotebookTree(db, workspaceId, id);
  if (tree.length === 0) return result([]);
  if (tree.some((notebook) => isInboxNotebook(notebook, workspaceId))) {
    throw new AppError("bad_request", "等待分类不能删除。", 400);
  }

  const notebookIds = tree.map((notebook) => notebook.id);
  // Empty child notebooks are removed with the parent. Notes anywhere in the
  // subtree block the whole delete so a parent click cannot orphan them.
  if (await hasActiveMemosInNotebooks(db, workspaceId, notebookIds)) {
    throw new AppError(
      "notebook_not_empty",
      "Move or delete notes in this notebook and its child notebooks before deleting it.",
      409
    );
  }

  if (options.dryRun) return result(notebookIds);

  const now = isoNow();
  const inboxId = workspaceInboxId(workspaceId);
  if (options.guardConcurrentChanges) {
    // One guarded UPDATE prevents a note inserted after the emptiness check
    // from being hidden. Require the same active subtree, including parent
    // links, so concurrent moves/creates/deletes require a fresh attempt.
    const serializedSnapshot = JSON.stringify(tree.map(({ id, parent_id }) => ({ id, parent_id })));
    const update = db.prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM notebooks WHERE workspace_id = ? AND id = ?
        UNION
        SELECT n.id FROM notebooks n JOIN tree t ON n.parent_id = t.id WHERE n.workspace_id = ?
      ), active_tree AS MATERIALIZED (
        SELECT n.* FROM notebooks n JOIN tree t ON n.id = t.id
        WHERE n.workspace_id = ? AND n.is_deleted = 0
      ), expected AS (
        SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.parent_id') AS parent_id
        FROM json_each(?)
      )
      UPDATE notebooks SET is_deleted = 1, deleted_at = ?, updated_at = ?
      WHERE workspace_id = ? AND is_deleted = 0 AND id IN (SELECT id FROM active_tree)
        AND (SELECT COUNT(*) FROM active_tree) = ?
        AND NOT EXISTS (
          SELECT 1 FROM active_tree n LEFT JOIN expected e ON e.id = n.id
          WHERE e.id IS NULL OR n.parent_id IS NOT e.parent_id
        )
        AND NOT EXISTS (SELECT 1 FROM active_tree WHERE slug = 'inbox' OR id = 'nb_inbox' OR id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM memos WHERE workspace_id = ? AND is_deleted = 0
          AND notebook_id IN (SELECT id FROM active_tree)
        )
    `).bind(workspaceId, id, workspaceId, workspaceId, serializedSnapshot,
      now, now, workspaceId, notebookIds.length, inboxId, workspaceId);
    const auditDelete = db.prepare(`
      INSERT INTO audit_events (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
      SELECT ?, ?, ?, 'notebook.delete', 'notebook', ?, ?, ? WHERE changes() = ?
    `).bind(createId("audit"), actor.actorType, actor.actorId, id, JSON.stringify({ notebookIds }), now, notebookIds.length);
    const [, audited] = await db.batch([update, auditDelete]);
    // Adapter UPDATE metadata may include sync-trigger writes. The conditional
    // audit uses SQLite changes(), which counts only the notebook rows.
    if (!(Number(audited?.meta.changes) > 0)) {
      throw new AppError("notebook_changed", "Notebook contents or hierarchy changed. Preview again before retrying deletion.", 409);
    }
    return result(notebookIds);
  }
  const statements = chunkValues(notebookIds, NOTEBOOK_DELETE_ID_CHUNK).map((chunk) => {
    const placeholders = chunk.map(() => "?").join(", ");
    return db.prepare(
      `UPDATE notebooks
       SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE workspace_id = ? AND is_deleted = 0 AND id IN (${placeholders})
         AND (slug IS NULL OR slug <> 'inbox') AND id <> 'nb_inbox' AND id <> ?`
    ).bind(now, now, workspaceId, ...chunk, inboxId);
  });
  statements.push(auditStatement(db, actor.actorType, actor.actorId, "notebook.delete", "notebook", id, {
    notebookIds,
  }));
  await db.batch(statements);
  return result(notebookIds);
};

// Preserve the existing REST deletion contract and mechanism.
export const deleteNotebookRecord = async (
  db: DatabaseAdapter, workspaceId: string, id: string, actor: AuditActor,
) => {
  await deleteNotebookTree(db, workspaceId, id, actor);
};

export const restoreNotebookRecord = async (
  db: DatabaseAdapter,
  workspaceId: string,
  id: string,
  actor: AuditActor
) => {
  const current = await db.prepare(
    `SELECT id FROM notebooks WHERE id = ? AND workspace_id = ? AND is_deleted = 1`
  ).bind(id, workspaceId).first<{ id: string }>();
  if (!current) throw new AppError("not_found", "Deleted notebook not found", 404);

  const now = isoNow();
  await db.batch([
    db.prepare(
      `UPDATE notebooks SET is_deleted = 0, deleted_at = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?`
    ).bind(now, id, workspaceId),
    auditStatement(db, actor.actorType, actor.actorId, "notebook.restore", "notebook", id, {}),
  ]);

  const notebook = await getNotebook(db, workspaceId, id);
  if (!notebook) throw new AppError("not_found", "Notebook not found after restore", 404);
  return notebook;
};

export const isNotebookDescendant = async (
  db: DatabaseAdapter,
  workspaceId: string,
  candidateId: string,
  ancestorId: string
) => {
  const row = await db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id
         FROM notebooks
         WHERE workspace_id = ? AND parent_id = ? AND is_deleted = 0

         UNION ALL

         SELECT n.id
         FROM notebooks n
         INNER JOIN descendants d ON n.parent_id = d.id
         WHERE n.workspace_id = ? AND n.is_deleted = 0
       )
       SELECT id
       FROM descendants
       WHERE id = ?
       LIMIT 1`
    )
    .bind(workspaceId, ancestorId, workspaceId, candidateId)
    .first<{ id: string }>();

  return Boolean(row);
};
