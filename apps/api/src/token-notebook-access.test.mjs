import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  assertNotebookAccess,
  isCorruptedNotebookAccess,
  memoNotebookAccessSql,
  notebookAccessBinds,
  notebookInListSql,
  notebookIdsBind,
  parseNotebookAccessJson,
  parseNotebookAccessLevel,
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

const grant = (notebookId, level) => ({ notebookId, read: true, write: level === "write" });

describe("parseNotebookAccessJson", () => {
  test("null stays unrestricted; empty and malformed values fail closed", () => {
    expect(parseNotebookAccessJson(null)).toBeNull();
    expect(parseNotebookAccessJson(undefined)).toBeNull();
    expect(parseNotebookAccessJson("")).toEqual([]);
    expect(parseNotebookAccessJson("not json")).toEqual([]);
    expect(parseNotebookAccessJson('{"notebookId":"nb_a"}')).toEqual([]);
    expect(parseNotebookAccessJson("[]")).toEqual([]);
    expect(parseNotebookAccessJson('[{"notebookId":""}]')).toEqual([]);
  });

  test("any malformed entry fails the whole record closed", () => {
    expect(parseNotebookAccessJson(
      '[{"notebookId":"nb_a","read":true,"write":false},{"notebookId":""}]',
    )).toEqual([]);
    expect(parseNotebookAccessJson(
      '[{"notebookId":"nb_a","read":true,"write":false},{"nope":1}]',
    )).toEqual([]);
    expect(parseNotebookAccessJson(
      '[{"notebookId":"nb_a","read":true}]',
    )).toEqual([]);
    expect(parseNotebookAccessJson(
      '[{"notebookId":"nb_a","read":true,"write":false}]',
    )).toEqual([{ notebookId: "nb_a", read: true, write: false }]);
  });

  test("level parsing", () => {
    expect(parseNotebookAccessLevel("write")).toBe("write");
    expect(parseNotebookAccessLevel("read")).toBe("read");
    expect(parseNotebookAccessLevel(null)).toBe("read");
    expect(parseNotebookAccessLevel("bogus")).toBe("read");
  });

  test("corruption detection", () => {
    expect(isCorruptedNotebookAccess(null)).toBe(false);
    expect(isCorruptedNotebookAccess('[{"notebookId":"nb_a","read":true,"write":false}]')).toBe(false);
    expect(isCorruptedNotebookAccess("[]")).toBe(false);
    expect(isCorruptedNotebookAccess("not json")).toBe(true);
    expect(isCorruptedNotebookAccess('{"notebookId":"nb_a"}')).toBe(true);
    expect(isCorruptedNotebookAccess('[{"notebookId":"nb_a","read":true}]')).toBe(true);
  });
});

