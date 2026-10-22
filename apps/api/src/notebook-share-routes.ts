import {
  NotebookShareUpdateSchema,
  NotebookSiteUpdateSchema,
  NotebookSiteExclusionSchema,
  readNotebookSiteSettings,
  compareNotebookSiteTitles,
  type NotebookSiteMemoPreview,
  type NotebookSiteSearchResult,
  type NotebookSiteContents,
  type MemoNotebookSite,
  PublicShareUnlockSchema,
  collectMemoLinkIds,
  accountNoteProseFromRow,
  publicNoteProseFromAccount,
  sanitizeNoteProseCss,
  parsePublishedNoteBodyFont,
  resolveMemoContentDoc,
  type NotebookShare,
  type PublicNotebookShare,
  type PublicMemoShare,
  type NoteProseAccountRow,
  type TiptapDoc,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { hashPassword, verifyPassword, randomToken } from "./auth-crypto";
import { audit } from "./audit";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { apiError, notFound } from "./http-errors";
import { getAuditActor, getWorkspaceId, requireUser } from "./request-auth";
import { serveSharedResource } from "./share-routes";
import { allowPasswordProtectedShare, setShareAccessCookie } from "./share-http-access";
import { isShareUnlockBlocked, nextShareUnlockFailure, type ShareUnlockState } from "./share-access";
import { encryptSharePassword, readSharePassword } from "./share-password-encryption";
import { generateSharePassword } from "./share-password";
import { publicTreeSql, getNotebookSite, resolveNotebookSiteToken } from "./notebook-site-service";
import { toFtsQuery, escapeLike } from "./memo-list-service";

type ShareRow = {
  id: string;
  site_slug: string | null;
  site_settings_json: string;
  password_hash: string | null;
  password_encrypted: string | null;
  notebook_id: string;
  notebook_name: string;
  token: string;
  created_at: string;
  updated_at: string;
};
const mapShare = (row: ShareRow, password?: string): NotebookShare => ({
  siteSlug: row.site_slug,
  siteSettings: readNotebookSiteSettings(row.site_settings_json),
  passwordProtected: Boolean(row.password_hash),
  ...(password ? { password } : {}),
  notebookId: row.notebook_id,
  notebookName: row.notebook_name,
  token: row.token,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const selectShareSql = `SELECT ns.id, ns.site_slug, ns.site_settings_json, ns.notebook_id, n.name AS notebook_name, ns.password_encrypted, ns.password_hash, ns.token, ns.created_at, ns.updated_at
  FROM notebook_shares ns JOIN notebooks n ON n.id = ns.notebook_id AND n.workspace_id = ns.workspace_id
  WHERE ns.workspace_id = ? AND n.is_deleted = 0`;
const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
const pageSize = (value?: string) => Math.max(1, Math.min(100, Math.floor(Number(value) || 50)));

export const registerNotebookShareRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/memos/:id/notebook-sites", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const db = c.env.storage.db;
    const memoId = c.req.param("id");
    const workspaceId = getWorkspaceId(c);
    const memo = await db.prepare("SELECT notebook_id FROM memos WHERE id = ? AND workspace_id = ? AND is_deleted = 0")
      .bind(memoId, workspaceId).first<{ notebook_id: string | null }>();
    if (!memo) return notFound(c, "Memo not found");
    const rows = await db.prepare(`WITH RECURSIVE ancestors(id, parent_id, workspace_id, name) AS (
      SELECT id, parent_id, workspace_id, name FROM notebooks WHERE id = ? AND workspace_id = ? AND is_deleted = 0
      UNION
      SELECT n.id, n.parent_id, n.workspace_id, n.name FROM notebooks n JOIN ancestors a
        ON n.id = a.parent_id AND n.workspace_id = a.workspace_id WHERE n.is_deleted = 0
    )
    SELECT n.id AS notebookId, n.name AS notebookName,
      EXISTS (SELECT 1 FROM notebook_share_excluded_memos e WHERE e.share_id = ns.id AND e.memo_id = ?) AS excluded
    FROM ancestors n JOIN notebook_shares ns ON ns.notebook_id = n.id AND ns.workspace_id = n.workspace_id
    ORDER BY n.id`).bind(memo.notebook_id, workspaceId, memoId)
      .all<Omit<MemoNotebookSite, "excluded"> & { excluded: number }>();
    c.header("Cache-Control", "private, no-store");
    return c.json({ sites: rows.results.map((site) => ({ ...site, excluded: Boolean(site.excluded) })) });
  });
  app.get("/api/v1/notebooks/:id/share/memos", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const db = c.env.storage.db;
    const share = await db.prepare(`${selectShareSql} AND ns.notebook_id = ?`)
      .bind(getWorkspaceId(c), c.req.param("id")).first<ShareRow>();
    if (!share) return notFound(c, "Active share not found");
    const visibility = c.req.query("visibility") ?? "all";
    if (!["all", "public", "excluded"].includes(visibility))
      return apiError(c, "invalid_site_visibility", "Unknown content visibility filter", 400);
    const limit = pageSize(c.req.query("limit"));
    const query = c.req.query("q")?.trim() ?? "";
    const excludedSql = "EXISTS (SELECT 1 FROM notebook_share_excluded_memos e WHERE e.share_id = t.share_id AND e.memo_id = m.id)";
    const conditions = ["m.is_deleted = 0", "m.id > ?"];
    const binds: unknown[] = [share.token, c.req.query("cursor") ?? ""];
    if (visibility !== "all") conditions.push(`${visibility === "public" ? "NOT " : ""}${excludedSql}`);
    if (query) {
      const fts = toFtsQuery(query);
      const like = `%${escapeLike(query)}%`;
      conditions.push(`(m.title LIKE ? ESCAPE '\\' OR mc.content_text LIKE ? ESCAPE '\\' OR mc.content_markdown LIKE ? ESCAPE '\\'${fts ? " OR m.id IN (SELECT memo_id FROM memos_fts WHERE memos_fts MATCH ?)" : ""})`);
      binds.push(like, like, like, ...(fts ? [fts] : []));
    }
    const rows = await db.prepare(`${publicTreeSql}
      SELECT m.id, m.title, m.notebook_id AS notebookId, n.name AS notebookName, ${excludedSql} AS excluded
      FROM memos m JOIN tree t ON m.notebook_id = t.id AND m.workspace_id = t.workspace_id
      JOIN notebooks n ON n.id = m.notebook_id
      ${query ? "LEFT JOIN memo_contents mc ON mc.memo_id = m.id" : ""}
      WHERE ${conditions.join(" AND ")} ORDER BY m.id LIMIT ?`)
      .bind(...binds, limit + 1).all<Omit<NotebookSiteContents["memos"][number], "excluded"> & { excluded: number }>();
    const memos = rows.results.slice(0, limit).map((memo) => ({ ...memo, excluded: Boolean(memo.excluded) }));
    c.header("Cache-Control", "private, no-store");
    return c.json({ memos, nextCursor: rows.results.length > limit ? memos.at(-1)!.id : null } satisfies NotebookSiteContents);
  });
  app.patch("/api/v1/notebooks/:id/share/site", zValidator("json", NotebookSiteUpdateSchema), async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const db = c.env.storage.db;
    const existing = await db.prepare(`${selectShareSql} AND ns.notebook_id = ?`)
      .bind(getWorkspaceId(c), c.req.param("id")).first<ShareRow>();
    if (!existing) return notFound(c, "Active share not found");
    const input = c.req.valid("json");
    const settings = { ...readNotebookSiteSettings(existing.site_settings_json), ...input.settings };
    if (new TextEncoder().encode(JSON.stringify(settings)).length > 16 * 1024)
      return apiError(c, "invalid_site_settings", "Site settings exceed 16 KiB", 400);
    if (input.settings?.allowIndexing && existing.password_hash)
      return apiError(c, "invalid_site_settings", "Password-protected sites cannot enable indexing", 400);
    if (input.settings?.homeMemoId && !await db.prepare(`${publicTreeSql} SELECT id FROM visible_memos WHERE id = ?`)
      .bind(existing.token, input.settings.homeMemoId).first())
      return apiError(c, "invalid_site_homepage", "Homepage must be a visible note in this site", 400);
    const patch = JSON.stringify(input.settings ?? {});
    try {
      const updated = await db.prepare(`UPDATE notebook_shares SET
        site_slug = CASE WHEN ? THEN ? ELSE site_slug END,
        site_settings_json = json_patch(site_settings_json, ?), updated_at = ?
        WHERE id = ? AND workspace_id = ?
        AND length(CAST(json_patch(site_settings_json, ?) AS BLOB)) <= 16384
        AND (? = 0 OR password_hash IS NULL) RETURNING id`)
        .bind(input.siteSlug !== undefined ? 1 : 0, input.siteSlug || null, patch, isoNow(), existing.id,
          getWorkspaceId(c), patch, input.settings?.allowIndexing ? 1 : 0).first();
      if (!updated) return apiError(c, "invalid_site_settings", "Settings could not be saved; refresh and try again", 400);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed"))
        return apiError(c, "site_slug_conflict", "This site alias is already in use", 409);
      throw error;
    }
    const row = await db.prepare(`${selectShareSql} AND ns.notebook_id = ?`)
      .bind(getWorkspaceId(c), c.req.param("id")).first<ShareRow>();
    c.header("Cache-Control", "private, no-store");
    return c.json({ share: row ? mapShare(row, row.password_hash ? await readSharePassword(row.password_encrypted, row.token, c.env, row.password_hash) : undefined) : null });
  });
  app.get("/api/v1/notebooks/:id/share/excluded-memos", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const limit = pageSize(c.req.query("limit"));
    const rows = await c.env.storage.db.prepare(`SELECT m.id, m.title FROM notebook_share_excluded_memos e
      JOIN notebook_shares ns ON ns.id = e.share_id
      JOIN notebooks n ON n.id = ns.notebook_id AND n.workspace_id = ns.workspace_id
      JOIN memos m ON m.id = e.memo_id AND m.workspace_id = ns.workspace_id
      WHERE ns.workspace_id = ? AND ns.notebook_id = ? AND n.is_deleted = 0 AND m.is_deleted = 0
      AND m.id > ? ORDER BY m.id LIMIT ?`)
      .bind(getWorkspaceId(c), c.req.param("id"), c.req.query("cursor") ?? "", limit + 1)
      .all<{ id: string; title: string | null }>();
    const memos = rows.results.slice(0, limit);
    c.header("Cache-Control", "private, no-store");
    return c.json({ memos, nextCursor: rows.results.length > limit ? memos.at(-1)!.id : null });
  });
  app.patch("/api/v1/notebooks/:id/share/memos/:memoId", zValidator("json", NotebookSiteExclusionSchema), async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const db = c.env.storage.db;
    const share = await db.prepare(`${selectShareSql} AND ns.notebook_id = ?`)
      .bind(getWorkspaceId(c), c.req.param("id")).first<ShareRow>();
    if (!share) return notFound(c, "Active share not found");
    const memoId = c.req.param("memoId");
    const { excluded } = c.req.valid("json");
    if (excluded) {
      // The tree query deliberately ignores exclusions when selecting a target.
      const target = await db.prepare(`${publicTreeSql} SELECT m.id FROM memos m JOIN tree t
        ON m.notebook_id = t.id AND m.workspace_id = t.workspace_id WHERE m.id = ? AND m.is_deleted = 0`)
        .bind(share.token, memoId).first();
      if (!target) return notFound(c, "Note not found in this notebook share");
      await db.prepare("INSERT OR IGNORE INTO notebook_share_excluded_memos (share_id, memo_id) VALUES (?, ?)").bind(share.id, memoId).run();
    } else {
      await db.prepare("DELETE FROM notebook_share_excluded_memos WHERE share_id = ? AND memo_id = ?").bind(share.id, memoId).run();
    }
    c.header("Cache-Control", "private, no-store");
    return c.json({ memoId, excluded });
  });
  app.get("/api/v1/notebook-shares", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const rows = await c.env.storage.db
      .prepare(`${selectShareSql} ORDER BY ns.created_at DESC, ns.id`)
      .bind(getWorkspaceId(c))
      .all<ShareRow>();
    c.header("Cache-Control", "private, no-store");
    return c.json({ shares: rows.results.map((row) => mapShare(row)) });
  });
  app.get("/api/v1/notebooks/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const row = await c.env.storage.db
      .prepare(`${selectShareSql} AND ns.notebook_id = ?`)
      .bind(getWorkspaceId(c), c.req.param("id"))
      .first<ShareRow>();
    c.header("Cache-Control", "private, no-store");
    return c.json({ share: row ? mapShare(row, row.password_hash ? await readSharePassword(row.password_encrypted, row.token, c.env, row.password_hash) : undefined) : null });
  });
  app.post("/api/v1/notebooks/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const workspaceId = getWorkspaceId(c);
    const notebookId = c.req.param("id");
    const notebook = await c.env.storage.db
      .prepare(
        "SELECT id FROM notebooks WHERE id = ? AND workspace_id = ? AND is_deleted = 0",
      )
      .bind(notebookId, workspaceId)
      .first();
    if (!notebook) return notFound(c, "Notebook not found");
    const token = randomToken(32);
    const now = isoNow();
    await c.env.storage.db
      .prepare(
        `INSERT OR IGNORE INTO notebook_shares (id, notebook_id, workspace_id, token, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        createId("nbshare"),
        notebookId,
        workspaceId,
        token,
        getAuditActor(c).actorId,
        now,
        now,
      )
      .run();
    const row = await c.env.storage.db
      .prepare(`${selectShareSql} AND ns.notebook_id = ?`)
      .bind(workspaceId, notebookId)
      .first<ShareRow>();
    if (!row) throw new Error("Could not allocate notebook share");
    if (row.token === token)
      await audit(
        c.env.storage.db,
        getAuditActor(c).actorType,
        getAuditActor(c).actorId,
        "notebook.share.create",
        "notebook",
        notebookId,
        {},
      );
    c.header("Cache-Control", "private, no-store");
    return c.json({ share: mapShare(row, row.password_hash ? await readSharePassword(row.password_encrypted, row.token, c.env, row.password_hash) : undefined) });
  });
  app.patch("/api/v1/notebooks/:id/share", zValidator("json", NotebookShareUpdateSchema), async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const workspaceId = getWorkspaceId(c);
    const notebookId = c.req.param("id");
    const existing = await c.env.storage.db.prepare(`${selectShareSql} AND ns.notebook_id = ?`)
      .bind(workspaceId, notebookId).first<ShareRow>();
    if (!existing) return notFound(c, "Active share not found");
    const password = c.req.valid("json").passwordProtected ? generateSharePassword() : undefined;
    const passwordHash = password ? await hashPassword(password) : null;
    const encrypted = password ? await encryptSharePassword(password, existing.token, c.env) : null;
    const now = isoNow();
    await c.env.storage.db.prepare(`UPDATE notebook_shares SET password_hash = ?, password_encrypted = ?, unlock_failed_count = 0,
      unlock_window_started_at = NULL, unlock_blocked_until = NULL,
      site_settings_json = CASE WHEN ? IS NOT NULL THEN json_set(site_settings_json, '$.allowIndexing', json('false')) ELSE site_settings_json END, updated_at = ?
      WHERE notebook_id = ? AND workspace_id = ?`).bind(passwordHash, encrypted, passwordHash, now, notebookId, workspaceId).run();
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId,
      password ? (existing.password_hash ? "notebook.share_password_rotate" : "notebook.share_password_set") : "notebook.share_password_clear",
      "notebook", notebookId, {});
    c.header("Cache-Control", "private, no-store");
    return c.json({ share: mapShare({ ...existing, password_hash: passwordHash, site_settings_json: passwordHash ? JSON.stringify({ ...readNotebookSiteSettings(existing.site_settings_json), allowIndexing: false }) : existing.site_settings_json, updated_at: now }, password) });
  });
  app.delete("/api/v1/notebooks/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    await c.env.storage.db
      .prepare(
        "DELETE FROM notebook_shares WHERE notebook_id = ? AND workspace_id = ?",
      )
      .bind(c.req.param("id"), getWorkspaceId(c))
      .run();
    await audit(
      c.env.storage.db,
      getAuditActor(c).actorType,
      getAuditActor(c).actorId,
      "notebook.share.revoke",
      "notebook",
      c.req.param("id"),
      {},
    );
    c.header("Cache-Control", "private, no-store");
    return c.json({ ok: true });
  });
};

export const registerPublicNotebookShareRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/public/notebook-sites/:slug/resolve", async (c) => {
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    const identity = await resolveNotebookSiteToken(c.env.storage.db, c.req.param("slug"));
    return identity ? c.json(identity) : notFound(c, "Shared notebook not found");
  });
  app.use("/api/public/notebook-shares/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    const token = c.req.path.split("/")[4] ?? "";
    if (!validToken(token)) return notFound(c, "Shared notebook not found");
    const gate = await c.env.storage.db.prepare(`SELECT ns.workspace_id, ns.password_hash FROM notebook_shares ns
      JOIN notebooks n ON n.id = ns.notebook_id AND n.workspace_id = ns.workspace_id
      WHERE ns.token = ? AND n.is_deleted = 0`).bind(token)
      .first<{ workspace_id: string; password_hash: string | null }>();
    if (!gate) return notFound(c, "Shared notebook not found");
    // Only the password submission bypasses the gate; all reads, including blobs, share it.
    const unlocking = c.req.method === "POST" && c.req.path === `/api/public/notebook-shares/${token}/unlock`;
    if (!unlocking && gate.password_hash && !(await allowPasswordProtectedShare(c, token, gate.password_hash))) {
      return apiError(c, "share_password_required", "Password required to view this shared notebook", 403);
    }
    await next();
  });
  app.post("/api/public/notebook-shares/:token/unlock", zValidator("json", PublicShareUnlockSchema), async (c) => {
    const token = c.req.param("token");
    const gate = await c.env.storage.db.prepare(`SELECT password_hash, unlock_failed_count, unlock_window_started_at, unlock_blocked_until
      FROM notebook_shares WHERE token = ?`).bind(token).first<ShareUnlockState & { password_hash: string | null }>();
    if (!gate) return notFound(c, "Shared notebook not found");
    if (!gate.password_hash) return apiError(c, "share_password_not_required", "This shared notebook does not require a password", 400);
    const rateLimited = () => apiError(c, "share_unlock_rate_limited", "Too many share password attempts. Try again later.", 429);
    if (isShareUnlockBlocked(gate.unlock_blocked_until)) return rateLimited();
    if (!(await verifyPassword(c.req.valid("json").password, gate.password_hash))) {
      const failure = nextShareUnlockFailure(gate);
      await c.env.storage.db.prepare(`UPDATE notebook_shares SET unlock_failed_count = ?, unlock_window_started_at = ?, unlock_blocked_until = ?
        WHERE token = ?`).bind(failure.failureCount, failure.windowStartedAt, failure.blockedUntil, token).run();
      return failure.blockedUntil ? rateLimited() : apiError(c, "share_password_invalid", "Incorrect share password", 403);
    }
    await c.env.storage.db.prepare(`UPDATE notebook_shares SET unlock_failed_count = 0, unlock_window_started_at = NULL, unlock_blocked_until = NULL
      WHERE token = ?`).bind(token).run();
    await setShareAccessCookie(c, token, gate.password_hash, `/api/public/notebook-shares/${token}`);
    return c.json({ ok: true });
  });
  app.get("/api/public/notebook-shares/:token/search", async (c) => {
    const token = c.req.param("token");
    const query = c.req.query("q")?.trim() ?? "";
    const tag = c.req.query("tag")?.trim() ?? "";
    const limit = pageSize(c.req.query("limit"));
    const cursor = c.req.query("cursor") ?? "0";
    const offset = /^\d+$/.test(cursor) && Number.isSafeInteger(Number(cursor)) ? Number(cursor) : 0;
    const fts = toFtsQuery(query);
    const like = `%${escapeLike(query)}%`;
    const terms = query ? [...new Set([query, ...(query.match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 8)])] : [];
    const bodySql = "COALESCE(NULLIF(mc.content_text, ''), mc.content_markdown, '')";
    const positions = terms.map(() => `coalesce(nullif(instr(lower(${bodySql}), lower(?)), 0), 2147483647)`);
    const position = positions.length > 1 ? `min(${positions.join(",")})` : positions[0] ?? "1";
    const conditions: string[] = [];
    const binds: unknown[] = [token];
    if (query) {
      conditions.push(`(m.title LIKE ? ESCAPE '\\' OR mc.content_text LIKE ? ESCAPE '\\' OR mc.content_markdown LIKE ? ESCAPE '\\'${fts ? " OR m.id IN (SELECT memo_id FROM memos_fts WHERE memos_fts MATCH ?)" : ""})`);
      binds.push(like, like, like, ...(fts ? [fts] : []));
    }
    if (tag) {
      conditions.push("EXISTS (SELECT 1 FROM memo_tags mt WHERE mt.memo_id = m.id AND mt.workspace_id = m.workspace_id AND mt.normalized_name = lower(?))");
      binds.push(tag);
    }
    const rows = await c.env.storage.db.prepare(`${publicTreeSql}
      SELECT m.id, m.notebook_id AS notebookId, m.title, m.excerpt,
        substr(${bodySql}, max(1, ${position} - 60), 240) AS snippet
      FROM visible_memos m LEFT JOIN memo_contents mc ON mc.memo_id = m.id
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY m.updated_at DESC, m.id LIMIT ? OFFSET ?`)
      .bind(token, ...terms, ...binds.slice(1), limit + 1, offset)
      .all<NotebookSiteSearchResult["memos"][number] & { snippet: string }>();
    const memos = rows.results.slice(0, limit).map(({ snippet, ...row }) => ({ ...row, excerpt: snippet || row.excerpt || "", highlights: query ? [query, ...(query.match(/[\p{L}\p{N}_]+/gu) ?? [])] : [] }));
    return c.json({ memos, nextCursor: rows.results.length > limit ? String(offset + limit) : null } satisfies NotebookSiteSearchResult);
  });
  app.get("/api/public/notebook-shares/:token/memos/:memoId/preview", async (c) => {
    const row = await c.env.storage.db.prepare(`${publicTreeSql} SELECT id, title, excerpt FROM visible_memos WHERE id = ?`)
      .bind(c.req.param("token"), c.req.param("memoId")).first<NotebookSiteMemoPreview>();
    return row ? c.json({ memo: row }) : notFound(c, "Shared note not found");
  });
  app.get("/api/public/notebook-shares/:token", async (c) => {
    const token = c.req.param("token");
    if (!validToken(token)) return notFound(c, "Shared notebook not found");
    const root = await getNotebookSite(c.env.storage.db, token);
    if (!root) return notFound(c, "Shared notebook not found");
    const notebooks = await c.env.storage.db
      .prepare(
        `${publicTreeSql}
      SELECT n.id, n.parent_id AS parentId, n.name FROM notebooks n JOIN tree t ON n.id = t.id AND n.workspace_id = t.workspace_id
      ORDER BY n.sort_order, n.name, n.id`,
      )
      .bind(token)
      .all<PublicNotebookShare["notebooks"][number]>();
    if (!notebooks.results.length)
      return notFound(c, "Shared notebook not found");
    const memos = await c.env.storage.db
      .prepare(
        `${publicTreeSql}
      SELECT m.id, m.notebook_id AS notebookId, m.title FROM visible_memos m
      WHERE m.is_deleted = 0 ORDER BY m.is_pinned DESC, m.updated_at DESC, m.id`,
      )
      .bind(token)
      .all<PublicNotebookShare["memos"][number]>();
    if (root.settings.sortMode === "title") {
      notebooks.results.sort(compareNotebookSiteTitles);
      memos.results.sort(compareNotebookSiteTitles);
    }
    const share: PublicNotebookShare = {
      notebookId: root.notebook_id,
      siteSlug: root.site_slug,
      settings: root.settings,
      name: root.name,
      notebooks: notebooks.results.map((n) => ({
        ...n,
        parentId: n.id === root.notebook_id ? null : n.parentId,
      })),
      memos: memos.results,
    };
    return c.json({ share });
  });
  app.get("/api/public/notebook-shares/:token/memos/:memoId", async (c) => {
    const token = c.req.param("token");
    if (!validToken(token)) return notFound(c, "Shared note not found");
    const row = await c.env.storage.db
      .prepare(
        `${publicTreeSql}
      SELECT m.title, mc.content_json, mc.content_markdown, m.tags_json, m.updated_at, u.note_body_font,
        u.note_prose_font_size, u.note_prose_line_height, u.note_prose_palette, u.note_prose_custom_css, u.note_prose_custom_colors
      FROM visible_memos m
      JOIN memo_contents mc ON mc.memo_id = m.id
      JOIN notebook_shares ns ON ns.token = ?
      LEFT JOIN users u ON u.id = ns.created_by
      WHERE m.id = ? AND m.is_deleted = 0`,
      )
      .bind(token, token, c.req.param("memoId"))
      .first<
        NoteProseAccountRow & {
          title: string | null;
          content_json: string;
          content_markdown: string;
          tags_json: string;
          updated_at: string;
          note_body_font: string | null;
        }
      >();
    if (!row) return notFound(c, "Shared note not found");
    const contentJson = JSON.parse(row.content_json) as TiptapDoc;
    const memoUrls: Record<string, string> = {};
    const ids = collectMemoLinkIds(
      resolveMemoContentDoc(contentJson, row.content_markdown),
    );
    for (let offset = 0; offset < ids.length; offset += 80) {
      const batch = ids.slice(offset, offset + 80);
      const linked = await c.env.storage.db
        .prepare(
          `${publicTreeSql}
        SELECT m.id FROM visible_memos m
        WHERE m.is_deleted = 0 AND m.id IN (${batch.map(() => "?").join(",")})`,
        )
        .bind(token, ...batch)
        .all<{ id: string }>();
      for (const memo of linked.results)
        memoUrls[memo.id] =
          `/share/notebook/${encodeURIComponent(token)}/${encodeURIComponent(memo.id)}`;
    }
    const account = accountNoteProseFromRow(row);
    const share: PublicMemoShare = {
      title: row.title,
      contentJson,
      contentMarkdown: row.content_markdown,
      tags: parseJsonArray(row.tags_json),
      updatedAt: row.updated_at,
      memoShareTokens: {},
      bodyFont: parsePublishedNoteBodyFont(row.note_body_font),
      prose: publicNoteProseFromAccount({
        ...account,
        customCss:
          account.customCss === null
            ? null
            : sanitizeNoteProseCss(account.customCss),
      }),
    };
    return c.json({ share, memoUrls });
  });
  app.get(
    "/api/public/notebook-shares/:token/resources/:resourceId/blob",
    async (c) => {
      const token = c.req.param("token");
      if (!validToken(token)) return notFound(c, "Shared resource not found");
      const resource = await c.env.storage.db
        .prepare(
          `${publicTreeSql}
      SELECT r.object_key, r.storage_config_id, r.kind, r.mime_type, r.filename, r.byte_size,
        m.workspace_id, NULL AS password_hash
      FROM resources r JOIN memos m ON r.memo_id = m.id
      JOIN visible_memos visible ON visible.id = m.id
      WHERE r.id = ? AND r.is_deleted = 0 AND m.is_deleted = 0`,
        )
        .bind(token, c.req.param("resourceId"))
        .first<Parameters<typeof serveSharedResource>[1]>();
      if (!resource) return notFound(c, "Shared resource not found");
      return serveSharedResource(c, resource);
    },
  );
};
