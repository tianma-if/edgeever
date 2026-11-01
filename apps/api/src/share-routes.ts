import { accountNoteProseFromRow, collectMemoLinkIds, MemoShareUpdateSchema, NoteBodyFontUpdateSchema, NoteProseUpdateSchema, parsePublishedNoteBodyFont, publicNoteProseFromAccount, PublicShareUnlockSchema, resolveMemoContentDoc, sanitizeNoteProseCss, type AccountNoteProse, type ManagedMemoShare, type MemoShare, type NoteProseAccountRow, type PublicMemoShare, type TiptapDoc } from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppContext, AppEnv } from "./api-context";
import { audit } from "./audit";
import { hashPassword, randomToken, verifyPassword } from "./auth-crypto";
import { parseByteRange, rangeNotSatisfiable } from "./byte-range";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { apiError, notFound } from "./http-errors";
import { isMemoShareExpired, recordMemoShareView } from "./memo-share-access";
import { resolveObjectStorage } from "./object-storage";
import { getAuditActor, getWorkspaceId, requireUser } from "./request-auth";
import { setResourceContentHeaders } from "./resource-service";
import {
  isShareUnlockBlocked,
  nextShareUnlockFailure,
} from "./share-access";
import { allowPasswordProtectedShare, setShareAccessCookie, shareAccessCookiePath } from "./share-http-access";
import { encryptSharePassword, readSharePassword } from "./share-password-encryption";
import { resolveMemoShareToken } from "./share-page";
import { generateSharePassword } from "./share-password";

const SHARE_TOKEN_BYTES = 32;

type MemoShareRow = {
  password_encrypted?: string | null;
  memo_id: string;
  token: string;
  slug?: string | null;
  created_at: string;
  updated_at: string;
  password_hash: string | null;
  show_updated_at?: number | null;
  show_branding?: number | null;
  expires_at?: string | null;
  view_count?: number | null;
  last_viewed_at?: string | null;
};
type ManagedMemoShareRow = MemoShareRow & {
  title: string | null;
  notebook_id: string;
  notebook_name: string | null;
};
type PublicMemoShareRow = {
  workspace_id: string;
  title: string | null;
  content_json: string;
  content_markdown: string;
  tags_json: string;
  updated_at: string;
  password_hash: string | null;
  expires_at: string | null;
  show_updated_at?: number | null;
  show_branding?: number | null;
  note_body_font: string | null;
} & NoteProseAccountRow;
type ShareGateRow = {
  workspace_id: string;
  password_hash: string | null;
  expires_at: string | null;
  unlock_failed_count: number;
  unlock_window_started_at: string | null;
  unlock_blocked_until: string | null;
};
type ReferencedMemoShareRow = { memo_id: string; token: string };
type SharedResourceRow = {
  object_key: string;
  storage_config_id: string;
  kind: "image" | "attachment";
  mime_type: string | null;
  filename: string | null;
  byte_size: number;
  workspace_id: string;
  password_hash: string | null;
  expires_at: string | null;
};

const mapMemoShare = (row: MemoShareRow, password?: string): MemoShare => ({
  memoId: row.memo_id,
  token: row.token,
  slug: row.slug ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  passwordProtected: Boolean(row.password_hash),
  showUpdatedAt: row.show_updated_at !== 0,
  showBranding: row.show_branding !== 0,
  expiresAt: row.expires_at ?? null,
  expired: isMemoShareExpired(row.expires_at),
  viewCount: row.view_count ?? 0,
  lastViewedAt: row.last_viewed_at ?? null,
  ...(password ? { password } : {}),
});

const resolveShareToken = (c: AppContext, value: string) => resolveMemoShareToken(c.env.storage.db, value);

const shareSlugTaken = (c: AppContext) =>
  apiError(c, "share_slug_taken", "This share address is already in use", 409);

const sharePasswordRequired = (c: AppContext) =>
  apiError(c, "share_password_required", "Password required to view this shared note", 403);

