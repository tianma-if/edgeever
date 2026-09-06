import { mapResourceStorageSummary, type ResourceStatsRow } from "./resource-service";
import type { DatabaseAdapter } from "./storage-contract";

export const getWorkspaceStats = async (
  database: DatabaseAdapter,
  workspaceId: string,
) => {
  const [memoCounts, notebookCount, tagCount, resourceStats] = await Promise.all([
    database.prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN is_deleted = 0 THEN 1 ELSE 0 END), 0) AS active,
         COALESCE(SUM(CASE WHEN is_deleted = 1 THEN 1 ELSE 0 END), 0) AS trashed,
         COALESCE(SUM(CASE WHEN is_deleted = 0 AND is_pinned = 1 THEN 1 ELSE 0 END), 0) AS pinned,
         COALESCE(SUM(CASE WHEN is_deleted = 0 AND tags_json = '[]' THEN 1 ELSE 0 END), 0) AS untagged
       FROM memos WHERE workspace_id = ?`,
    ).bind(workspaceId).first<{ total: number; active: number; trashed: number; pinned: number; untagged: number }>(),
    database.prepare(
      `SELECT COUNT(*) AS count FROM notebooks WHERE workspace_id = ? AND is_deleted = 0`,
    ).bind(workspaceId).first<{ count: number }>(),
    database.prepare(
      `SELECT COUNT(DISTINCT mt.name) AS count
       FROM memo_tags mt
       INNER JOIN memos m ON m.id = mt.memo_id AND m.workspace_id = mt.workspace_id
       WHERE mt.workspace_id = ? AND m.is_deleted = 0`,
    ).bind(workspaceId).first<{ count: number }>(),
    database.prepare(
      `SELECT COUNT(*) AS total_count,
              COALESCE(SUM(byte_size), 0) AS total_bytes,
              COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
              COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE m.workspace_id = ? AND r.is_deleted = 0`,
    ).bind(workspaceId).first<ResourceStatsRow>(),
  ]);

  return {
    memos: {
      total: memoCounts?.total ?? 0,
      active: memoCounts?.active ?? 0,
      trashed: memoCounts?.trashed ?? 0,
      pinned: memoCounts?.pinned ?? 0,
      untagged: memoCounts?.untagged ?? 0,
    },
    notebooks: { active: notebookCount?.count ?? 0 },
    tags: { active: tagCount?.count ?? 0 },
    resources: mapResourceStorageSummary(resourceStats),
  };
};