describe("resolveNotebookAccess (whitelist)", () => {
  test("null entries resolve unrestricted", async () => {
    const db = createFixture();
    expect(await resolveNotebookAccess(db, "ws_t", null)).toEqual(UNRESTRICTED_NOTEBOOK_ACCESS);
    expect(await resolveNotebookAccess(db, "ws_t", undefined)).toEqual(UNRESTRICTED_NOTEBOOK_ACCESS);
  });

  test("a whitelisted notebook opens its whole live subtree", async () => {
    const db = createFixture();
    const access = await resolveNotebookAccess(db, "ws_t", [grant("nb_root", "read")], "read");
    expect(access.restricted).toBe(true);
    expect(access.readableNotebookIds.sort()).toEqual(["nb_child", "nb_grandchild", "nb_root"]);
    expect(access.writableNotebookIds).toEqual([]);
    expect(access.defaultWrite).toBe(false);
  });

  test("the write level grants read and write on the whole whitelist", async () => {
    const db = createFixture();
    const access = await resolveNotebookAccess(db, "ws_t", [grant("nb_root", "write")], "write");
    expect(access.readableNotebookIds.sort()).toEqual(["nb_child", "nb_grandchild", "nb_root"]);
    expect(access.writableNotebookIds.sort()).toEqual(["nb_child", "nb_grandchild", "nb_root"]);
    expect(access.defaultWrite).toBe(true);
  });

  test("listing a child alongside its parent adds nothing", async () => {
    const db = createFixture();
    const parentOnly = await resolveNotebookAccess(db, "ws_t", [grant("nb_root", "write")], "write");
    const withChild = await resolveNotebookAccess(db, "ws_t", [grant("nb_root", "write"), grant("nb_child", "write")], "write");
    expect(withChild).toEqual(parentOnly);
  });

  test("unwhitelisted notebooks — including new ones — stay invisible", async () => {
    const db = createFixture();
    const access = await resolveNotebookAccess(db, "ws_t", [grant("nb_child", "write")], "write");
    expect(access.readableNotebookIds).toEqual(["nb_child", "nb_grandchild"]);
    expect(access.readableNotebookIds).not.toContain("nb_other");
    expect(access.readableNotebookIds).not.toContain("nb_root");

    // A notebook created after the token stays invisible.
    db.db.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_fresh', 'ws_t', 'Fresh', NULL)").run();
    const after = await resolveNotebookAccess(db, "ws_t", [grant("nb_child", "write")], "write");
    expect(after.readableNotebookIds).not.toContain("nb_fresh");

    // ...unless it is created under a whitelisted parent.
    db.db.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_fresh_child', 'ws_t', 'FreshChild', 'nb_child')").run();
    const inherited = await resolveNotebookAccess(db, "ws_t", [grant("nb_child", "write")], "write");
    expect(inherited.readableNotebookIds).toContain("nb_fresh_child");
  });

  test("an empty whitelist grants nothing", async () => {
    const db = createFixture();
    const access = await resolveNotebookAccess(db, "ws_t", [], "write");
    expect(access).toEqual({ restricted: true, readableNotebookIds: [], writableNotebookIds: [], defaultWrite: true });
  });

  test("a whitelist entry for a deleted notebook resolves to nothing", async () => {
    const db = createFixture();
    const access = await resolveNotebookAccess(db, "ws_t", [grant("nb_gone", "write")], "write");
    expect(access.readableNotebookIds).toEqual([]);
  });

  test("resolveNotebookAccess issues exactly one notebook query", async () => {
    const db = createFixture();
    const realPrepare = db.prepare.bind(db);
    let queries = 0;
    const counting = {
      prepare: (sql) => {
        const statement = realPrepare(sql);
        return {
          bind: (...bindings) => {
            const bound = statement.bind(...bindings);
            return {
              async all() { queries += 1; return bound.all(); },
              async first() { queries += 1; return bound.first(); },
              async run() { queries += 1; return bound.run(); },
            };
          },
        };
      },
    };

    const access = await resolveNotebookAccess(counting, "ws_t", [grant("nb_root", "write")], "write");
    expect(queries).toBe(1);
    expect(access.readableNotebookIds.length).toBeGreaterThan(0);
  });
});

describe("notebook access assertions", () => {
  const restricted = {
    restricted: true,
    readableNotebookIds: ["nb_a", "nb_a_child"],
    writableNotebookIds: ["nb_a"],
    defaultWrite: false,
  };

  test("unrestricted access always passes", () => {
    expect(() => assertNotebookAccess(UNRESTRICTED_NOTEBOOK_ACCESS, "write", "anything", "test")).not.toThrow();
  });

  test("denies notebooks outside the whitelist with a typed error", () => {
    expect(() => assertNotebookAccess(restricted, "write", "nb_other", "create a memo"))
      .toThrow(expect.objectContaining({ code: "notebook_access_denied", status: 403 }));
    expect(() => assertNotebookAccess(restricted, "write", "nb_a_child", "edit this memo"))
      .toThrow(expect.objectContaining({ code: "notebook_access_denied", status: 403 }));
    expect(() => assertNotebookAccess(restricted, "read", "nb_a_child", "read this memo")).not.toThrow();
  });

  test("sql fragments stay neutral when unrestricted", () => {
    expect(memoNotebookAccessSql("m.notebook_id", UNRESTRICTED_NOTEBOOK_ACCESS, "read")).toBe("1 = 1");
    expect(notebookAccessBinds(UNRESTRICTED_NOTEBOOK_ACCESS, "read")).toEqual([]);
    expect(memoNotebookAccessSql("m.notebook_id", restricted, "write")).toBe("m.notebook_id IN (SELECT value FROM json_each(?))");
    expect(notebookAccessBinds(restricted, "write")).toEqual([JSON.stringify(["nb_a"])]);
    expect(memoNotebookAccessSql("m.notebook_id", { restricted: true, readableNotebookIds: [], writableNotebookIds: [], defaultWrite: false }, "read")).toBe("0 = 1");
    expect(notebookAccessBinds({ restricted: true, readableNotebookIds: [], writableNotebookIds: [], defaultWrite: false }, "read")).toEqual([]);
    // 200 ids still bind exactly one value.
    const ids = Array.from({ length: 200 }, (_, i) => `nb_${i}`);
    expect((notebookInListSql("m.notebook_id", ids).match(/\?/g) ?? []).length).toBe(1);
    expect(notebookIdsBind(ids)).toBe(JSON.stringify(ids));
  });
});
