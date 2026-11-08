import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  assertNotebookAccess,
  hasAllNotebookAccess,
  memoNotebookAccessSql,
  notebookAccessBinds,
  parseNotebookAccessJson,
  resolveNotebookAccess,
  UNRESTRICTED_NOTEBOOK_ACCESS,
} from "./token-notebook-access.ts";

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

const createFixture = () => {
  const sqlite = new Database(":memory:");
  for (const migration of globSync("migrations/*.sql").sort()) {
    sqlite.exec(readFileSync(migration, "utf8"));
  }
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)")
    .run("ws_t", "Test workspace");
  // nb_root -> nb_child -> nb_grandchild, plus nb_other and a deleted notebook.
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_root', 'ws_t', 'Root', NULL)").run();
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_child', 'ws_t', 'Child', 'nb_root')").run();
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_grandchild', 'ws_t', 'Grandchild', 'nb_child')").run();
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_other', 'ws_t', 'Other', NULL)").run();
  sqlite.query("INSERT INTO notebooks (id, workspace_id, name, parent_id, is_deleted) VALUES ('nb_gone', 'ws_t', 'Gone', NULL, 1)").run();
  return new SqliteD1Database(sqlite);
};

describe("parseNotebookAccessJson", () => {
  test("null and malformed values stay unrestricted", () => {
    expect(parseNotebookAccessJson(null)).toBeNull();
    expect(parseNotebookAccessJson(undefined)).toBeNull();
    expect(parseNotebookAccessJson("")).toBeNull();
    expect(parseNotebookAccessJson("not json")).toBeNull();
    expect(parseNotebookAccessJson('{"notebookId":"nb_a"}')).toBeNull();
    expect(parseNotebookAccessJson("[]")).toBeNull();
  });

  test("keeps valid entries and drops malformed ones", () => {
    expect(parseNotebookAccessJson(
      '[{"notebookId":"nb_a","read":true,"write":false},{"notebookId":""},{"nope":1}]',
    )).toEqual([{ notebookId: "nb_a", read: true, write: false }]);
  });
});

describe("resolveNotebookAccess", () => {
  test("null entries resolve unrestricted without database reads", async () => {
    const db = createFixture();
    expect(await resolveNotebookAccess(db, "ws_t", null)).toEqual(UNRESTRICTED_NOTEBOOK_ACCESS);
    expect(await resolveNotebookAccess(db, "ws_t", undefined)).toEqual(UNRESTRICTED_NOTEBOOK_ACCESS);
    expect(await resolveNotebookAccess(db, "ws_t", [])).toEqual(UNRESTRICTED_NOTEBOOK_ACCESS);
  });

  test("expands grants to live subtrees and drops deleted notebooks", async () => {
    const db = createFixture();
    const access = await resolveNotebookAccess(db, "ws_t", [
      { notebookId: "nb_root", read: true, write: true },
      { notebookId: "nb_gone", read: true, write: true },
    ]);
    expect(access.restricted).toBe(true);
    expect(access.readableNotebookIds.sort()).toEqual(["nb_child", "nb_grandchild", "nb_root"]);
    expect(access.writableNotebookIds.sort()).toEqual(["nb_child", "nb_grandchild", "nb_root"]);
  });

  test("write implies read; read-only grants do not imply write", async () => {
    const db = createFixture();
    const access = await resolveNotebookAccess(db, "ws_t", [
      { notebookId: "nb_root", read: false, write: true },
      { notebookId: "nb_other", read: true, write: false },
    ]);
    expect(access.readableNotebookIds.sort()).toEqual(["nb_child", "nb_grandchild", "nb_other", "nb_root"]);
    expect(access.writableNotebookIds.sort()).toEqual(["nb_child", "nb_grandchild", "nb_root"]);
  });

  test("a grant for a missing notebook restricts to nothing", async () => {
    const db = createFixture();
    const access = await resolveNotebookAccess(db, "ws_t", [
      { notebookId: "nb_nope", read: true, write: true },
    ]);
    expect(access).toEqual({ restricted: true, readableNotebookIds: [], writableNotebookIds: [] });
  });
});

describe("notebook access assertions", () => {
  const restricted = {
    restricted: true,
    readableNotebookIds: ["nb_a", "nb_a_child"],
    writableNotebookIds: ["nb_a"],
  };

  test("unrestricted access always passes", () => {
    expect(() => assertNotebookAccess(UNRESTRICTED_NOTEBOOK_ACCESS, "write", "anything", "test")).not.toThrow();
    expect(hasAllNotebookAccess(UNRESTRICTED_NOTEBOOK_ACCESS, "write", ["a", "b"])).toBe(true);
  });

  test("denies notebooks outside the grant with a typed error", () => {
    expect(hasAllNotebookAccess(restricted, "read", ["nb_a", "nb_a_child"])).toBe(true);
    expect(hasAllNotebookAccess(restricted, "write", ["nb_a_child"])).toBe(false);
    expect(() => assertNotebookAccess(restricted, "write", "nb_other", "create a memo"))
      .toThrow(expect.objectContaining({ code: "notebook_access_denied", status: 403 }));
  });

  test("sql fragments stay neutral when unrestricted", () => {
    expect(memoNotebookAccessSql("m.notebook_id", UNRESTRICTED_NOTEBOOK_ACCESS, "read")).toBe("1 = 1");
    expect(notebookAccessBinds(UNRESTRICTED_NOTEBOOK_ACCESS, "read")).toEqual([]);
    expect(memoNotebookAccessSql("m.notebook_id", restricted, "write")).toBe("m.notebook_id IN (?)");
    expect(notebookAccessBinds(restricted, "write")).toEqual(["nb_a"]);
    expect(memoNotebookAccessSql("m.notebook_id", { restricted: true, readableNotebookIds: [], writableNotebookIds: [] }, "read")).toBe("0 = 1");
  });
});
