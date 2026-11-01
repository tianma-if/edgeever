import { FONT_IDS } from "@edgeever/shared/font-catalog";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { hashPassword } from "./auth-crypto.ts";
import { registerMemoShareRoutes, registerPublicShareRoutes } from "./share-routes.ts";

class SqliteD1PreparedStatement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new SqliteD1PreparedStatement(this.db, this.sql, bindings);
  }

  async all() {
    return { results: this.db.query(this.sql).all(...this.bindings), success: true, meta: {} };
  }

  async first() {
    return this.db.query(this.sql).get(...this.bindings) ?? null;
  }

  async run() {
    this.db.query(this.sql).run(...this.bindings);
    return { success: true, meta: {} };
  }
}

class SqliteD1Database {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new SqliteD1PreparedStatement(this.db, sql);
  }

  async batch(statements) {
    return this.db.transaction(() => statements.map((statement) =>
      this.db.query(statement.sql).run(...statement.bindings)))();
  }
}

const sourceToken = "s".repeat(43);
const targetToken = "t".repeat(43);

const createDatabaseEnvironment = ({ presentationMigration = true } = {}) => {
  const sqlite = new Database(":memory:");
  for (const migration of globSync("migrations/*.sql").sort()) {
    if (!presentationMigration && migration.endsWith("0083_memo_share_presentation.sql")) continue;
    sqlite.exec(readFileSync(migration, "utf8"));
  }
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)")
    .run("ws_member", "Member workspace");
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
    .run("nb_member", "ws_member", "Inbox");

  const contentJson = JSON.stringify({
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "Public", marks: [{ type: "link", attrs: { href: "#memo=memo_target" } }] },
        { type: "text", text: "Private", marks: [{ type: "link", attrs: { href: "#memo=memo_private" } }] },
      ],
    }],
  });
  for (const [id, title, content] of [
    ["memo_source", "Source", contentJson],
    ["memo_target", "Target", JSON.stringify({ type: "doc", content: [] })],
    ["memo_private", "Private", JSON.stringify({ type: "doc", content: [] })],
  ]) {
    sqlite.query("INSERT INTO memos (id, workspace_id, notebook_id, title) VALUES (?, ?, ?, ?)")
      .run(id, "ws_member", "nb_member", title);
    sqlite.query("INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_hash) VALUES (?, ?, '', ?)")
      .run(id, content, `${id}-hash`);
  }
  sqlite.query("INSERT INTO memo_shares (id, memo_id, workspace_id, token) VALUES (?, ?, ?, ?)")
    .run("share_source", "memo_source", "ws_member", sourceToken);
  sqlite.query("INSERT INTO memo_shares (id, memo_id, workspace_id, token) VALUES (?, ?, ?, ?)")
    .run("share_target", "memo_target", "ws_member", targetToken);

  return {
    sqlite,
    environment: { EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY: "test-share-master-key", storage: { db: new SqliteD1Database(sqlite), resources: {} } },
  };
};

