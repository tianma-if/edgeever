import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { randomToken } from "./auth-crypto";
import { sha256Bytes } from "./hash-utils";
import { apiError, badRequest, notFound } from "./http-errors";
import { resolveObjectStorage } from "./object-storage";
import { getWorkspaceId, requireUser } from "./request-auth";

const MAX_BYTES = 10 * 1024 * 1024;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
type PublishImage = {
  token: string; object_key: string; storage_config_id: string; mime_type: "image/png" | "image/jpeg";
};
const pathFor = (token: string) => `/api/public/publish-images/${token}`;

/** Token-scoped publication copies, never a public gateway to private resources. */
export const registerPublicPublishImageRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/public/publish-images/:token", async (c) => {
    c.header("Cache-Control", "no-store");
    const token = c.req.param("token");
    if (!TOKEN.test(token)) return notFound(c, "Image not found");
    const row = await c.env.storage.db.prepare(
      "SELECT token, object_key, storage_config_id, mime_type FROM publish_images WHERE token = ?",
    ).bind(token).first<PublishImage>();
    if (!row) return notFound(c, "Image not found");
    const { store } = await resolveObjectStorage(c.env, row.storage_config_id);
    const object = await store.get(row.object_key);
    if (!object) return notFound(c, "Image not found");
    c.header("Content-Type", row.mime_type);
    c.header("Content-Length", String(object.size));
    c.header("Content-Disposition", `inline; filename="diagram.${row.mime_type === "image/png" ? "png" : "jpg"}"`);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Referrer-Policy", "no-referrer");
    return c.body(object.body);
  });
};

export const registerPublishImageRoutes = (app: Hono<AppEnv>) => {
  app.post("/api/v1/publish-images", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const mime = c.req.header("Content-Type")?.split(";")[0].trim();
    if (mime !== "image/png" && mime !== "image/jpeg") return badRequest(c, "Expected a PNG or JPEG image.");
    if (Number(c.req.header("Content-Length")) > MAX_BYTES) return apiError(c, "image_too_large", "Publication images must be at most 10 MiB.", 413);
    // Bound actual bytes as well: chunked requests need not declare a length.
    const reader = c.req.raw.body?.getReader();
    if (!reader) return badRequest(c, "Image is empty.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) return apiError(c, "image_too_large", "Publication images must be at most 10 MiB.", 413);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const valid = mime === "image/png"
      ? bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
      : bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid) return badRequest(c, "Image bytes do not match the declared format.");
    const db = c.env.storage.db;
    const workspace = getWorkspaceId(c);
    const hash = await sha256Bytes(bytes);
    const find = () => db.prepare("SELECT token FROM publish_images WHERE workspace_id = ? AND sha256 = ?")
      .bind(workspace, hash).first<{ token: string }>();
    const existing = await find();
    if (existing) return c.json({ url: pathFor(existing.token) });
    const token = randomToken(32);
    const storage = await resolveObjectStorage(c.env);
    const key = `workspaces/${workspace}/publish-images/${token}`;
    await storage.store.put(key, bytes, { httpMetadata: { contentType: mime } });
    let stored = false;
    try {
      const inserted = await db.prepare(`INSERT INTO publish_images
        (token, workspace_id, sha256, object_key, storage_config_id, mime_type, byte_size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, sha256) DO NOTHING`)
        .bind(token, workspace, hash, key, storage.configId, mime, size, new Date().toISOString()).run();
      stored = Number(inserted.meta.changes) === 1;
      if (stored) return c.json({ url: pathFor(token) });
      const winner = await find();
      if (!winner) throw new Error("Publication image was not saved");
      return c.json({ url: pathFor(winner.token) });
    } finally {
      if (!stored) await storage.store.delete(key);
    }
  });

  app.delete("/api/v1/publish-images/:token", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const token = c.req.param("token");
    const row = await c.env.storage.db.prepare(
      "SELECT token, object_key, storage_config_id, mime_type FROM publish_images WHERE token = ? AND workspace_id = ?",
    ).bind(token, getWorkspaceId(c)).first<PublishImage>();
    if (!row) return notFound(c, "Image not found");
    const { store } = await resolveObjectStorage(c.env, row.storage_config_id);
    await c.env.storage.db.prepare("DELETE FROM publish_images WHERE token = ? AND workspace_id = ?")
      .bind(token, getWorkspaceId(c)).run();
    await store.delete(row.object_key);
    return c.json({ ok: true });
  });
};
