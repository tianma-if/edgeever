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

  const makeAuth = (notebookAccess, notebookDefaultAccess) => ({
    kind: "agent",
    actorType: "agent",
    actorId: "tok_test",
    username: "test-agent",
    displayName: null,
    scopes: ALL_SCOPES,
    workspaceId: "ws_mcp",
    role: "member",
    notebookAccess: notebookAccess ?? null,
    notebookDefaultAccess: notebookDefaultAccess ?? "none",
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
    const restricted = makeAuth([{ notebookId: "nb_allowed", read: true, write: false }], "read");
    const identity = await callMcpTool(context, restricted, "get_current_user", {});
    expect(identity.authorization.notebookAccess).toEqual([
      { notebookId: "nb_allowed", read: true, write: false },
    ]);
    expect(identity.authorization.notebookDefaultAccess).toBe("read");
  });

  test("default access covers notebooks created after the token", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const reader = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }], "read");
    const writer = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }], "write");
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    // A notebook created after the token was issued.
    const fresh = (await call(admin, "create_notebook", { name: "Fresh" })).notebook;
    const freshMemo = (await call(admin, "create_memo", {
      notebookId: fresh.id, title: "Fresh memo", contentMarkdown: "fresh body",
    })).memo;

    // Default read: the fresh notebook is readable but not writable.
    expect((await call(reader, "get_memo", { memoId: freshMemo.id })).memo.id).toBe(freshMemo.id);
    expect((await call(reader, "list_notebooks", {})).notebooks.map((nb) => nb.id)).toContain(fresh.id);
    await expect(call(reader, "update_memo", { memoId: freshMemo.id, title: "No" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });

    // Default write: the fresh notebook is fully writable.
    const updated = await call(writer, "update_memo", { memoId: freshMemo.id, title: "Yes" });
    expect(updated.memo.title).toBe("Yes");
    const created = await call(writer, "create_memo", { notebookId: fresh.id, title: "New", contentMarkdown: "n" });
    expect(created.memo.notebookId).toBe(fresh.id);

    // Default write also allows creating top-level notebooks outright.
    const selfMade = (await call(writer, "create_notebook", { name: "Self Made" })).notebook;
    expect(selfMade.name).toBe("Self Made");

    // Default read/none cannot create notebooks: a clear 403, never a silent success.
    await expect(call(reader, "create_notebook", { name: "Nope" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    const none = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }], "none");
    await expect(call(none, "get_memo", { memoId: freshMemo.id }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(none, "create_notebook", { name: "Nope" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
  });

  test("restricted tokens cannot read or manage workspace templates", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const restricted = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }]);
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    const template = (await call(admin, "create_note_template", {
      name: "Weekly", contentMarkdown: "template body",
    })).template;

    await expect(call(restricted, "list_note_templates", {}))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(restricted, "get_note_template", { templateId: template.id }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(restricted, "update_note_template", { templateId: template.id, name: "Changed" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(restricted, "delete_note_template", { templateId: template.id }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(restricted, "use_note_template", { templateId: template.id, notebookId: "nb_allowed" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(restricted, "create_note_template", { name: "X", contentMarkdown: "y" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });

    // Unrestricted tokens keep working.
    expect((await call(admin, "get_note_template", { templateId: template.id })).template.id).toBe(template.id);
  });

  test("import dedup does not leak memo bodies outside the grant", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const restricted = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }]);
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    // Import one memo into the secret notebook first (admin), then re-import the
    // same external id into the allowed notebook with the restricted token.
    const first = await call(admin, "import_memos", {
      source: "flomo",
      notebookId: "nb_secret",
      items: [{ externalId: "ext-1", title: "Secret import", contentMarkdown: "secret-body-needle" }],
    });
    expect(first.results[0].status).toBe("created");

    const second = await call(restricted, "import_memos", {
      source: "flomo",
      notebookId: "nb_allowed",
      items: [{ externalId: "ext-1", title: "Secret import", contentMarkdown: "secret-body-needle" }],
    });
    expect(second.results[0].status).toBe("skipped");
    expect(second.results[0].reason).toBe("notebook_access_denied");
    expect(second.results[0]).not.toHaveProperty("memo");
    expect(JSON.stringify(second)).not.toContain("secret-body-needle");

    // Importing into a non-writable destination is refused outright.
    await expect(call(restricted, "import_memos", {
      source: "flomo",
      notebookId: "nb_secret",
      items: [{ externalId: "ext-2", title: "No", contentMarkdown: "x" }],
    })).rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
  });
});
