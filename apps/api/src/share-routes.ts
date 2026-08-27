import { collectMemoLinkIds, isPdfAttachment, resolveMemoContentDoc, type MemoShare, type PublicMemoShare, type TiptapDoc } from "@edgeever/shared";
import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { audit } from "./audit";
import { randomToken } from "./auth-crypto";
import { parseByteRange, rangeNotSatisfiable } from "./byte-range";
import { createId, isoNow, parseJsonArray } from "./entity-utils";
import { notFound } from "./http-errors";
import { resolveObjectStorage } from "./object-storage";
import { getAuditActor, getWorkspaceId, requireUser } from "./request-auth";

const SHARE_TOKEN_BYTES = 32;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type MemoShareRow = { memo_id: string; token: string; created_at: string; updated_at: string };
type PublicMemoShareRow = {
  workspace_id: string;
  title: string | null;
  content_json: string;
  content_markdown: string;
  tags_json: string;
  updated_at: string;
};
type ReferencedMemoShareRow = { memo_id: string; token: string };
type SharedResourceRow = {
  object_key: string;
  storage_config_id: string;
  kind: "image" | "attachment";
  mime_type: string | null;
  filename: string | null;
  byte_size: number;
};

const mapMemoShare = (row: MemoShareRow): MemoShare => ({
  memoId: row.memo_id,
  token: row.token,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const normalizeFilename = (filename: string) =>
  filename.trim().replace(/[\\/]/g, "-").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160);

const contentDisposition = (kind: SharedResourceRow["kind"], mimeType: string | null, filename: string | null) => {
  const inline = kind === "image" || isPdfAttachment(mimeType, filename);
  if (!filename) return inline ? "inline" : "attachment";
  const fallback = normalizeFilename(filename).replace(/"/g, "'");
  const disposition = inline ? "inline" : "attachment";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

const normalizeShareToken = (value: string) => {
  const token = value.trim();
  return SHARE_TOKEN_PATTERN.test(token) ? token : null;
};

export const registerPublicShareRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/public/shares/:token", async (c) => {
    const token = normalizeShareToken(c.req.param("token"));
    if (!token) return notFound(c, "Shared note not found");

    const row = await c.env.storage.db.prepare(
      `SELECT ms.workspace_id, m.title, mc.content_json, mc.content_markdown, m.tags_json, m.updated_at
       FROM memo_shares ms
       INNER JOIN memos m ON m.id = ms.memo_id AND m.workspace_id = ms.workspace_id
       INNER JOIN memo_contents mc ON mc.memo_id = m.id
       WHERE ms.token = ? AND m.is_deleted = 0
       LIMIT 1`
    ).bind(token).first<PublicMemoShareRow>();
    if (!row) return notFound(c, "Shared note not found");

    const contentJson = JSON.parse(row.content_json) as TiptapDoc;
    const referencedMemoIds = collectMemoLinkIds(resolveMemoContentDoc(contentJson, row.content_markdown));
    const memoShareTokens: Record<string, string> = {};
    for (let offset = 0; offset < referencedMemoIds.length; offset += 80) {
      const batch = referencedMemoIds.slice(offset, offset + 80);
      const placeholders = batch.map(() => "?").join(", ");
      const linkedShares = await c.env.storage.db.prepare(
        `SELECT ms.memo_id, ms.token
         FROM memo_shares ms
         INNER JOIN memos m ON m.id = ms.memo_id AND m.workspace_id = ms.workspace_id
         WHERE ms.workspace_id = ? AND ms.memo_id IN (${placeholders}) AND m.is_deleted = 0`
      ).bind(row.workspace_id, ...batch).all<ReferencedMemoShareRow>();
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
    };
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    return c.json({ share });
  });

  app.get("/api/public/shares/:token/resources/:resourceId/blob", async (c) => {
    const token = normalizeShareToken(c.req.param("token"));
    if (!token) return notFound(c, "Shared resource not found");

    const resource = await c.env.storage.db.prepare(
      `SELECT r.object_key, r.storage_config_id, r.kind, r.mime_type, r.filename, r.byte_size
       FROM memo_shares ms
       INNER JOIN memos m ON m.id = ms.memo_id AND m.workspace_id = ms.workspace_id
       INNER JOIN resources r ON r.memo_id = m.id
       WHERE ms.token = ? AND r.id = ? AND m.is_deleted = 0 AND r.is_deleted = 0
       LIMIT 1`
    ).bind(token, c.req.param("resourceId")).first<SharedResourceRow>();
    if (!resource) return notFound(c, "Shared resource not found");

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
    headers.set(
      "Content-Type",
      isPdfAttachment(resource.mime_type, resource.filename)
        ? "application/pdf"
        : resource.mime_type ?? headers.get("Content-Type") ?? "application/octet-stream",
    );
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
    headers.set("Content-Disposition", contentDisposition(resource.kind, resource.mime_type, resource.filename));
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return new Response(object.body, { headers, status: byteRange.kind === "range" ? 206 : 200 });
  });
};

