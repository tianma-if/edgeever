import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { registerPublicPublishImageRoutes, registerPublishImageRoutes } from "./publish-image-routes.ts";
import { registerResourceRoutes } from "./resource-routes.ts";
import { getResourceRow } from "./resource-service.ts";

const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=", "base64"));
const fixtures = [];
afterEach(async () => {
  for (const { sqlite, directory } of fixtures.splice(0)) { sqlite.close(); await rm(directory, { recursive: true, force: true }); }
});
const fixture = async ({ legacyPublication = false } = {}) => {
  const sqlite = new Database(":memory:");
  // Start from the previous schema with real private resources, then upgrade.
  for (const path of globSync("migrations/*.sql").sort()) {
    if (path < "migrations/0094") sqlite.exec(readFileSync(path, "utf8"));
  }
  sqlite.exec(`INSERT INTO workspaces (id, name, is_personal) VALUES ('ws_publish', 'Publish', 1), ('ws_other', 'Other', 1);
    INSERT INTO notebooks (id, workspace_id, name) VALUES ('nb_publish', 'ws_publish', 'Private');
    INSERT INTO memos (id, workspace_id, notebook_id, title) VALUES ('memo_private', 'ws_publish', 'nb_publish', 'Private');
    INSERT INTO resources (id, memo_id, object_key, kind, mime_type) VALUES ('res_private', 'memo_private', 'private/image.png', 'image', 'image/png');`);
  sqlite.exec(readFileSync("migrations/0094_publish_images.sql", "utf8"));
  if (legacyPublication) sqlite.query(`INSERT INTO publish_images
    (token, workspace_id, sha256, object_key, storage_config_id, mime_type, byte_size, created_at)
    VALUES (?, 'ws_publish', 'legacy-hash', 'legacy/published.png', 'builtin', 'image/png', ?, '2026-11-15')`)
    .run('L'.repeat(43), png.byteLength);
  sqlite.exec(readFileSync("migrations/0095_publish_animated_images.sql", "utf8"));
  const directory = await mkdtemp(`${tmpdir()}/edgeever-publish-`);
  fixtures.push({ sqlite, directory });
  const storage = createSelfHostedStorageAdapter(sqlite, directory);
  await storage.resources.put("private/image.png", png);
  if (legacyPublication) await storage.resources.put("legacy/published.png", png);
  const env = { storage };
  const app = new Hono();
  app.onError((_error, c) => c.json({ error: "Test request failed" }, 500));
  registerPublicPublishImageRoutes(app);
  app.use("/api/v1/*", async (c, next) => {
    if (!c.req.header("X-Test-Workspace")) return c.json({ error: "Unauthorized" }, 401);
    c.set("auth", { kind: c.req.header("X-Test-Agent") ? "agent" : "user", workspaceId: c.req.header("X-Test-Workspace"), scopes: ["write:resources"] });
    await next();
  });
  registerPublishImageRoutes(app);
  registerResourceRoutes(app, { getResourceRow });
  const upload = (workspace = "ws_publish", bytes = png, type = "image/png", extra = {}) => app.request("/api/v1/publish-images", {
    method: "POST", body: bytes, headers: { "Content-Type": type, "X-Test-Workspace": workspace, ...extra },
  }, env);
  return { sqlite, env, app, upload };
};