describe("public memo shares", () => {
  test("returns share tokens only for referenced notes that are also public", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = new Hono();
    registerPublicShareRoutes(app);

    const response = await app.request(`/api/public/shares/${sourceToken}`, {}, environment);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      share: { memoShareTokens: { memo_target: targetToken }, bodyFont: null },
    });
    sqlite.close();
  });

  test("defaults both presentation settings on for migrated shares and new shares", async () => {
    const { sqlite, environment } = createDatabaseEnvironment({ presentationMigration: false });
    try {
      sqlite.exec("UPDATE memo_shares SET show_details = 0");
      const before = sqlite.query("SELECT * FROM memo_shares ORDER BY id").all();
      sqlite.exec(readFileSync("migrations/0083_memo_share_presentation.sql", "utf8"));
      expect(sqlite.prepare("SELECT * FROM memo_shares ORDER BY id").all()).toEqual(
        before.map((row) => ({ ...row, show_updated_at: 1, show_branding: 1 })),
      );
      const app = createShareApp(environment);
      for (const path of ["/api/v1/memos/memo_source/share", `/api/public/shares/${sourceToken}`]) {
        const share = (await (await app.request(path, {}, environment)).json()).share;
        expect(share).toMatchObject({ showUpdatedAt: true, showBranding: true });
        expect(share).not.toHaveProperty("showDetails");
      }
      const created = await app.request("/api/v1/memos/memo_private/share", { method: "POST" }, environment);
      expect(created.status).toBe(201);
      expect((await created.json()).share).toMatchObject({ showUpdatedAt: true, showBranding: true });
    } finally {
      sqlite.close();
    }
  });

  test("persists all four time/branding combinations independently without changing passwords", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    const path = "/api/v1/memos/memo_source/share";
    const patch = (body) => app.request(path, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }, environment);
    try {
      const protectedShare = (await (await patch({ password: "custom-password-714" })).json()).share;
      const unlocked = await app.request(`/api/public/shares/${sourceToken}/unlock`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: protectedShare.password }),
      }, environment);
      const headers = { Cookie: unlocked.headers.get("Set-Cookie").split(";")[0] };
      const passwordBefore = sqlite.query("SELECT password_hash, password_encrypted FROM memo_shares WHERE token = ?").get(sourceToken);
      for (const [payload, expected] of [
        [{ showUpdatedAt: true, showBranding: true }, { showUpdatedAt: true, showBranding: true }],
        [{ showUpdatedAt: false }, { showUpdatedAt: false, showBranding: true }],
        [{ showBranding: false }, { showUpdatedAt: false, showBranding: false }],
        [{ showUpdatedAt: true }, { showUpdatedAt: true, showBranding: false }],
      ]) {
        const response = await patch(payload);
        expect(response.status).toBe(200);
        expect((await response.json()).share).toMatchObject({ ...expected, password: protectedShare.password });
        expect((await (await app.request(path, {}, environment)).json()).share).toMatchObject(expected);
        const listed = (await (await app.request("/api/v1/memo-shares", {}, environment)).json()).shares;
        expect(listed.find((share) => share.memoId === "memo_source")).toMatchObject(expected);
        const publicResponse = await app.request(`/api/public/shares/${sourceToken}`, { headers }, environment);
        expect(publicResponse.status).toBe(200);
        expect((await publicResponse.json()).share).toMatchObject(expected);
        expect(sqlite.query("SELECT show_updated_at, show_branding FROM memo_shares WHERE token = ?").get(sourceToken))
          .toEqual({ show_updated_at: Number(expected.showUpdatedAt), show_branding: Number(expected.showBranding) });
        expect(sqlite.query("SELECT password_hash, password_encrypted FROM memo_shares WHERE token = ?").get(sourceToken))
          .toEqual(passwordBefore);
      }
    } finally {
      sqlite.close();
    }
  });

  test("reads existing fonts and new catalog choices through the same stored preference", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query("INSERT INTO users (id, username, password_hash, note_body_font) VALUES (?, ?, ?, ?)")
      .run("usr_font_catalog", "font-catalog", "hash", "wenkai");
    sqlite.query("UPDATE memo_shares SET created_by = ? WHERE id = ?").run("usr_font_catalog", "share_source");
    const app = new Hono();
    registerPublicShareRoutes(app);
    for (const id of ["wenkai-screen", ...FONT_IDS, "neo-zhi-song", "source-serif"]) {
      sqlite.query("UPDATE users SET note_body_font = ? WHERE id = ?").run(id, "usr_font_catalog");
      const response = await app.request(`/api/public/shares/${sourceToken}`, {}, environment);
      expect(response.status).toBe(200);
      expect((await response.json()).share.bodyFont).toBe(id);
    }
    sqlite.close();
  });

  test("publishes the author's built-in note font and ignores anything else", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query("INSERT INTO users (id, username, password_hash, note_body_font) VALUES (?, ?, ?, ?)")
      .run("usr_author", "author", "hash", "wenkai");
    sqlite.query("UPDATE memo_shares SET created_by = ? WHERE id = ?")
      .run("usr_author", "share_source");
    const app = new Hono();
    registerPublicShareRoutes(app);

    const published = await app.request(`/api/public/shares/${sourceToken}`, {}, environment);
    expect(published.status).toBe(200);
    expect((await published.json()).share.bodyFont).toBe("wenkai");

    sqlite.query("UPDATE users SET note_body_font = ? WHERE id = ?").run("Comic Sans", "usr_author");
    const ignored = await app.request(`/api/public/shares/${sourceToken}`, {}, environment);
    expect((await ignored.json()).share.bodyFont).toBeNull();
    sqlite.close();
  });

  test("publishes account prose with the public share", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)")
      .run("usr_author", "author", "hash");
    sqlite.query("UPDATE memo_shares SET created_by = ? WHERE id = ?")
      .run("usr_author", "share_source");
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("auth", { kind: "user", actorType: "user", actorId: "usr_author", username: "author", displayName: null, scopes: [], workspaceId: "ws_member", role: "owner" });
      await next();
    });
    registerMemoShareRoutes(app);
    registerPublicShareRoutes(app);

    const before = await app.request(`/api/public/shares/${sourceToken}`, {}, environment);
    expect((await before.json()).share.prose).toEqual({
      fontSize: 16,
      lineHeight: 1.65,
      palette: "native",
      customCss: "",
      customColors: null,
    });

    const saved = await app.request("/api/v1/me/note-prose", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fontSize: 18,
        lineHeight: 2,
        palette: "clay",
        customCss: "p { color: red; font-size: 40px; line-height: 3; background: url(https://evil.test/a.png); }",
      }),
    }, environment);
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.fontSize).toBe(18);
    expect(body.lineHeight).toBe(2);
    expect(body.palette).toBe("clay");
    expect(body.customCss).toContain("color: red");
    expect(body.customCss).not.toContain("font-size");
    expect(body.customCss).not.toContain("line-height");
    expect(body.customCss).not.toContain("url(");

    const published = await (await app.request(`/api/public/shares/${sourceToken}`, {}, environment)).json();
    expect(published.share.prose).toMatchObject({
      fontSize: 18,
      lineHeight: 2,
      palette: "clay",
    });
    expect(published.share.prose.customCss).not.toContain("font-size");
    sqlite.close();
  });

  test("saves a signed-in user's published note font", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)")
      .run("usr_author", "author", "hash");
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("auth", { kind: "user", actorType: "user", actorId: "usr_author", username: "author", displayName: null, scopes: [], workspaceId: "ws_member", role: "owner" });
      await next();
    });
    registerMemoShareRoutes(app);

    const response = await app.request("/api/v1/me/note-body-font", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bodyFont: "source-han-serif" }),
    }, environment);
    expect(response.status).toBe(200);
    expect(sqlite.query("SELECT note_body_font FROM users WHERE id = ?").get("usr_author").note_body_font).toBe("source-han-serif");

    for (const id of FONT_IDS) {
      const response = await app.request("/api/v1/me/note-body-font", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ bodyFont: id }),
      }, environment);
      expect(response.status).toBe(200);
      expect(sqlite.query("SELECT note_body_font FROM users WHERE id = ?").get("usr_author").note_body_font).toBe(id);
    }

    const cleared = await app.request("/api/v1/me/note-body-font", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bodyFont: null }),
    }, environment);
    expect(cleared.status).toBe(200);
    expect(sqlite.query("SELECT note_body_font FROM users WHERE id = ?").get("usr_author").note_body_font).toBeNull();
    sqlite.close();
  });

  test("serves shared PDF byte ranges with public-share cache controls", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query(
      `INSERT INTO resources (id, memo_id, object_key, kind, mime_type, filename, byte_size)
       VALUES (?, ?, ?, 'attachment', 'application/pdf', '共享报告.pdf', 10)`,
    ).run("res_shared", "memo_source", "shared-key");
    let requestedOptions;
    environment.storage.resources = {
      get: async (_key, options) => {
        requestedOptions = options;
        return {
          body: new Blob([new TextEncoder().encode("2345")]).stream(),
          size: 10,
          range: { offset: 2, length: 4 },
          writeHttpMetadata: () => {},
        };
      },
    };
    const app = new Hono();
    registerPublicShareRoutes(app);

    const response = await app.request(
      `/api/public/shares/${sourceToken}/resources/res_shared/blob`,
      { headers: { Range: "bytes=2-5" } },
      environment,
    );

    expect(requestedOptions).toEqual({ range: { offset: 2, length: 4 } });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(response.headers.get("Content-Disposition")).toBe(
      "inline; filename=\"download.pdf\"; filename*=UTF-8''%E5%85%B1%E4%BA%AB%E6%8A%A5%E5%91%8A.pdf",
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("2345");
    sqlite.close();
  });

  test("serves filename-detected shared audio inline", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query(
      `INSERT INTO resources (id, memo_id, object_key, kind, mime_type, filename, byte_size)
       VALUES (?, ?, ?, 'attachment', 'application/octet-stream', 'recording.mp3', 10)`,
    ).run("res_audio", "memo_source", "audio-key");
    environment.storage.resources = {
      get: async () => ({
        body: new Blob([new Uint8Array(10)]).stream(),
        size: 10,
        writeHttpMetadata: () => {},
      }),
    };
    const app = new Hono();
    registerPublicShareRoutes(app);

    const response = await app.request(
      `/api/public/shares/${sourceToken}/resources/res_audio/blob`,
      {},
      environment,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Disposition")).toBe(
      "inline; filename=\"recording.mp3\"; filename*=UTF-8''recording.mp3",
    );
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    sqlite.close();
  });

  test("serves filename-detected shared video inline", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query(
      `INSERT INTO resources (id, memo_id, object_key, kind, mime_type, filename, byte_size)
       VALUES (?, ?, ?, 'attachment', 'application/octet-stream', 'walkthrough.webm', 10)`,
    ).run("res_video", "memo_source", "video-key");
    environment.storage.resources = {
      get: async () => ({
        body: new Blob([new Uint8Array(10)]).stream(),
        size: 10,
        writeHttpMetadata: () => {},
      }),
    };
    const app = new Hono();
    registerPublicShareRoutes(app);

    const response = await app.request(
      `/api/public/shares/${sourceToken}/resources/res_video/blob`,
      {},
      environment,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("video/webm");
    expect(response.headers.get("Content-Disposition")).toBe(
      "inline; filename=\"walkthrough.webm\"; filename*=UTF-8''walkthrough.webm",
    );
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    sqlite.close();
  });
});