export const registerMemoShareRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/memos/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;

    const row = await c.env.storage.db.prepare(
      `SELECT ms.memo_id, ms.token, ms.created_at, ms.updated_at
       FROM memo_shares ms
       INNER JOIN memos m ON m.id = ms.memo_id AND m.workspace_id = ms.workspace_id
       WHERE ms.memo_id = ? AND ms.workspace_id = ? AND m.is_deleted = 0
       LIMIT 1`
    ).bind(c.req.param("id"), getWorkspaceId(c)).first<MemoShareRow>();
    return c.json({ share: row ? mapMemoShare(row) : null });
  });

  app.post("/api/v1/memos/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;

    const memoId = c.req.param("id");
    const workspaceId = getWorkspaceId(c);
    const memo = await c.env.storage.db.prepare(
      `SELECT id FROM memos WHERE id = ? AND workspace_id = ? AND is_deleted = 0`
    ).bind(memoId, workspaceId).first<{ id: string }>();
    if (!memo) return notFound(c, "Memo not found");

    const existing = await c.env.storage.db.prepare(
      `SELECT memo_id, token, created_at, updated_at FROM memo_shares WHERE memo_id = ? AND workspace_id = ?`
    ).bind(memoId, workspaceId).first<MemoShareRow>();
    if (existing) return c.json({ share: mapMemoShare(existing) });

    const now = isoNow();
    const token = randomToken(SHARE_TOKEN_BYTES);
    const actor = getAuditActor(c);
    await c.env.storage.db.prepare(
      `INSERT OR IGNORE INTO memo_shares (id, memo_id, workspace_id, token, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(createId("share"), memoId, workspaceId, token, actor.actorId, now, now).run();
    const created = await c.env.storage.db.prepare(
      `SELECT memo_id, token, created_at, updated_at FROM memo_shares WHERE memo_id = ? AND workspace_id = ?`
    ).bind(memoId, workspaceId).first<MemoShareRow>();
    if (!created) {
      throw new Error("Could not allocate a unique memo share token");
    }
    const isNewShare = created.token === token;
    if (isNewShare) {
      await audit(c.env.storage.db, actor.actorType, actor.actorId, "memo.share_create", "memo", memoId, {});
    }
    return c.json({ share: mapMemoShare(created) }, isNewShare ? 201 : 200);
  });

  app.delete("/api/v1/memos/:id/share", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;

    const memoId = c.req.param("id");
    const workspaceId = getWorkspaceId(c);
    const existing = await c.env.storage.db.prepare(
      `SELECT memo_id FROM memo_shares WHERE memo_id = ? AND workspace_id = ?`
    ).bind(memoId, workspaceId).first<{ memo_id: string }>();
    if (!existing) return notFound(c, "Active share not found");

    await c.env.storage.db.prepare(
      `DELETE FROM memo_shares WHERE memo_id = ? AND workspace_id = ?`
    ).bind(memoId, workspaceId).run();
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "memo.share_revoke", "memo", memoId, {});
    return c.json({ ok: true });
  });
};
