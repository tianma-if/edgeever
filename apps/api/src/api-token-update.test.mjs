import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { registerApiTokenRoutes } from "./api-token-routes.ts";
import { sha256 } from "./hash-utils.ts";

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

const userAuth = {
  kind: "user",
  actorType: "user",
  actorId: "usr_owner",
  username: "owner",
  displayName: "Owner",
  scopes: [],
  workspaceId: "ws_owner",
  role: "owner",
};

const createFixture = (auth = userAuth) => {
  const sqlite = new Database(":memory:");
  for (const migration of globSync("migrations/*.sql").sort()) {
    sqlite.exec(readFileSync(migration, "utf8"));
  }
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)")
    .run("ws_owner", "Owner workspace");
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES ('nb_a', 'ws_owner', 'A')").run();
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES ('nb_b', 'ws_owner', 'B')").run();

  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", auth);
    await next();
  });
  registerApiTokenRoutes(app, { sha256 });
  const environment = { storage: { db: new SqliteD1Database(sqlite), resources: {} } };
  return { sqlite, app, environment };
};

const post = (app, environment, body) => app.request("/api/v1/api-tokens", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}, environment);

const patch = (app, environment, id, body) => app.request(`/api/v1/api-tokens/${id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}, environment);

describe("API token notebook access management", () => {
  test("creates tokens with notebook grants and updates them in place", async () => {
    const { app, environment } = createFixture();

    const created = await post(app, environment, {
      name: "Scoped",
      scopes: ["read:memos", "write:memos"],
      notebookAccess: [{ notebookId: "nb_a", read: true, write: false }],
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.apiToken.notebookAccess).toEqual([
      { notebookId: "nb_a", read: true, write: false },
    ]);
    const tokenValue = createdBody.token;
    expect(tokenValue).toStartWith("eev_");

    // The same token value keeps working after a permission change.
    const updated = await patch(app, environment, createdBody.apiToken.id, {
      scopes: ["read:memos", "write:memos", "read:notebooks"],
      notebookAccess: [{ notebookId: "nb_b", read: true, write: true }],
    });
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json();
    expect(updatedBody.apiToken.scopes).toEqual(["read:memos", "write:memos", "read:notebooks"]);
    expect(updatedBody.apiToken.notebookAccess).toEqual([
      { notebookId: "nb_b", read: true, write: true },
    ]);
    expect(updatedBody.apiToken.token).toBe(tokenValue);

    // Clearing the grants (empty array) un-restricts the token.
    const cleared = await patch(app, environment, createdBody.apiToken.id, { notebookAccess: [] });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).apiToken.notebookAccess).toBeNull();
  });

  test("rejects grants for unknown notebooks", async () => {
    const { app, environment } = createFixture();
    const response = await post(app, environment, {
      name: "Bad",
      scopes: ["read:memos"],
      notebookAccess: [{ notebookId: "nb_missing", read: true, write: false }],
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "unknown_notebook" } });
  });

  test("rejects duplicate notebook grants and unknown tokens", async () => {
    const { app, environment } = createFixture();
    const duplicate = await post(app, environment, {
      name: "Bad",
      scopes: ["read:memos"],
      notebookAccess: [
        { notebookId: "nb_a", read: true, write: false },
        { notebookId: "nb_a", read: false, write: true },
      ],
    });
    expect(duplicate.status).toBe(400);

    const missing = await patch(app, environment, "tok_missing", { name: "x" });
    expect(missing.status).toBe(404);
  });

  test("does not expose token updates to API tokens", async () => {
    const agentAuth = { ...userAuth, kind: "agent", actorType: "agent" };
    const { app, environment } = createFixture(agentAuth);
    const response = await patch(app, environment, "tok_1", { name: "x" });
    expect(response.status).toBe(403);
  });
});