describe("publication images across schema upgrade", () => {
  test("0094 publication URLs and private resource ownership survive the 0095 upgrade", async () => {
    const { app, env, sqlite } = await fixture({ legacyPublication: true });
    const response = await app.request(`/api/public/publish-images/${'L'.repeat(43)}`, {}, env);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(sqlite.query("SELECT workspace_id, object_key FROM publish_images WHERE token = ?").get('L'.repeat(43)))
      .toEqual({ workspace_id: 'ws_publish', object_key: 'legacy/published.png' });
  });

  test("stores and serves animated containers byte-for-byte with matching MIME types and filenames", async () => {
    const { app, env, upload } = await fixture();
    for (const [extension, mime] of [["gif", "image/gif"], ["webp", "image/webp"], ["png", "image/png"], ["avif", "image/avif"]]) {
      const bytes = new Uint8Array(readFileSync(`tests/fixtures/publish-animation/two-frames.${extension}`));
      const response = await upload("ws_publish", bytes, mime);
      expect(response.status).toBe(200);
      const { url } = await response.json();
      const image = await app.request(url, {}, env);
      expect(image.headers.get("Content-Type")).toBe(mime);
      expect(image.headers.get("Content-Disposition")).toContain(`image.${extension}`);
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
      expect(await (await upload("ws_publish", bytes, mime)).json()).toEqual({ url });
      expect((await upload("ws_publish", png, mime === 'image/png' ? 'image/gif' : mime)).status).toBe(400);
    }
  });
  test("publishes a separate image anonymously without exposing an old private resource", async () => {
    const { app, env, upload, sqlite } = await fixture();
    expect(sqlite.query("SELECT object_key FROM resources WHERE id='res_private'").get().object_key).toBe("private/image.png");
    const response = await upload();
    expect(response.status).toBe(200);
    const { url } = await response.json();
    expect(url).toMatch(/^\/api\/public\/publish-images\/[A-Za-z0-9_-]{43}$/);
    const image = await app.request(url, {}, env);
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(image.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
    expect((await app.request(url, { method: "HEAD" }, env)).status).toBe(200);
    expect((await app.request("/api/public/publish-images/res_private", {}, env)).status).toBe(404);
    expect((await app.request(`/api/public/publish-images/${'x'.repeat(43)}`, {}, env)).status).toBe(404);
    expect((await app.request("/api/v1/resources/res_private/blob", {}, env)).status).toBe(401);
    const privateImage = await app.request("/api/v1/resources/res_private/blob", { headers: { "X-Test-Workspace": "ws_publish" } }, env);
    expect(privateImage.status).toBe(200);
    expect(new Uint8Array(await privateImage.arrayBuffer())).toEqual(png);
    expect((await app.request("/api/v1/resources/res_private/blob", { headers: { "X-Test-Workspace": "ws_other" } }, env)).status).toBe(404);
  });

  test("deduplicates within a workspace and keeps publication ownership isolated", async () => {
    const { app, env, upload, sqlite } = await fixture();
    const first = await (await upload()).json();
    expect(await (await upload()).json()).toEqual(first);
    const other = await (await upload("ws_other")).json();
    expect(other.url).not.toBe(first.url);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM publish_images").get().count).toBe(2);
    const token = first.url.split("/").pop();
    expect((await app.request(`/api/v1/publish-images/${token}`, { method: "DELETE", headers: { "X-Test-Workspace": "ws_other" } }, env)).status).toBe(404);
    expect((await app.request(`/api/v1/publish-images/${token}`, { method: "DELETE", headers: { "X-Test-Workspace": "ws_publish" } }, env)).status).toBe(200);
    expect((await app.request(first.url, {}, env)).status).toBe(404);
    expect((await app.request(other.url, {}, env)).status).toBe(200);
  });

  test("rejects unauthorized uploads, agent uploads, active content, invalid bytes, and oversized bodies", async () => {
    const { app, env, upload, sqlite } = await fixture();
    expect((await app.request("/api/v1/publish-images", { method: "POST", body: png }, env)).status).toBe(401);
    expect((await upload("ws_publish", png, "image/png", { "X-Test-Agent": "1" })).status).toBe(403);
    expect((await upload("ws_publish", new TextEncoder().encode('<svg/>'), "image/svg+xml")).status).toBe(400);
    expect((await upload("ws_publish", new TextEncoder().encode('<html>bad</html>'))).status).toBe(400);
    expect((await upload("ws_publish", new Uint8Array(10 * 1024 * 1024 + 1))).status).toBe(413);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM publish_images").get().count).toBe(0);
  });

  test("database failures clean up newly written objects and do not claim success", async () => {
    const { env, upload } = await fixture();
    let key;
    const originalPut = env.storage.resources.put;
    env.storage.resources.put = async (name, ...args) => { key = name; return originalPut(name, ...args); };
    const prepare = env.storage.db.prepare.bind(env.storage.db);
    env.storage.db.prepare = (sql) => {
      if (sql.startsWith("INSERT INTO publish_images")) throw new Error("simulated database failure");
      return prepare(sql);
    };
    expect((await upload()).status).toBe(500);
    expect(await env.storage.resources.get(key)).toBeNull();
  });

  test("duplicate upload reads stay bounded with representative existing publication data", async () => {
    const { sqlite, env, upload } = await fixture();
    const insert = sqlite.query(`INSERT INTO publish_images (token, workspace_id, sha256, object_key, storage_config_id, mime_type, byte_size, created_at)
      VALUES (?, 'ws_publish', ?, ?, 'builtin', 'image/png', 100, '2026-11-15')`);
    for (let index = 0; index < 1000; index++) insert.run(`seed-${index}`, `hash-${index}`, `key-${index}`);
    await upload();
    const prepare = env.storage.db.prepare.bind(env.storage.db);
    const queries = [];
    env.storage.db.prepare = (sql) => { queries.push(sql); return prepare(sql); };
    for (let index = 0; index < 10; index++) expect((await upload()).status).toBe(200);
    expect(queries).toHaveLength(10);
    expect(queries.every((sql) => sql.includes("workspace_id = ? AND sha256 = ?"))).toBe(true);
    const plan = sqlite.query("EXPLAIN QUERY PLAN SELECT token FROM publish_images WHERE workspace_id = ? AND sha256 = ?").all('ws_publish', 'hash-500');
    expect(plan.map((item) => item.detail).join(' ')).toContain('USING INDEX');
  });
});