const memberAuth = {
  kind: "user",
  actorType: "user",
  actorId: "user_member",
  username: "member",
  displayName: "Member",
  scopes: [],
  workspaceId: "ws_member",
  role: "member",
};

const createShareApp = () => {
  const app = new Hono();
  app.use("/api/v1/*", async (c, next) => {
    c.set("auth", memberAuth);
    await next();
  });
  registerPublicShareRoutes(app);
  registerMemoShareRoutes(app);
  return app;
};

const readCookieValue = (response, name) => {
  const header = response.headers.get("Set-Cookie") ?? "";
  const prefix = `${name}=`;
  const part = header.split(";").find((item) => item.trim().startsWith(prefix));
  return part ? part.trim().slice(prefix.length) : "";
};

describe("memo share management", () => {
  test("revocation retries succeed and keep the old link inaccessible", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    const path = "/api/v1/memos/memo_source/share";
    expect((await app.request(`/api/public/shares/${sourceToken}`, {}, environment)).status).toBe(200);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await app.request(path, { method: "DELETE" }, environment);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect((await (await app.request(path, {}, environment)).json()).share).toBeNull();
      expect((await app.request(`/api/public/shares/${sourceToken}`, {}, environment)).status).toBe(404);
    }
    expect((await app.request(`/api/public/shares/${targetToken}`, {}, environment)).status).toBe(200);
    const unauthenticated = new Hono();
    registerMemoShareRoutes(unauthenticated);
    expect((await unauthenticated.request(path, { method: "DELETE" }, environment)).status).toBe(403);
    sqlite.close();
  });

  test("lists only live shares from the signed-in workspace without exposing passwords", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)").run("ws_other", "Other workspace");
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)").run("nb_other", "ws_other", "Private");
    sqlite.query("INSERT INTO memos (id, workspace_id, notebook_id, title) VALUES (?, ?, ?, ?)").run("memo_other", "ws_other", "nb_other", "Other note");
    sqlite.query("INSERT INTO memo_shares (id, memo_id, workspace_id, token) VALUES (?, ?, ?, ?)").run("share_other", "memo_other", "ws_other", "o".repeat(43));
    sqlite.query("UPDATE memo_shares SET password_hash = ? WHERE memo_id = ?").run("private-hash", "memo_source");
    sqlite.query("UPDATE memos SET is_deleted = 1 WHERE id = ?").run("memo_target");

    const response = await createShareApp(environment).request("/api/v1/memo-shares", {}, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.nextOffset).toBeNull();
    expect(body.shares).toEqual([expect.objectContaining({
      memoId: "memo_source",
      memoTitle: "Source",
      notebookId: "nb_member",
      notebookName: "Inbox",
      passwordProtected: true,
    })]);
    expect(JSON.stringify(body)).not.toContain("private-hash");
    expect(JSON.stringify(body)).not.toContain("memo_other");
    sqlite.close();
  });

  test("paginates shares and requires an interactive user session", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    const first = await app.request("/api/v1/memo-shares?limit=1", {}, environment);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.shares).toHaveLength(1);
    expect(firstBody.nextOffset).toBe(1);
    const second = await app.request(`/api/v1/memo-shares?limit=1&offset=${firstBody.nextOffset}`, {}, environment);
    const secondBody = await second.json();
    expect(secondBody.shares).toHaveLength(1);
    expect(secondBody.shares[0].memoId).not.toBe(firstBody.shares[0].memoId);
    expect(secondBody.nextOffset).toBeNull();

    const unauthenticated = new Hono();
    registerMemoShareRoutes(unauthenticated);
    const denied = await unauthenticated.request("/api/v1/memo-shares", {}, environment);
    expect(denied.status).toBe(403);
    sqlite.close();
  });
});