const sharePasswordInvalid = (c: AppContext) =>
  apiError(c, "share_password_invalid", "Incorrect share password", 403);

const shareUnlockRateLimited = (c: AppContext) =>
  apiError(c, "share_unlock_rate_limited", "Too many share password attempts. Try again later.", 429);

// Distinct from 404 so the page can say the link expired; it reveals nothing about the note.
const shareExpired = (c: AppContext) => {
  c.header("Cache-Control", "private, no-store");
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  return apiError(c, "share_expired", "This shared link has expired", 410);
};

const loadShareGate = async (c: AppContext, token: string) =>
  c.env.storage.db.prepare(
    `SELECT ms.workspace_id, ms.password_hash, ms.expires_at, ms.unlock_failed_count, ms.unlock_window_started_at, ms.unlock_blocked_until
     FROM memo_shares ms
     INNER JOIN memos m ON m.id = ms.memo_id AND m.workspace_id = ms.workspace_id
     WHERE ms.token = ? AND m.is_deleted = 0
     LIMIT 1`
  ).bind(token).first<ShareGateRow>();

const selectMemoShareSql = `SELECT memo_id, token, slug, created_at, updated_at, password_hash, password_encrypted, show_updated_at, show_branding,
         expires_at, view_count, last_viewed_at
  FROM memo_shares WHERE memo_id = ? AND workspace_id = ?`;

const NOTE_PROSE_COLUMNS = `note_prose_font_size, note_prose_line_height, note_prose_palette, note_prose_custom_css, note_prose_custom_colors`;

const presentAccountNoteProse = (row: NoteProseAccountRow | null): AccountNoteProse => {
  const account = accountNoteProseFromRow(row);
  return {
    ...account,
    customCss: account.customCss === null ? null : sanitizeNoteProseCss(account.customCss),
  };
};

const loadAccountNoteProse = async (c: AppContext, actorId: string) => {
  const row = await c.env.storage.db.prepare(
    `SELECT ${NOTE_PROSE_COLUMNS} FROM users WHERE id = ?`
  ).bind(actorId).first<NoteProseAccountRow>();
  return row ? presentAccountNoteProse(row) : null;
};

/** The caller must authorize the resource against its live share scope first. */
export const serveSharedResource = async (c: AppContext, resource: SharedResourceRow) => {
  const byteRange = parseByteRange(c.req.header("Range"), resource.byte_size);
  if (byteRange.kind === "invalid") {
    const response = rangeNotSatisfiable(resource.byte_size);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return response;
  }

  const source = await resolveObjectStorage(c.env, resource.storage_config_id);
  const object = await source.store.get(
    resource.object_key,
    byteRange.kind === "range" ? { range: byteRange.range } : undefined,
  );
  if (!object) return notFound(c, "Shared resource not found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  if (byteRange.kind === "range") {
    const length = object.range?.length ?? byteRange.range.length;
    headers.set("Content-Length", String(length));
    headers.set(
      "Content-Range",
      `bytes ${byteRange.range.offset}-${byteRange.range.offset + length - 1}/${resource.byte_size}`,
    );
  } else {
    headers.set("Content-Length", String(resource.byte_size));
  }
  setResourceContentHeaders(headers, resource);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return new Response(object.body, { headers, status: byteRange.kind === "range" ? 206 : 200 });
};

