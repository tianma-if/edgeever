import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { callMcpTool } from "./index.ts";

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

const ALL_SCOPES = [
  "read:notebooks", "write:notebooks", "read:memos", "write:memos",
  "read:resources", "write:resources", "read:tags", "write:tags", "ai:generate",
];

const createFixture = () => {
  const sqlite = new Database(":memory:");
  for (const migration of globSync("migrations/*.sql").sort()) {
    sqlite.exec(readFileSync(migration, "utf8"));
  }
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)")
    .run("ws_mcp", "MCP workspace");
  sqlite.query("INSERT INTO users (id, username, password_hash, display_name) VALUES ('usr_1', 'owner', 'x', 'Owner')").run();
  sqlite.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('ws_mcp', 'usr_1', 'owner')").run();
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES ('nb_allowed', 'ws_mcp', 'Allowed')").run();
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_allowed_child', 'ws_mcp', 'Allowed Child', 'nb_allowed')").run();
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES ('nb_secret', 'ws_mcp', 'Secret')").run();

  const context = {
    env: { storage: { db: new SqliteD1Database(sqlite), resources: {} } },
    get: () => undefined,
  };

  const makeAuth = (notebookAccess) => ({
    kind: "agent",
    actorType: "agent",
    actorId: "tok_test",
    username: "test-agent",
    displayName: null,
    scopes: ALL_SCOPES,
    workspaceId: "ws_mcp",
    role: "member",
    notebookAccess: notebookAccess ?? null,
  });

  return { sqlite, context, makeAuth };
};

describe("MCP notebook access enforcement", () => {
  test("restricted tokens only see and touch granted notebooks", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const restricted = makeAuth([
      { notebookId: "nb_allowed", read: true, write: true },
    ]);
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    const allowedMemo = (await call(admin, "create_memo", {
      notebookId: "nb_allowed", title: "Allowed", contentMarkdown: "allowed body needle",
    })).memo;
    const childMemo = (await call(admin, "create_memo", {
      notebookId: "nb_allowed_child", title: "Child", contentMarkdown: "child body",
    })).memo;
    const secretMemo = (await call(admin, "create_memo", {
      notebookId: "nb_secret", title: "Secret", contentMarkdown: "secret needle",
    })).memo;

    // Listing and search are filtered to the granted subtree.
    const listed = await call(restricted, "list_memos", {});
    expect(listed.memos.map((memo) => memo.id).sort()).toEqual([allowedMemo.id, childMemo.id].sort());
    expect((await call(restricted, "search_memos", { query: "needle" })).memos.map((memo) => memo.id))
      .toEqual([allowedMemo.id]);
    expect((await call(restricted, "list_notebooks", {})).notebooks.map((nb) => nb.id).sort())
      .toEqual(["nb_allowed", "nb_allowed_child"]);

    // Reading a memo outside the grant is refused.
    await expect(call(restricted, "get_memo", { memoId: secretMemo.id }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    const read = await call(restricted, "get_memo", { memoId: childMemo.id });
    expect(read.memo.id).toBe(childMemo.id);

    // Writing outside the grant is refused; creating notebooks is refused.
    await expect(call(restricted, "create_memo", { notebookId: "nb_secret", title: "No", contentMarkdown: "x" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(restricted, "create_notebook", { name: "Nope" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(restricted, "rename_notebook", { notebookId: "nb_secret", name: "Nope" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });

    // Moves require write access to both source and target.
    await expect(call(restricted, "move_memos", { memoIds: [allowedMemo.id], notebookId: "nb_secret" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(restricted, "move_memos", { memoIds: [secretMemo.id], notebookId: "nb_allowed" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });

    // Updates and trash are refused outside the grant.
    await expect(call(restricted, "update_memo", { memoId: secretMemo.id, title: "Changed" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(restricted, "trash_memos", { memoIds: [secretMemo.id] }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });

    // In-grant writes still work.
    const updated = await call(restricted, "update_memo", { memoId: allowedMemo.id, title: "Renamed" });
    expect(updated.memo.title).toBe("Renamed");
    const created = await call(restricted, "create_memo", { notebookId: "nb_allowed_child", title: "New", contentMarkdown: "new" });
    expect(created.memo.notebookId).toBe("nb_allowed_child");
  });

  test("read-only grants deny writes but allow reads in the subtree", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const reader = makeAuth([{ notebookId: "nb_allowed", read: true, write: false }]);
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    const memo = (await call(admin, "create_memo", {
      notebookId: "nb_allowed", title: "Readable", contentMarkdown: "body",
    })).memo;

    expect((await call(reader, "get_memo", { memoId: memo.id })).memo.id).toBe(memo.id);
    await expect(call(reader, "update_memo", { memoId: memo.id, title: "No" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(reader, "create_memo", { notebookId: "nb_allowed", title: "No", contentMarkdown: "x" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
  });

  test("unrestricted tokens keep the previous behavior", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    const memo = (await call(admin, "create_memo", {
      notebookId: "nb_secret", title: "Anywhere", contentMarkdown: "body",
    })).memo;
    expect((await call(admin, "get_memo", { memoId: memo.id })).memo.id).toBe(memo.id);
    expect((await call(admin, "list_notebooks", {})).notebooks).toHaveLength(3);
    const stats = await call(admin, "get_workspace_stats", {});
    expect(stats.notebooks.active).toBe(3);
  });

  test("workspace stats are filtered for restricted tokens", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const restricted = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }]);
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    await call(admin, "create_memo", { notebookId: "nb_allowed", title: "A", contentMarkdown: "a" });
    await call(admin, "create_memo", { notebookId: "nb_secret", title: "S", contentMarkdown: "s" });

    const stats = await call(restricted, "get_workspace_stats", {});
    expect(stats.memos.active).toBe(1);
    expect(stats.notebooks.active).toBe(2);
  });

  test("get_current_user exposes the token's notebook grants", async () => {
    const { context, makeAuth } = createFixture();
    const restricted = makeAuth([{ notebookId: "nb_allowed", read: true, write: false }]);
    const identity = await callMcpTool(context, restricted, "get_current_user", {});
    expect(identity.authorization.notebookAccess).toEqual([
      { notebookId: "nb_allowed", read: true, write: false },
    ]);
  });
});