describe("password-protected memo shares", () => {
  test("accepts an owner-chosen password, trims it, and keeps the password gate", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    const path = "/api/v1/memos/memo_source/share";

    const enabled = await app.request(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "  custom-pass  " }),
    }, environment);
    expect(enabled.status).toBe(200);
    expect((await enabled.json()).share).toMatchObject({ passwordProtected: true, password: "custom-pass" });
    const stored = sqlite.query("SELECT password_hash, password_encrypted FROM memo_shares WHERE memo_id = ?").get("memo_source");
    expect(stored.password_hash).not.toContain("custom-pass");
    expect(stored.password_encrypted).not.toContain("custom-pass");

    expect((await app.request(`/api/public/shares/${sourceToken}`, {}, environment)).status).toBe(403);
    const unlocked = await app.request(`/api/public/shares/${sourceToken}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "custom-pass" }),
    }, environment);
    expect(unlocked.status).toBe(200);

    const rotated = await app.request(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passwordProtected: true, password: "new-pass" }),
    }, environment);
    expect((await rotated.json()).share.password).toBe("new-pass");
    sqlite.close();
  });

  test("rejects custom passwords outside the supported length", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    const path = "/api/v1/memos/memo_source/share";
    for (const password of ["   ", "abc", "x".repeat(65)]) {
      const response = await app.request(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }, environment);
      expect(response.status).toBe(400);
    }
    expect((await (await app.request(path, {}, environment)).json()).share.passwordProtected).toBe(false);
    sqlite.close();
  });

  test("keeps existing shares public until a password is enabled", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);

    const publicResponse = await app.request(`/api/public/shares/${sourceToken}`, {}, environment);
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toMatchObject({ share: { title: "Source" } });

    const enabled = await app.request(`/api/v1/memos/memo_source/share`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passwordProtected: true }),
    }, environment);
    expect(enabled.status).toBe(200);
    const enabledBody = await enabled.json();
    expect(enabledBody.share.passwordProtected).toBe(true);
    expect(enabledBody.share.password).toHaveLength(8);
    expect(enabledBody.share).not.toHaveProperty("passwordHash");

    const locked = await app.request(`/api/public/shares/${sourceToken}`, {}, environment);
    expect(locked.status).toBe(403);
    expect(await locked.json()).toEqual({
      error: { code: "share_password_required", message: "Password required to view this shared note" },
    });
    sqlite.close();
  });

  test("unlocks with the generated password and then serves the note and attachments", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const password = "testPass";
    sqlite.query("UPDATE memo_shares SET password_hash = ? WHERE token = ?")
      .run(await hashPassword(password), sourceToken);
    sqlite.query(
      `INSERT INTO resources (id, memo_id, object_key, kind, mime_type, filename, byte_size)
       VALUES (?, ?, ?, 'attachment', 'application/pdf', 'shared.pdf', 10)`,
    ).run("res_locked", "memo_source", "locked-key");
    environment.storage.resources = {
      get: async () => ({
        body: new Blob([new Uint8Array(10)]).stream(),
        size: 10,
        writeHttpMetadata: () => {},
      }),
    };
    const app = createShareApp(environment);

    const deniedResource = await app.request(
      `/api/public/shares/${sourceToken}/resources/res_locked/blob`,
      {},
      environment,
    );
    expect(deniedResource.status).toBe(403);

    const wrong = await app.request(`/api/public/shares/${sourceToken}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    }, environment);
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).error.code).toBe("share_password_invalid");

    const unlocked = await app.request(`/api/public/shares/${sourceToken}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }, environment);
    expect(unlocked.status).toBe(200);
    const cookie = readCookieValue(unlocked, "ee_share");
    expect(cookie).toBeTruthy();

    const headers = { Cookie: `ee_share=${cookie}` };
    const share = await app.request(`/api/public/shares/${sourceToken}`, { headers }, environment);
    expect(share.status).toBe(200);
    expect(await share.json()).toMatchObject({ share: { title: "Source" } });

    const resource = await app.request(
      `/api/public/shares/${sourceToken}/resources/res_locked/blob`,
      { headers },
      environment,
    );
    expect(resource.status).toBe(200);
    sqlite.close();
  });

  test("clearing the password ignores a supplied value and makes the existing link public again", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query("UPDATE memo_shares SET password_hash = ? WHERE token = ?")
      .run(await hashPassword("secretPwd"), sourceToken);
    const app = createShareApp(environment);

    const cleared = await app.request(`/api/v1/memos/memo_source/share`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passwordProtected: false, password: "ignored-value" }),
    }, environment);
    expect(cleared.status).toBe(200);
    const clearedBody = await cleared.json();
    expect(clearedBody.share).toMatchObject({ passwordProtected: false });
    expect(clearedBody.share.password).toBeUndefined();

    const publicResponse = await app.request(`/api/public/shares/${sourceToken}`, {}, environment);
    expect(publicResponse.status).toBe(200);
    sqlite.close();
  });
});


test("workspace login cannot bypass a memo's password or attachment gate", async () => {
  const { createHash } = await import("node:crypto");
  const { sqlite, environment } = createDatabaseEnvironment();
  try {
    const app = createShareApp(environment);
    const password = "testPass";
    sqlite.query("UPDATE memo_shares SET password_hash = ? WHERE token = ?").run(await hashPassword(password), sourceToken);
    sqlite.query("INSERT INTO users (id, username, password_hash) VALUES ('owner', 'owner', 'unused')").run();
    sqlite.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws_member', 'owner', 'owner')").run();
    sqlite.query("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, 'owner', ?, ?)")
      .run("session_owner", createHash("sha256").update("owner-session").digest("hex"), new Date(Date.now()+3600000).toISOString());
    sqlite.query("INSERT INTO resources (id, memo_id, object_key, kind, byte_size) VALUES ('res_owner', 'memo_source', 'owner-key', 'image', 10)").run();
    let blobReads = 0;
    environment.storage.resources = { get: async () => {
      blobReads++;
      return { body: new Blob([new Uint8Array(10)]).stream(), size: 10, writeHttpMetadata: () => {} };
    } };
    const base = `/api/public/shares/${sourceToken}`;
    for (const path of [base, `${base}/resources/res_owner/blob`]) {
      for (const headers of [{ Cookie: "edgeever_session=owner-session" }, { Authorization: "Bearer owner-session" }]) {
        const response = await app.request(path, { headers }, environment);
        expect(response.status).toBe(403);
        expect((await response.json()).error.code).toBe("share_password_required");
      }
    }
    expect(blobReads).toBe(0);
    const unlocked = await app.request(`${base}/unlock`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: "edgeever_session=owner-session" },
      body: JSON.stringify({ password }),
    }, environment);
    expect(unlocked.status).toBe(200);
    const cookie = readCookieValue(unlocked, "ee_share");
    for (const path of [base, `${base}/resources/res_owner/blob`]) {
      expect((await app.request(path, { headers: { Cookie: `edgeever_session=owner-session; ee_share=${cookie}` } }, environment)).status).toBe(200);
    }
  } finally {
    sqlite.close();
  }
});

describe("memo share password recovery", () => {
  test("returns encrypted-at-rest passwords only through authenticated single-share reads", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    const path = "/api/v1/memos/memo_source/share";
    const patch = (enabled) => app.request(path, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passwordProtected: enabled }),
    }, environment);
    const share = (await (await patch(true)).json()).share;
    expect(sqlite.query("SELECT password_encrypted FROM memo_shares WHERE memo_id = 'memo_source'").get().password_encrypted).not.toContain(share.password);
    const fresh = await app.request(path, {}, environment);
    expect(fresh.headers.get("cache-control")).toBe("private, no-store");
    expect((await fresh.json()).share.password).toBe(share.password);
    const listed = await app.request("/api/v1/memo-shares", {}, environment);
    for (const entry of (await listed.json()).shares) {
      expect(entry.password).toBeUndefined();
      expect(entry.password_encrypted).toBeUndefined();
    }
    const publicApp = new Hono();
    registerMemoShareRoutes(publicApp);
    expect((await publicApp.request(path, {}, environment)).status).toBe(403);
    await patch(false);
    expect(sqlite.query("SELECT password_encrypted FROM memo_shares WHERE memo_id = 'memo_source'").get().password_encrypted).toBeNull();
    expect((await (await app.request(path, {}, environment)).json()).share.password).toBeUndefined();
    sqlite.close();
  });
});

describe("one-step memo sharing", () => {
  test("concurrent creation and retries reuse one link; reopening preserves its password", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    const path = "/api/v1/memos/memo_private/share";
    const responses = await Promise.all([
      app.request(path, { method: "POST" }, environment),
      app.request(path, { method: "POST" }, environment),
    ]);
    const shares = await Promise.all(responses.map(async (response) => (await response.json()).share));
    expect(shares[0].token).toBe(shares[1].token);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memo_shares WHERE memo_id = 'memo_private'").get().count).toBe(1);
    const protectedShare = (await (await app.request(path, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passwordProtected: true }),
    }, environment)).json()).share;
    const reopened = (await (await app.request(path, { method: "POST" }, environment)).json()).share;
    expect(reopened.token).toBe(protectedShare.token);
    expect(reopened.password).toBe(protectedShare.password);
    expect(reopened.passwordProtected).toBe(true);
    await app.request(path, { method: "DELETE" }, environment);
    expect((await (await app.request(path, {}, environment)).json()).share).toBeNull();
    sqlite.close();
  });
});


test("public SVG previews use the same sandbox and preserve the original", async () => {
  const { sqlite, environment } = createDatabaseEnvironment();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><script>alert(1)</script></svg>';
  sqlite.query(`INSERT INTO resources (id, memo_id, object_key, kind, mime_type, filename, byte_size)
    VALUES (?, ?, ?, 'image', 'image/svg+xml', 'diagram.svg', ?)`)
    .run("res_svg", "memo_source", "svg-key", svg.length);
  environment.storage.resources = { get: async () => ({
    body: new Blob([svg]).stream(), writeHttpMetadata: () => {},
  }) };
  const app = new Hono();
  registerPublicShareRoutes(app);
  const response = await app.request(`/api/public/shares/${sourceToken}/resources/res_svg/blob`, {}, environment);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/svg+xml");
  expect(response.headers.get("content-disposition")).toStartWith("inline;");
  expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox");
  expect(await response.text()).toBe(svg);
  sqlite.close();
});

describe("custom memo share addresses", () => {
  const patchShare = (app, environment, memoId, body) => app.request(`/api/v1/memos/${memoId}/share`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, environment);

  test("serves the note at the custom address while the token link keeps working", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    const updated = await patchShare(app, environment, "memo_source", { slug: "  My-Notes-2026 " });
    expect(updated.status).toBe(200);
    expect((await updated.json()).share).toMatchObject({ token: sourceToken, slug: "my-notes-2026", passwordProtected: false });

    for (const segment of ["my-notes-2026", "My-Notes-2026", sourceToken]) {
      const response = await app.request(`/api/public/shares/${segment}`, {}, environment);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ share: { title: "Source" } });
    }
    expect((await (await app.request("/api/v1/memo-shares", {}, environment)).json()).shares)
      .toContainEqual(expect.objectContaining({ memoId: "memo_source", slug: "my-notes-2026" }));
    sqlite.close();
  });

  test("links between public notes prefer the custom address", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    expect((await patchShare(app, environment, "memo_target", { slug: "target-note" })).status).toBe(200);
    const response = await app.request(`/api/public/shares/${sourceToken}`, {}, environment);
    expect((await response.json()).share.memoShareTokens).toEqual({ memo_target: "target-note" });
    sqlite.close();
  });

  test("rejects invalid, reserved and already used addresses", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    for (const slug of ["ab", "-lead", "trail-", "double--dash", "spa ce", "ünï", "x".repeat(41), "notebook", ""]) {
      expect((await patchShare(app, environment, "memo_source", { slug })).status).toBe(400);
    }
    expect((await patchShare(app, environment, "memo_source", { slug: "taken" })).status).toBe(200);
    const conflict = await patchShare(app, environment, "memo_target", { slug: "TAKEN" });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("share_slug_taken");
    expect((await patchShare(app, environment, "memo_source", { slug: "taken" })).status).toBe(200);
    expect((await patchShare(app, environment, "memo_source", {})).status).toBe(400);
    sqlite.close();
  });

  test("clearing or changing the address retires the old one immediately", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    await patchShare(app, environment, "memo_source", { slug: "first-name" });
    await patchShare(app, environment, "memo_source", { slug: "second-name" });
    expect((await app.request("/api/public/shares/first-name", {}, environment)).status).toBe(404);
    expect((await app.request("/api/public/shares/second-name", {}, environment)).status).toBe(200);

    const cleared = await patchShare(app, environment, "memo_source", { slug: null });
    expect((await cleared.json()).share.slug).toBeNull();
    expect((await app.request("/api/public/shares/second-name", {}, environment)).status).toBe(404);
    expect((await app.request(`/api/public/shares/${sourceToken}`, {}, environment)).status).toBe(200);

    await patchShare(app, environment, "memo_target", { slug: "second-name" });
    await app.request("/api/v1/memos/memo_target/share", { method: "DELETE" }, environment);
    expect((await app.request("/api/public/shares/second-name", {}, environment)).status).toBe(404);
    sqlite.close();
  });

  test("keeps a released address bound to its workspace so other tenants cannot take over old links", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)").run("ws_other", "Other workspace");
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)").run("nb_other", "ws_other", "Other");
    sqlite.query("INSERT INTO memos (id, workspace_id, notebook_id, title) VALUES (?, ?, ?, ?)").run("memo_other", "ws_other", "nb_other", "Other");
    sqlite.query("INSERT INTO memo_shares (id, memo_id, workspace_id, token) VALUES (?, ?, ?, ?)").run("share_other", "memo_other", "ws_other", "o".repeat(43));
    const app = createShareApp(environment);
    const otherApp = new Hono();
    otherApp.use("/api/v1/*", async (c, next) => {
      c.set("auth", { ...memberAuth, actorId: "user_other", workspaceId: "ws_other" });
      await next();
    });
    registerMemoShareRoutes(otherApp);

    expect((await patchShare(app, environment, "memo_source", { slug: "team-handbook" })).status).toBe(200);
    expect((await patchShare(app, environment, "memo_source", { slug: null })).status).toBe(200);
    await app.request("/api/v1/memos/memo_source/share", { method: "DELETE" }, environment);

    const takeover = await patchShare(otherApp, environment, "memo_other", { slug: "team-handbook" });
    expect(takeover.status).toBe(409);
    expect((await takeover.json()).error.code).toBe("share_slug_taken");
    expect((await app.request("/api/public/shares/team-handbook", {}, environment)).status).toBe(404);
    expect((await patchShare(app, environment, "memo_target", { slug: "team-handbook" })).status).toBe(200);
    sqlite.close();
  });

  test("keeps the password gate and scopes the unlock grant to the custom address", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query("INSERT INTO resources (id, memo_id, object_key, kind, byte_size) VALUES ('res_slug', 'memo_source', 'slug-key', 'image', 10)").run();
    environment.storage.resources = {
      get: async () => ({ body: new Blob([new Uint8Array(10)]).stream(), size: 10, writeHttpMetadata: () => {} }),
    };
    const app = createShareApp(environment);
    const protectedShare = (await (await patchShare(app, environment, "memo_source", { passwordProtected: true })).json()).share;
    const renamed = (await (await patchShare(app, environment, "memo_source", { slug: "locked-note" })).json()).share;
    expect(renamed).toMatchObject({ slug: "locked-note", passwordProtected: true, password: protectedShare.password });

    const base = "/api/public/shares/locked-note";
    expect((await app.request(base, {}, environment)).status).toBe(403);
    expect((await app.request(`${base}/resources/res_slug/blob`, {}, environment)).status).toBe(403);
    const unlocked = await app.request(`${base}/unlock`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: protectedShare.password }),
    }, environment);
    expect(unlocked.status).toBe(200);
    expect(unlocked.headers.get("Set-Cookie")).toContain(`Path=${base}`);
    const headers = { Cookie: `ee_share=${readCookieValue(unlocked, "ee_share")}` };
    expect((await app.request(base, { headers }, environment)).status).toBe(200);
    expect((await app.request(`${base}/resources/res_slug/blob`, { headers }, environment)).status).toBe(200);
    sqlite.close();
  });
});

describe("memo share expiry and views", () => {
  const past = "2020-01-01T00:00:00.000Z";
  const json = (body) => ({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const shareRow = (sqlite, token = sourceToken) =>
    sqlite.query("SELECT expires_at, view_count, last_viewed_at, updated_at, password_hash FROM memo_shares WHERE token = ?").get(token);

  test("adds the columns to existing shares without changing them", async () => {
    const sqlite = new Database(":memory:");
    try {
      for (const migration of globSync("migrations/*.sql").sort()) {
        if (migration.endsWith("0087_memo_share_expiry_views.sql")) continue;
        sqlite.exec(readFileSync(migration, "utf8"));
      }
      sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES ('ws_old', 'Old', 1)").run();
      sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES ('nb_old', 'ws_old', 'Inbox')").run();
      sqlite.query("INSERT INTO memos (id, workspace_id, notebook_id, title) VALUES ('memo_old', 'ws_old', 'nb_old', 'Old')").run();
      sqlite.query("INSERT INTO memo_shares (id, memo_id, workspace_id, token) VALUES ('share_old', 'memo_old', 'ws_old', ?)").run(sourceToken);
      const before = sqlite.query("SELECT * FROM memo_shares").all();
      sqlite.exec(readFileSync("migrations/0087_memo_share_expiry_views.sql", "utf8"));
      expect(sqlite.prepare("SELECT * FROM memo_shares").all()).toEqual(
        before.map((row) => ({ ...row, expires_at: null, view_count: 0, last_viewed_at: null })),
      );
    } finally {
      sqlite.close();
    }
  });

  test("sets, normalizes, extends and removes the expiry without touching the password", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    const path = "/api/v1/memos/memo_source/share";
    try {
      await app.request(path, json({ passwordProtected: true, password: "keep-this" }), environment);
      const passwordHash = shareRow(sqlite).password_hash;
      expect(passwordHash).toBeTruthy();

      const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const offset = future.toISOString().replace("Z", "+00:00");
      const set = await app.request(path, json({ expiresAt: offset }), environment);
      expect(set.status).toBe(200);
      expect((await set.json()).share).toMatchObject({ expiresAt: future.toISOString(), expired: false, passwordProtected: true });
      expect(shareRow(sqlite)).toMatchObject({ expires_at: future.toISOString(), password_hash: passwordHash });

      const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      expect((await (await app.request(path, json({ expiresAt: later }), environment)).json()).share.expiresAt).toBe(later);

      const cleared = await app.request(path, json({ expiresAt: null }), environment);
      expect((await cleared.json()).share).toMatchObject({ expiresAt: null, expired: false, passwordProtected: true });
      expect(shareRow(sqlite)).toMatchObject({ expires_at: null, password_hash: passwordHash });

      // Older clients keep sending only the password field.
      const legacy = await app.request(path, json({ passwordProtected: false }), environment);
      expect(legacy.status).toBe(200);
      expect((await legacy.json()).share).toMatchObject({ passwordProtected: false, expiresAt: null });
    } finally {
      sqlite.close();
    }
  });

  test("rejects past and malformed expiry values", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const app = createShareApp(environment);
    const path = "/api/v1/memos/memo_source/share";
    try {
      const pastResponse = await app.request(path, json({ expiresAt: past }), environment);
      expect(pastResponse.status).toBe(400);
      expect((await pastResponse.json()).error.code).toBe("share_expiry_invalid");
      expect((await app.request(path, json({ expiresAt: "tomorrow" }), environment)).status).toBe(400);
      expect((await app.request(path, json({}), environment)).status).toBe(400);
      expect(shareRow(sqlite).expires_at).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  test("an expired link answers 410 on content, unlock and resources and reveals nothing", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query("UPDATE memo_shares SET expires_at = ?, password_hash = ? WHERE token = ?")
      .run(past, await hashPassword("secret-pass"), sourceToken);
    sqlite.query(`INSERT INTO resources (id, memo_id, object_key, kind, mime_type, filename, byte_size)
      VALUES ('res_expired', 'memo_source', 'expired-key', 'attachment', 'application/pdf', 'a.pdf', 10)`).run();
    environment.storage.resources = { get: async () => ({ body: new Blob([new Uint8Array(10)]).stream(), size: 10, writeHttpMetadata: () => {} }) };
    const app = createShareApp(environment);
    try {
      const content = await app.request(`/api/public/shares/${sourceToken}`, {}, environment);
      expect(content.status).toBe(410);
      const body = await content.json();
      expect(body.error.code).toBe("share_expired");
      expect(JSON.stringify(body)).not.toContain("Source");

      const unlock = await app.request(`/api/public/shares/${sourceToken}/unlock`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "secret-pass" }),
      }, environment);
      expect(unlock.status).toBe(410);
      expect(unlock.headers.get("Set-Cookie")).toBeNull();

      const resource = await app.request(`/api/public/shares/${sourceToken}/resources/res_expired/blob`, {}, environment);
      expect(resource.status).toBe(410);

      expect((await app.request(`/api/public/shares/${"x".repeat(43)}`, {}, environment)).status).toBe(404);
      expect(shareRow(sqlite)).toMatchObject({ view_count: 0, last_viewed_at: null });
    } finally {
      sqlite.close();
    }
  });

  test("an expired linked note is not linked from another shared note", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query("UPDATE memo_shares SET expires_at = ? WHERE token = ?").run(past, targetToken);
    const app = createShareApp(environment);
    try {
      const response = await app.request(`/api/public/shares/${sourceToken}`, {}, environment);
      expect(response.status).toBe(200);
      expect((await response.json()).share.memoShareTokens).toEqual({});
    } finally {
      sqlite.close();
    }
  });

  test("the owner still sees an expired share and the dialog does not create a new one", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    sqlite.query("UPDATE memo_shares SET expires_at = ? WHERE token = ?").run(past, sourceToken);
    const app = createShareApp(environment);
    try {
      const read = await (await app.request("/api/v1/memos/memo_source/share", {}, environment)).json();
      expect(read.share).toMatchObject({ token: sourceToken, expiresAt: past, expired: true });
      const created = await app.request("/api/v1/memos/memo_source/share", { method: "POST" }, environment);
      expect(created.status).toBe(200);
      expect((await created.json()).share).toMatchObject({ token: sourceToken, expired: true });
      const list = await (await app.request("/api/v1/memo-shares", {}, environment)).json();
      expect(list.shares.find((share) => share.memoId === "memo_source")).toMatchObject({ expired: true, viewCount: 0 });
    } finally {
      sqlite.close();
    }
  });

  test("counts served content only, and views do not reorder the share list", async () => {
    const { sqlite, environment } = createDatabaseEnvironment();
    const password = "count-pass";
    sqlite.query("UPDATE memo_shares SET password_hash = ?, updated_at = '2026-01-01T00:00:00.000Z' WHERE token = ?")
      .run(await hashPassword(password), sourceToken);
    sqlite.query(`INSERT INTO resources (id, memo_id, object_key, kind, mime_type, filename, byte_size)
      VALUES ('res_count', 'memo_source', 'count-key', 'attachment', 'application/pdf', 'a.pdf', 10)`).run();
    environment.storage.resources = { get: async () => ({ body: new Blob([new Uint8Array(10)]).stream(), size: 10, writeHttpMetadata: () => {} }) };
    const app = createShareApp(environment);
    const unlock = (value) => app.request(`/api/public/shares/${sourceToken}/unlock`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: value }),
    }, environment);
    try {
      expect((await app.request(`/api/public/shares/${sourceToken}`, {}, environment)).status).toBe(403);
      expect((await unlock("wrong-password")).status).toBe(403);
      expect(shareRow(sqlite).view_count).toBe(0);

      const cookie = readCookieValue(await unlock(password), "ee_share");
      expect(shareRow(sqlite).view_count).toBe(0);
      const headers = { Cookie: `ee_share=${cookie}` };
      expect((await app.request(`/api/public/shares/${sourceToken}/resources/res_count/blob`, { headers }, environment)).status).toBe(200);
      expect(shareRow(sqlite).view_count).toBe(0);

      expect((await app.request(`/api/public/shares/${sourceToken}`, { headers }, environment)).status).toBe(200);
      expect((await app.request(`/api/public/shares/${sourceToken}`, { headers }, environment)).status).toBe(200);
      const row = shareRow(sqlite);
      expect(row.view_count).toBe(2);
      expect(row.last_viewed_at).toBeTruthy();
      expect(row.updated_at).toBe("2026-01-01T00:00:00.000Z");

      const read = await (await app.request("/api/v1/memos/memo_source/share", {}, environment)).json();
      expect(read.share).toMatchObject({ viewCount: 2, lastViewedAt: row.last_viewed_at });
    } finally {
      sqlite.close();
    }
  });
});