export const registerPublicShareRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/public/shares/:token", async (c) => {
    const token = await resolveShareToken(c, c.req.param("token"));
    if (!token) return notFound(c, "Shared note not found");

    const row = await c.env.storage.db.prepare(
      `SELECT ms.workspace_id, m.title, mc.content_json, mc.content_markdown, m.tags_json, m.updated_at, ms.password_hash, ms.expires_at, ms.show_updated_at, ms.show_branding,
              u.note_body_font, u.note_prose_font_size, u.note_prose_line_height, u.note_prose_palette,
              u.note_prose_custom_css, u.note_prose_custom_colors
       FROM memo_shares ms
       INNER JOIN memos m ON m.id = ms.memo_id AND m.workspace_id = ms.workspace_id
       INNER JOIN memo_contents mc ON mc.memo_id = m.id
       LEFT JOIN users u ON u.id = ms.created_by
       WHERE ms.token = ? AND m.is_deleted = 0
       LIMIT 1`
    ).bind(token).first<PublicMemoShareRow>();
    if (!row) return notFound(c, "Shared note not found");
    const now = isoNow();
    if (isMemoShareExpired(row.expires_at, now)) return shareExpired(c);
    if (row.password_hash && !(await allowPasswordProtectedShare(c, token, row.password_hash))) {
      return sharePasswordRequired(c);
    }

    const contentJson = JSON.parse(row.content_json) as TiptapDoc;
    const referencedMemoIds = collectMemoLinkIds(resolveMemoContentDoc(contentJson, row.content_markdown));
    const memoShareTokens: Record<string, string> = {};
    for (let offset = 0; offset < referencedMemoIds.length; offset += 80) {
      const batch = referencedMemoIds.slice(offset, offset + 80);
      const placeholders = batch.map(() => "?").join(", ");
      const linkedShares = await c.env.storage.db.prepare(
        `SELECT ms.memo_id, COALESCE(ms.slug, ms.token) AS token
         FROM memo_shares ms
         INNER JOIN memos m ON m.id = ms.memo_id AND m.workspace_id = ms.workspace_id
         WHERE ms.workspace_id = ? AND ms.memo_id IN (${placeholders}) AND m.is_deleted = 0
           AND (ms.expires_at IS NULL OR ms.expires_at > ?)`
      ).bind(row.workspace_id, ...batch, now).all<ReferencedMemoShareRow>();
      for (const linkedShare of linkedShares.results) {
        memoShareTokens[linkedShare.memo_id] = linkedShare.token;
      }
    }

    const share: PublicMemoShare = {
      title: row.title,
      contentJson,
      contentMarkdown: row.content_markdown,
      tags: parseJsonArray(row.tags_json),
      updatedAt: row.updated_at,
      memoShareTokens,
      bodyFont: parsePublishedNoteBodyFont(row.note_body_font),
      prose: publicNoteProseFromAccount(presentAccountNoteProse(row)),
      showUpdatedAt: row.show_updated_at !== 0,
      showBranding: row.show_branding !== 0,
    };
    await recordMemoShareView(c.env.storage.db, token);
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    return c.json({ share });
  });

  app.post("/api/public/shares/:token/unlock", zValidator("json", PublicShareUnlockSchema), async (c) => {
    const token = await resolveShareToken(c, c.req.param("token"));
    if (!token) return notFound(c, "Shared note not found");

    const gate = await loadShareGate(c, token);
    if (!gate) return notFound(c, "Shared note not found");
    if (isMemoShareExpired(gate.expires_at)) return shareExpired(c);
    if (!gate.password_hash) {
      return apiError(c, "share_password_not_required", "This shared note does not require a password", 400);
    }
    if (isShareUnlockBlocked(gate.unlock_blocked_until)) {
      return shareUnlockRateLimited(c);
    }

    const password = c.req.valid("json").password;
    if (!(await verifyPassword(password, gate.password_hash))) {
      const failure = nextShareUnlockFailure(gate);
      await c.env.storage.db.prepare(
        `UPDATE memo_shares
         SET unlock_failed_count = ?, unlock_window_started_at = ?, unlock_blocked_until = ?
         WHERE token = ?`
      ).bind(failure.failureCount, failure.windowStartedAt, failure.blockedUntil, token).run();
      return failure.blockedUntil ? shareUnlockRateLimited(c) : sharePasswordInvalid(c);
    }

    await c.env.storage.db.prepare(
      `UPDATE memo_shares
       SET unlock_failed_count = 0, unlock_window_started_at = NULL, unlock_blocked_until = NULL
       WHERE token = ?`
    ).bind(token).run();
    // Scope the grant to the address the visitor used, so a slug link keeps its unlock.
    await setShareAccessCookie(c, token, gate.password_hash, shareAccessCookiePath(c.req.param("token").trim()));
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    return c.json({ ok: true });
  });

  app.get("/api/public/shares/:token/resources/:resourceId/blob", async (c) => {
    const token = await resolveShareToken(c, c.req.param("token"));
    if (!token) return notFound(c, "Shared resource not found");

    const resource = await c.env.storage.db.prepare(
      `SELECT r.object_key, r.storage_config_id, r.kind, r.mime_type, r.filename, r.byte_size,
              ms.workspace_id, ms.password_hash, ms.expires_at
       FROM memo_shares ms
       INNER JOIN memos m ON m.id = ms.memo_id AND m.workspace_id = ms.workspace_id
       INNER JOIN resources r ON r.memo_id = m.id
       WHERE ms.token = ? AND r.id = ? AND m.is_deleted = 0 AND r.is_deleted = 0
       LIMIT 1`
    ).bind(token, c.req.param("resourceId")).first<SharedResourceRow>();
    if (!resource) return notFound(c, "Shared resource not found");
    if (isMemoShareExpired(resource.expires_at)) return shareExpired(c);
    if (resource.password_hash && !(await allowPasswordProtectedShare(c, token, resource.password_hash))) {
      return sharePasswordRequired(c);
    }

    return serveSharedResource(c, resource);
  });
};

