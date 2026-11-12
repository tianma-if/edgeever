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
    const result = this.db.query(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: result.changes } };
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
    return this.db.transaction(() => statements.map((statement) => {
      const result = this.db.query(statement.sql).run(...statement.bindings);
      return { success: true, meta: { changes: result.changes } };
    }))();
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

  const makeAuth = (notebookAccess, level) => ({
    kind: "agent",
    actorType: "agent",
    actorId: "tok_test",
    username: "test-agent",
    displayName: null,
    scopes: ALL_SCOPES,
    workspaceId: "ws_mcp",
    role: "member",
    notebookAccess: notebookAccess ?? null,
    notebookAccessLevel: level ?? "read",
  });

  return { sqlite, context, makeAuth };
};

describe("MCP notebook access enforcement", () => {
  test("restricted tokens only see and touch granted notebooks", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const restricted = makeAuth([
      { notebookId: "nb_allowed", read: true, write: true },
    ], "write");
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
    // Renaming a non-whitelisted notebook is refused (creating top-level
    // notebooks is allowed for write-level tokens by design).
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
    const restricted = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }], "write");
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
    expect(identity.authorization.notebookAccessLevel).toBe("read");
  });

  test("notebooks created after the token follow the whitelist", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const reader = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }], "read");
    const writer = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }], "write");
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    // A top-level notebook created after the token stays invisible.
    const fresh = (await call(admin, "create_notebook", { name: "Fresh" })).notebook;
    const freshMemo = (await call(admin, "create_memo", {
      notebookId: fresh.id, title: "Fresh memo", contentMarkdown: "fresh body",
    })).memo;

    await expect(call(reader, "get_memo", { memoId: freshMemo.id }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(writer, "get_memo", { memoId: freshMemo.id }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });

    // A child created under the whitelisted parent inherits access.
    const freshChild = (await call(admin, "create_notebook", { name: "FreshChild", parentId: "nb_allowed" })).notebook;
    const childMemo = (await call(admin, "create_memo", {
      notebookId: freshChild.id, title: "Child memo", contentMarkdown: "child body",
    })).memo;

    expect((await call(reader, "get_memo", { memoId: childMemo.id })).memo.id).toBe(childMemo.id);
    await expect(call(reader, "update_memo", { memoId: childMemo.id, title: "No" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    const updated = await call(writer, "update_memo", { memoId: childMemo.id, title: "Yes" });
    expect(updated.memo.title).toBe("Yes");

    // The write level also allows creating top-level notebooks outright.
    const selfMade = (await call(writer, "create_notebook", { name: "Self Made" })).notebook;
    expect(selfMade.name).toBe("Self Made");

    // The read level cannot create notebooks: a clear 403.
    await expect(call(reader, "create_notebook", { name: "Nope" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
  });

  test("restricted tokens cannot read or manage workspace templates", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const restricted = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }], "write");
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

  test("restricted tokens cannot read or manage AI instructions", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const restricted = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }], "write");
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    await expect(call(restricted, "list_ai_instructions", {}))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(restricted, "create_ai_instruction", { name: "X", instruction: "y" }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });

    // Unrestricted tokens keep working.
    const created = await call(admin, "create_ai_instruction", { name: "Helper", instruction: "Help politely." });
    expect((await call(admin, "get_ai_instruction", { instructionId: created.instruction.id })).instruction.id)
      .toBe(created.instruction.id);
  });

  test("import dedup does not leak memo bodies outside the grant", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const restricted = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }], "write");
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

describe("empty readable lists bind no parameters", () => {
  test("list_notebooks and get_workspace_stats work with zero granted notebooks", async () => {
    const { context, makeAuth } = createFixture();
    const noneGranted = makeAuth([{ notebookId: "nb_missing", read: true, write: true }]);

    // The grant references a notebook that does not exist, so the resolved
    // readable list is empty; both entry points must not bind a json_each
    // parameter for an empty list ("0 = 1" needs no binds).
    const notebooks = await callMcpTool(context, noneGranted, "list_notebooks", {});
    expect(notebooks.notebooks).toEqual([]);

    const stats = await callMcpTool(context, noneGranted, "get_workspace_stats", {});
    expect(stats.notebooks.active).toBe(0);
    expect(stats.memos.active).toBe(0);
  });
});

describe("trashed memo revision access", () => {
  test("revisions of trashed memos outside the grant are refused", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const restricted = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }], "write");
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    // Create and edit a memo in the secret notebook, then trash it.
    const memo = (await call(admin, "create_memo", {
      notebookId: "nb_secret", title: "Secret", contentMarkdown: "v1 body",
    })).memo;
    await call(admin, "update_memo", { memoId: memo.id, contentMarkdown: "v2 secret needle" });
    await call(admin, "trash_memos", { memoIds: [memo.id] });

    // Reading the trashed memo directly is refused (invisible)...
    await expect(call(restricted, "get_memo", { memoId: memo.id }))
      .rejects.toThrow("Memo not found");
    // ...and so are its revisions and revision previews.
    await expect(call(restricted, "list_memo_revisions", { memoId: memo.id }))
      .rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    const revisions = (await call(admin, "list_memo_revisions", { memoId: memo.id })).revisions;
    await expect(call(restricted, "restore_memo_revision", {
      memoId: memo.id, revisionId: revisions[0].id, dryRun: true,
    })).rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });
    await expect(call(restricted, "restore_memo_revision", {
      memoId: memo.id, revisionId: revisions[0].id,
    })).rejects.toMatchObject({ code: "notebook_access_denied", status: 403 });

    // In-grant trashed memos keep working for both paths.
    const allowed = (await call(admin, "create_memo", {
      notebookId: "nb_allowed", title: "Allowed", contentMarkdown: "a1",
    })).memo;
    await call(admin, "update_memo", { memoId: allowed.id, contentMarkdown: "a2" });
    await call(admin, "trash_memos", { memoIds: [allowed.id] });
    const allowedRevisions = (await call(restricted, "list_memo_revisions", { memoId: allowed.id })).revisions;
    expect(allowedRevisions.length).toBeGreaterThan(0);
    const preview = await call(restricted, "restore_memo_revision", {
      memoId: allowed.id, revisionId: allowedRevisions[0].id, dryRun: true,
    });
    expect(preview.dryRun).toBe(true);
  });
});

