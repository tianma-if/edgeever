import type { MemoDetail } from "@edgeever/shared";
import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { mapNotebook, type NotebookRow } from "./notebook-service";
import { getWorkspaceId, requireScopes } from "./request-auth";

type MobileSyncChangeRow = {
  id: number;
  entity_type: "notebook" | "memo";
  entity_id: string;
  operation: "upsert" | "delete";
};

export type SyncMemoDetailRow = {
  id: string;
  notebook_id: string;
  title: string | null;
  excerpt: string;
  tags_json: string;
  is_pinned: number;
  is_archived: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  content_json: string;
  content_markdown: string;
  content_text: string;
  source_memo_ids: string;
  merge_source_count: number;
  merged_into_memo_id: string | null;
  content_hash: string;
};

type SyncRouteDependencies = {
  clampNumber: (value: number, min: number, max: number) => number;
  mapMemoDetail: (row: SyncMemoDetailRow) => MemoDetail;
};

export const registerSyncRoutes = (
  app: Hono<AppEnv>,
  dependencies: SyncRouteDependencies,
) => {
  app.get("/api/v1/sync/bootstrap", async (context) => {
    const denied = requireScopes(context, "read:notebooks", "read:memos");
    if (denied) return denied;

    const workspaceId = getWorkspaceId(context);
    const limit = dependencies.clampNumber(Number(context.req.query("limit") ?? 100), 1, 200);
    const afterId = context.req.query("afterId")?.trim() ?? "";
    const [notebookRows, memoRows, totalRow, cursorRow] = await Promise.all([
      context.env.storage.db.prepare(
        `SELECT n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order,
                n.created_at, n.updated_at, COUNT(m.id) AS memo_count, MAX(m.updated_at) AS last_memo_updated_at
         FROM notebooks n
         LEFT JOIN memos m ON m.notebook_id = n.id AND m.workspace_id = n.workspace_id AND m.is_deleted = 0
         WHERE n.workspace_id = ? AND n.is_deleted = 0
         GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at
         ORDER BY n.sort_order ASC, n.name ASC`,
      ).bind(workspaceId).all<NotebookRow>(),
      context.env.storage.db.prepare(
        `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
                mc.content_json, mc.content_markdown, mc.content_text, mc.content_hash,
                m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
         FROM memos m
         INNER JOIN memo_contents mc ON mc.memo_id = m.id
         WHERE m.workspace_id = ? AND m.id > ?
         ORDER BY m.id ASC
         LIMIT ?`,
      ).bind(workspaceId, afterId, limit + 1).all<SyncMemoDetailRow>(),
      context.env.storage.db.prepare(
        `SELECT COUNT(*) AS count FROM memos WHERE workspace_id = ?`,
      ).bind(workspaceId).first<{ count: number }>(),
      context.env.storage.db.prepare(
        `SELECT w.created_at AS sync_identity,
                COALESCE((
                  SELECT MAX(c.id)
                  FROM mobile_sync_changes c
                  WHERE c.workspace_id = w.id
                ), 0) AS cursor
         FROM workspaces w
         WHERE w.id = ?`,
      ).bind(workspaceId).first<{ cursor: number; sync_identity: string }>(),
    ]);
    const page = memoRows.results.slice(0, limit);
    return context.json({
      notebooks: notebookRows.results.map(mapNotebook),
      memos: page.map(dependencies.mapMemoDetail),
      snapshotCursor: cursorRow?.cursor ?? 0,
      syncIdentity: cursorRow?.sync_identity,
      totalCount: totalRow?.count ?? page.length,
      nextAfterId: memoRows.results.length > limit ? page.at(-1)?.id ?? null : null,
    });
  });

  app.get("/api/v1/sync/changes", async (context) => {
    const denied = requireScopes(context, "read:notebooks", "read:memos");
    if (denied) return denied;

    const workspaceId = getWorkspaceId(context);
    const cursor = dependencies.clampNumber(
      Number(context.req.query("cursor") ?? 0),
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const limit = dependencies.clampNumber(Number(context.req.query("limit") ?? 100), 1, 200);
    const [rows, cursorRow] = await Promise.all([
      context.env.storage.db.prepare(
        `SELECT id, entity_type, entity_id, operation
         FROM mobile_sync_changes
         WHERE workspace_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
      ).bind(workspaceId, cursor, limit + 1).all<MobileSyncChangeRow>(),
      context.env.storage.db.prepare(
        `SELECT w.created_at AS sync_identity,
                COALESCE((
                  SELECT MAX(c.id)
                  FROM mobile_sync_changes c
                  WHERE c.workspace_id = w.id
                ), 0) AS cursor
         FROM workspaces w
         WHERE w.id = ?`,
      ).bind(workspaceId).first<{ cursor: number; sync_identity: string }>(),
    ]);
    const page = rows.results.slice(0, limit);
    const latestPageChanges = new Map<string, MobileSyncChangeRow>();
    for (const change of page) {
      latestPageChanges.set(`${change.entity_type}:${change.entity_id}`, change);
    }
    const compactedPage = Array.from(latestPageChanges.values()).sort((left, right) => left.id - right.id);
    const memoIds = Array.from(new Set(compactedPage
      .filter((change) => change.entity_type === "memo" && change.operation === "upsert")
      .map((change) => change.entity_id)));
    const notebookIds = Array.from(new Set(compactedPage
      .filter((change) => change.entity_type === "notebook" && change.operation === "upsert")
      .map((change) => change.entity_id)));
    const memoPlaceholders = memoIds.map(() => "?").join(", ");
    const notebookPlaceholders = notebookIds.map(() => "?").join(", ");
    const [memoRows, notebookRows] = await Promise.all([
      memoIds.length > 0
        ? context.env.storage.db.prepare(
          `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                  m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
                  mc.content_json, mc.content_markdown, mc.content_text, mc.content_hash,
                  m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
           FROM memos m
           INNER JOIN memo_contents mc ON mc.memo_id = m.id
           WHERE m.workspace_id = ? AND m.id IN (${memoPlaceholders})`,
        ).bind(workspaceId, ...memoIds).all<SyncMemoDetailRow>()
        : Promise.resolve({ results: [] as SyncMemoDetailRow[] }),
      notebookIds.length > 0
        ? context.env.storage.db.prepare(
          `SELECT n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order,
                  n.created_at, n.updated_at, COUNT(m.id) AS memo_count, MAX(m.updated_at) AS last_memo_updated_at
           FROM notebooks n
           LEFT JOIN memos m ON m.notebook_id = n.id AND m.workspace_id = n.workspace_id AND m.is_deleted = 0
           WHERE n.workspace_id = ? AND n.is_deleted = 0 AND n.id IN (${notebookPlaceholders})
           GROUP BY n.id, n.parent_id, n.name, n.slug, n.icon, n.color, n.sort_order, n.created_at, n.updated_at`,
        ).bind(workspaceId, ...notebookIds).all<NotebookRow>()
        : Promise.resolve({ results: [] as NotebookRow[] }),
    ]);
    const memosById = new Map(memoRows.results.map((row) => [row.id, dependencies.mapMemoDetail(row)]));
    const notebooksById = new Map(notebookRows.results.map((row) => [row.id, mapNotebook(row)]));
    const changes = compactedPage.map((change) => {
      if (change.entity_type === "memo") {
        const memo = change.operation === "upsert" ? memosById.get(change.entity_id) ?? null : null;
        return {
          cursor: change.id,
          entityType: change.entity_type,
          entityId: change.entity_id,
          operation: memo ? "upsert" as const : "delete" as const,
          notebook: null,
          memo,
        };
      }
      const notebook = change.operation === "upsert"
        ? notebooksById.get(change.entity_id) ?? null
        : null;
      return {
        cursor: change.id,
        entityType: change.entity_type,
        entityId: change.entity_id,
        operation: notebook ? "upsert" as const : "delete" as const,
        notebook,
        memo: null,
      };
    });

    return context.json({
      changes,
      cursor: page.at(-1)?.id ?? cursor,
      hasMore: rows.results.length > limit,
      serverCursor: cursorRow?.cursor ?? 0,
      syncIdentity: cursorRow?.sync_identity,
    });
  });
};
