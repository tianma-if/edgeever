import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { registerPublicShareRoutes } from "./share-routes.ts";

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

const createDatabaseEnvironment = () => {
  const sqlite = new Database(":memory:");
  for (const migration of globSync("migrations/*.sql").sort()) {
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
    environment: { storage: { db: new SqliteD1Database(sqlite), resources: {} } },
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
      share: { memoShareTokens: { memo_target: targetToken } },
    });
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
});