export const registerMemoShareRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/memo-shares", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;

    const parsedLimit = Number(c.req.query("limit") ?? 50);
    const parsedOffset = Number(c.req.query("offset") ?? 0);
    const limit = Number.isSafeInteger(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 50;
    const offset = Number.isSafeInteger(parsedOffset) ? Math.min(1_000_000, Math.max(0, parsedOffset)) : 0;
    const rows = await c.env.storage.db.prepare(
      `SELECT ms.memo_id, ms.token, ms.slug, ms.created_at, ms.updated_at, ms.password_hash, ms.show_updated_at, ms.show_branding,
              ms.expires_at, ms.view_count, ms.last_viewed_at,
              m.title, m.notebook_id, n.name AS notebook_name
       FROM memo_shares ms
       INNER JOIN memos m ON m.id = ms.memo_id AND m.workspace_id = ms.workspace_id
       LEFT JOIN notebooks n ON n.id = m.notebook_id AND n.workspace_id = m.workspace_id
       WHERE ms.workspace_id = ? AND m.is_deleted = 0
       ORDER BY ms.updated_at DESC, ms.id DESC
       LIMIT ? OFFSET ?`
    ).bind(getWorkspaceId(c), limit + 1, offset).all<ManagedMemoShareRow>();
    const shares: ManagedMemoShare[] = rows.results.slice(0, limit).map((row) => ({
      ...mapMemoShare(row),
      memoTitle: row.title,
      notebookId: row.notebook_id,
      notebookName: row.notebook_name,
    }));
    c.header("Cache-Control", "private, no-store");
    return c.json({ shares, nextOffset: rows.results.length > limit ? offset + limit : null });
  });

  app.put("/api/v1/me/note-body-font", zValidator("json", NoteBodyFontUpdateSchema), async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const actorId = c.get("auth").actorId;
    if (!actorId) return apiError(c, "note_body_font_unavailable", "This session cannot publish a note font", 403);
    const bodyFont = c.req.valid("json").bodyFont;
    await c.env.storage.db.prepare(
      `UPDATE users SET note_body_font = ?, updated_at = ? WHERE id = ?`
    ).bind(bodyFont, isoNow(), actorId).run();
    return c.json({ bodyFont });
  });

  app.get("/api/v1/me/note-prose", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const actorId = c.get("auth").actorId;
    if (!actorId) return apiError(c, "note_prose_unavailable", "This session cannot read note prose settings", 403);
    const prose = await loadAccountNoteProse(c, actorId);
    if (!prose) return notFound(c, "User not found");
    return c.json(prose);
  });

  app.put("/api/v1/me/note-prose", zValidator("json", NoteProseUpdateSchema), async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const actorId = c.get("auth").actorId;
    if (!actorId) return apiError(c, "note_prose_unavailable", "This session cannot update note prose settings", 403);
    const patch = c.req.valid("json");
    const assignments: string[] = [];
    const values: Array<string | number | null> = [];
    if (patch.fontSize !== undefined) {
      assignments.push("note_prose_font_size = ?");
      values.push(patch.fontSize);
    }
    if (patch.lineHeight !== undefined) {
      assignments.push("note_prose_line_height = ?");
      values.push(patch.lineHeight === null ? null : String(patch.lineHeight));
    }
    if (patch.palette !== undefined) {
      assignments.push("note_prose_palette = ?");
      values.push(patch.palette);
    }
    if (patch.customCss !== undefined) {
      assignments.push("note_prose_custom_css = ?");
      values.push(patch.customCss === null ? null : sanitizeNoteProseCss(patch.customCss));
    }
    if (patch.customColors !== undefined) {
      assignments.push("note_prose_custom_colors = ?");
      values.push(patch.customColors === null ? null : JSON.stringify(patch.customColors));
    }
    assignments.push("updated_at = ?");
    values.push(isoNow(), actorId);
    await c.env.storage.db.prepare(
      `UPDATE users SET ${assignments.join(", ")} WHERE id = ?`
    ).bind(...values).run();
    const prose = await loadAccountNoteProse(c, actorId);
    if (!prose) return notFound(c, "User not found");
    return c.json(prose);
  });

  app.get("/api/v1/memos/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;

    c.header("Cache-Control", "private, no-store");
    const row = await c.env.storage.db.prepare(
      `SELECT ms.memo_id, ms.token, ms.slug, ms.created_at, ms.updated_at, ms.password_hash, ms.password_encrypted, ms.show_updated_at, ms.show_branding,
              ms.expires_at, ms.view_count, ms.last_viewed_at
       FROM memo_shares ms
       INNER JOIN memos m ON m.id = ms.memo_id AND m.workspace_id = ms.workspace_id
       WHERE ms.memo_id = ? AND ms.workspace_id = ? AND m.is_deleted = 0
       LIMIT 1`
    ).bind(c.req.param("id"), getWorkspaceId(c)).first<MemoShareRow>();
    return c.json({ share: row ? mapMemoShare(row, row.password_hash ? await readSharePassword(row.password_encrypted, row.token, c.env, row.password_hash) : undefined) : null });
  });

  app.post("/api/v1/memos/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;

    c.header("Cache-Control", "private, no-store");
    const memoId = c.req.param("id");
    const workspaceId = getWorkspaceId(c);
    const memo = await c.env.storage.db.prepare(
      `SELECT id FROM memos WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
    ).bind(memoId, workspaceId).first<{ id: string }>();
    if (!memo) return notFound(c, "Memo not found");

    const existing = await c.env.storage.db.prepare(selectMemoShareSql)
      .bind(memoId, workspaceId).first<MemoShareRow>();
    if (existing) return c.json({ share: mapMemoShare(existing, existing.password_hash ? await readSharePassword(existing.password_encrypted, existing.token, c.env, existing.password_hash) : undefined) });

    const now = isoNow();
    const token = randomToken(SHARE_TOKEN_BYTES);
    const actor = getAuditActor(c);
    await c.env.storage.db.prepare(
      `INSERT OR IGNORE INTO memo_shares (id, memo_id, workspace_id, token, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(createId("share"), memoId, workspaceId, token, actor.actorId, now, now).run();
    const created = await c.env.storage.db.prepare(selectMemoShareSql)
      .bind(memoId, workspaceId).first<MemoShareRow>();
    if (!created) {
      throw new Error("Could not allocate a unique memo share token");
    }
    const isNewShare = created.token === token;
    if (isNewShare) {
      await audit(c.env.storage.db, actor.actorType, actor.actorId, "memo.share_create", "memo", memoId, {});
    }
    return c.json({ share: mapMemoShare(created, created.password_hash ? await readSharePassword(created.password_encrypted, created.token, c.env, created.password_hash) : undefined) }, isNewShare ? 201 : 200);
  });

  app.patch("/api/v1/memos/:id/share", zValidator("json", MemoShareUpdateSchema), async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;

    c.header("Cache-Control", "private, no-store");
    const memoId = c.req.param("id");
    const workspaceId = getWorkspaceId(c);
    const existing = await c.env.storage.db.prepare(
      `${selectMemoShareSql} AND EXISTS (
         SELECT 1 FROM memos m WHERE m.id = memo_shares.memo_id AND m.workspace_id = memo_shares.workspace_id AND m.is_deleted = 0
       )`
    ).bind(memoId, workspaceId).first<MemoShareRow>();
    if (!existing) return notFound(c, "Active share not found");

    const now = isoNow();
    const actor = getAuditActor(c);
    const { passwordProtected, password, slug, showUpdatedAt, showBranding, expiresAt } = c.req.valid("json");
    const nextExpiresAt = expiresAt ? new Date(expiresAt).toISOString() : expiresAt;
    if (nextExpiresAt && nextExpiresAt <= now) {
      return apiError(c, "share_expiry_invalid", "The expiry must be in the future", 400);
    }
    if (slug !== undefined && slug !== (existing.slug ?? null)) {
      if (slug !== null) {
        await c.env.storage.db.prepare(
          `INSERT OR IGNORE INTO memo_share_slug_claims (slug, workspace_id, created_at) VALUES (?, ?, ?)`
        ).bind(slug, workspaceId, now).run();
        const claim = await c.env.storage.db.prepare(
          `SELECT workspace_id FROM memo_share_slug_claims WHERE slug = ?`
        ).bind(slug).first<{ workspace_id: string }>();
        if (claim?.workspace_id !== workspaceId) return shareSlugTaken(c);
        const owner = await c.env.storage.db.prepare(
          `SELECT memo_id FROM memo_shares WHERE slug = ? LIMIT 1`
        ).bind(slug).first<{ memo_id: string }>();
        if (owner) return shareSlugTaken(c);
      }
      try {
        await c.env.storage.db.prepare(
          `UPDATE memo_shares SET slug = ?, updated_at = ? WHERE memo_id = ? AND workspace_id = ?`
        ).bind(slug, now, memoId, workspaceId).run();
      } catch (error) {
        // A concurrent claim of the same slug loses on the unique index.
        if (String(error).includes("UNIQUE")) return shareSlugTaken(c);
        throw error;
      }
      await audit(c.env.storage.db, actor.actorType, actor.actorId, slug ? "memo.share_slug_set" : "memo.share_slug_clear", "memo", memoId, {});
    }
    if ((showUpdatedAt !== undefined && showUpdatedAt !== (existing.show_updated_at !== 0)) ||
        (showBranding !== undefined && showBranding !== (existing.show_branding !== 0))) {
      await c.env.storage.db.prepare(
        `UPDATE memo_shares
         SET show_updated_at = COALESCE(?, show_updated_at), show_branding = COALESCE(?, show_branding), updated_at = ?
         WHERE memo_id = ? AND workspace_id = ?`
      ).bind(
        showUpdatedAt === undefined ? null : Number(showUpdatedAt),
        showBranding === undefined ? null : Number(showBranding),
        now, memoId, workspaceId,
      ).run();
      await audit(
        c.env.storage.db,
        actor.actorType,
        actor.actorId,
        "memo.share_presentation_update",
        "memo",
        memoId,
        { showUpdatedAt, showBranding },
      );
    }
    if (nextExpiresAt !== undefined && nextExpiresAt !== (existing.expires_at ?? null)) {
      await c.env.storage.db.prepare(
        `UPDATE memo_shares SET expires_at = ?, updated_at = ? WHERE memo_id = ? AND workspace_id = ?`
      ).bind(nextExpiresAt, now, memoId, workspaceId).run();
      await audit(
        c.env.storage.db,
        actor.actorType,
        actor.actorId,
        nextExpiresAt ? "memo.share_expiry_set" : "memo.share_expiry_clear",
        "memo",
        memoId,
        nextExpiresAt ? { expiresAt: nextExpiresAt } : {},
      );
    }
    if (passwordProtected === undefined && password === undefined) {
      const current = await c.env.storage.db.prepare(selectMemoShareSql)
        .bind(memoId, workspaceId).first<MemoShareRow>() ?? existing;
      return c.json({ share: mapMemoShare(current, current.password_hash ? await readSharePassword(current.password_encrypted, current.token, c.env, current.password_hash) : undefined) });
    }
    if (passwordProtected === false) {
      await c.env.storage.db.prepare(
        `UPDATE memo_shares
         SET password_hash = NULL, password_encrypted = NULL, unlock_failed_count = 0, unlock_window_started_at = NULL,
             unlock_blocked_until = NULL, updated_at = ?
         WHERE memo_id = ? AND workspace_id = ?`
      ).bind(now, memoId, workspaceId).run();
      await audit(c.env.storage.db, actor.actorType, actor.actorId, "memo.share_password_clear", "memo", memoId, {});
      const cleared = await c.env.storage.db.prepare(selectMemoShareSql)
        .bind(memoId, workspaceId).first<MemoShareRow>();
      return c.json({ share: mapMemoShare(cleared ?? { ...existing, password_hash: null, updated_at: now }) });
    }

    const nextPassword = password ?? generateSharePassword();
    const passwordHash = await hashPassword(nextPassword);
    const encrypted = await encryptSharePassword(nextPassword, existing.token, c.env);
    await c.env.storage.db.prepare(
      `UPDATE memo_shares
       SET password_hash = ?, password_encrypted = ?, unlock_failed_count = 0, unlock_window_started_at = NULL,
           unlock_blocked_until = NULL, updated_at = ?
       WHERE memo_id = ? AND workspace_id = ?`
    ).bind(passwordHash, encrypted, now, memoId, workspaceId).run();
    await audit(
      c.env.storage.db,
      actor.actorType,
      actor.actorId,
      existing.password_hash ? "memo.share_password_rotate" : "memo.share_password_set",
      "memo",
      memoId,
      { custom: Boolean(password) },
    );
    const updated = await c.env.storage.db.prepare(selectMemoShareSql)
      .bind(memoId, workspaceId).first<MemoShareRow>();
    return c.json({ share: mapMemoShare(updated ?? { ...existing, password_hash: passwordHash, updated_at: now }, nextPassword) });
  });

  app.delete("/api/v1/memos/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;

    c.header("Cache-Control", "private, no-store");
    const memoId = c.req.param("id");
    const workspaceId = getWorkspaceId(c);
    const existing = await c.env.storage.db.prepare(
      `SELECT memo_id FROM memo_shares WHERE memo_id = ? AND workspace_id = ?`
    ).bind(memoId, workspaceId).first<{ memo_id: string }>();
    // A retry after successful revocation already has the requested state.
    if (!existing) return c.json({ ok: true });

    await c.env.storage.db.prepare(
      `DELETE FROM memo_shares WHERE memo_id = ? AND workspace_id = ?`
    ).bind(memoId, workspaceId).run();
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "memo.share_revoke", "memo", memoId, {});
    return c.json({ ok: true });
  });
};