describe("batch access checks stay within the query budget", () => {
  test("moving 48 memos authorizes with a single batched query", async () => {
    const { context, makeAuth } = createFixture();
    const admin = makeAuth(null);
    const restricted = makeAuth([{ notebookId: "nb_allowed", read: true, write: true }], "write");
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    const memoIds = [];
    for (let index = 0; index < 48; index++) {
      memoIds.push((await call(admin, "create_memo", {
        notebookId: "nb_allowed", title: `m${index}`, contentMarkdown: "x",
      })).memo.id);
    }

    // Count database statements during the restricted move.
    const realDb = context.env.storage.db;
    let statements = 0;
    // Count executed queries the way D1 bills them: each all/first/run is a
    // query; a batch is one operation regardless of its statement count.
    const countingDb = {
      prepare(sql) {
        const statement = realDb.prepare(sql);
        return {
          bind(...bindings) {
            const bound = statement.bind(...bindings);
            return {
              sql,
              bindings,
              async all() { statements += 1; return bound.all(); },
              async first() { statements += 1; return bound.first(); },
              async run() { statements += 1; return bound.run(); },
            };
          },
        };
      },
      async batch(statementList) {
        statements += 1;
        return realDb.batch(statementList.map(
          (entry) => realDb.prepare(entry.sql).bind(...(entry.bindings ?? [])),
        ));
      },
    };
    context.env.storage.db = countingDb;
    try {
      const moved = await call(restricted, "move_memos", { memoIds, notebookId: "nb_allowed_child" });
      expect(moved.moved).toBe(48);
      // Auth resolution + one batched guard + the service's own queries:
      // far below D1's 50-query budget, and no per-memo detail loads.
      expect(statements).toBeLessThan(20);
    } finally {
      context.env.storage.db = realDb;
    }
  });
});

describe("notebook deletion and restore with token grants", () => {
  test("deleting a parent keeps children that tokens reference explicitly", async () => {
    const { context, makeAuth, sqlite } = createFixture();
    const admin = makeAuth(null);
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    // Parent with an empty child; a token denies the child explicitly.
    const parent = (await call(admin, "create_notebook", { name: "Parent" })).notebook;
    const child = (await call(admin, "create_notebook", { name: "Child", parentId: parent.id })).notebook;
    sqlite.query("INSERT INTO api_tokens (id, workspace_id, name, token_hash, scopes_json, notebook_access_json, created_at) VALUES (?, 'ws_mcp', 'deny-child', 'x', '[\"read:memos\"]', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
      .run("tok_deny", JSON.stringify([{ notebookId: child.id, read: false, write: false }]));

    const deleted = await call(admin, "delete_notebook", { notebookId: parent.id });
    expect(deleted.deleted).toBe(true);
    // The child survived and was detached to the root.
    const childRow = sqlite.query("SELECT is_deleted, parent_id FROM notebooks WHERE id = ?").get(child.id);
    expect(childRow.is_deleted).toBe(0);
    expect(childRow.parent_id).toBeNull();
    // The parent itself is gone.
    const parentRow = sqlite.query("SELECT is_deleted FROM notebooks WHERE id = ?").get(parent.id);
    expect(parentRow.is_deleted).toBe(1);
  });

  test("restoring a child of a still-deleted parent detaches it to the root", async () => {
    const { context, makeAuth, sqlite } = createFixture();
    const admin = makeAuth(null);
    const call = (auth, tool, args) => callMcpTool(context, auth, tool, args);

    const parent = (await call(admin, "create_notebook", { name: "P2" })).notebook;
    const child = (await call(admin, "create_notebook", { name: "C2", parentId: parent.id })).notebook;
    await call(admin, "delete_notebook", { notebookId: parent.id });
    // Both are deleted together (no token references the child here).
    expect(sqlite.query("SELECT is_deleted FROM notebooks WHERE id = ?").get(child.id).is_deleted).toBe(1);

    // Restore only the child (REST route semantics via the service).
    const { restoreNotebookRecord } = await import("./notebook-service.ts");
    const restored = await restoreNotebookRecord(
      context.env.storage.db, "ws_mcp", child.id,
      { actorType: "user", actorId: "usr_1" },
    );
    expect(restored.id).toBe(child.id);
    const childRow = sqlite.query("SELECT is_deleted, parent_id FROM notebooks WHERE id = ?").get(child.id);
    expect(childRow.is_deleted).toBe(0);
    // Detached from the still-deleted parent instead of inheriting its fate.
    expect(childRow.parent_id).toBeNull();
  });
});
