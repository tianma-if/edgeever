import { readNotebookSiteSettings, type NotebookSiteSettings } from "@edgeever/shared";
import type { DatabaseAdapter } from "./storage-contract";

// Every consumer starts at the live share. Deleted ancestors and inconsistent
// workspace references stop recursion; exclusions are scoped to that share.
export const publicTreeSql = `WITH RECURSIVE tree(id, workspace_id, share_id) AS (
  SELECT n.id, n.workspace_id, ns.id FROM notebook_shares ns
  JOIN notebooks n ON n.id = ns.notebook_id AND n.workspace_id = ns.workspace_id
  WHERE ns.token = ? AND n.is_deleted = 0
  UNION
  SELECT n.id, n.workspace_id, t.share_id FROM notebooks n JOIN tree t ON n.parent_id = t.id
  WHERE n.workspace_id = t.workspace_id AND n.is_deleted = 0
), visible_memos AS (
  SELECT m.* FROM memos m JOIN tree t ON m.notebook_id = t.id AND m.workspace_id = t.workspace_id
  WHERE m.is_deleted = 0 AND NOT EXISTS (
    SELECT 1 FROM notebook_share_excluded_memos e WHERE e.share_id = t.share_id AND e.memo_id = m.id
  )
)`;

export const getNotebookSite = async (db: DatabaseAdapter, token: string) => {
  const row = await db.prepare(`SELECT ns.id, ns.token, ns.site_slug, ns.site_settings_json, ns.password_hash,
    n.id AS notebook_id, n.name FROM notebook_shares ns
    JOIN notebooks n ON n.id = ns.notebook_id AND n.workspace_id = ns.workspace_id
    WHERE ns.token = ? AND n.is_deleted = 0`).bind(token).first<{
      id: string; token: string; site_slug: string | null; site_settings_json: string;
      password_hash: string | null; notebook_id: string; name: string;
    }>();
  if (!row) return null;
  const settings: NotebookSiteSettings = readNotebookSiteSettings(row.site_settings_json);
  settings.allowIndexing = settings.allowIndexing && !row.password_hash;
  if (settings.homeMemoId && !await db.prepare(`${publicTreeSql} SELECT id FROM visible_memos WHERE id = ?`)
    .bind(token, settings.homeMemoId).first()) settings.homeMemoId = null;
  return { ...row, settings };
};

export const resolveNotebookSiteToken = async (db: DatabaseAdapter, slug: string) =>
  db.prepare(`SELECT ns.token FROM notebook_shares ns JOIN notebooks n
    ON n.id = ns.notebook_id AND n.workspace_id = ns.workspace_id
    WHERE lower(ns.site_slug) = lower(?) AND n.is_deleted = 0`).bind(slug).first<{ token: string }>();
