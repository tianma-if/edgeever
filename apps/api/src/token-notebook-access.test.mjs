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

// A fresh adapter over the same underlying database, simulating a different
// worker/isolate that shares storage but no in-memory state.
const createFixtureAdapter = (sqlite) => new SqliteD1Database(sqlite);

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

    // A notebook created after the token stays invisible. There is no cache,
    // so the next resolution reads the current hierarchy directly.
    db.db.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_fresh', 'ws_t', 'Fresh', NULL)").run();
    const after = await resolveNotebookAccess(db, "ws_t", [grant("nb_child", "write")], "write");
    expect(after.readableNotebookIds).not.toContain("nb_fresh");

    // ...unless it is created under a whitelisted parent.
    db.db.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_fresh_child', 'ws_t', 'FreshChild', 'nb_child')").run();
    const inherited = await resolveNotebookAccess(db, "ws_t", [grant("nb_child", "write")], "write");
    expect(inherited.readableNotebookIds).toContain("nb_fresh_child");
  });

  test("moving a child out of a granted subtree narrows access immediately on any instance", async () => {
    const db = createFixture();
    const entries = [grant("nb_root", "write")];
    // First "worker" resolves and sees the whole subtree.
    const before = await resolveNotebookAccess(db, "ws_t", entries, "write");
    expect(before.readableNotebookIds).toContain("nb_grandchild");

    // Another worker moves the child out from under the granted root.
    db.db.query("UPDATE notebooks SET parent_id = NULL WHERE id = 'nb_child'").run();

    // A fresh resolution (a different isolate with no shared cache) must
    // immediately exclude the moved subtree — no stale allow.
    const otherInstance = createFixtureAdapter(db.db);
    const after = await resolveNotebookAccess(otherInstance, "ws_t", entries, "write");
    expect(after.readableNotebookIds).toEqual(["nb_root"]);
    expect(after.readableNotebookIds).not.toContain("nb_child");
    expect(after.readableNotebookIds).not.toContain("nb_grandchild");
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

describe("authorization read budget (no cache, scoped expansion)", () => {
  // Wrap an adapter to count queries and the rows each access query returns.
  const countingAdapter = (db) => {
    const realPrepare = db.prepare.bind(db);
    const stats = { queries: 0, accessRows: 0, accessSql: [] };
    const adapter = {
      prepare: (sql) => {
        const statement = realPrepare(sql);
        return {
          bind: (...bindings) => {
            const bound = statement.bind(...bindings);
            const isAccess = /WITH RECURSIVE accessible/.test(sql);
            if (isAccess) stats.accessSql.push(sql);
            return {
              async all() {
                stats.queries += 1;
                const result = await bound.all();
                if (isAccess) stats.accessRows += result.results.length;
                return result;
              },
              async first() { stats.queries += 1; return bound.first(); },
              async run() { stats.queries += 1; return bound.run(); },
            };
          },
        };
      },
    };
    return { adapter, stats };
  };

  const seedManyUnrelated = (db, count, prefix) => {
    for (let i = 0; i < count; i++) {
      db.db.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES (?, 'ws_t', ?, NULL)")
        .run(`${prefix}_${i}`, `Unrelated ${i}`);
    }
  };

  test("reads only the granted subtree, never the whole notebook table", async () => {
    const db = createFixture();
    // Granted subtree is nb_root -> nb_child -> nb_grandchild (3 notebooks).
    seedManyUnrelated(db, 500, "bulk_a");
    const { adapter, stats } = countingAdapter(db);

    const access = await resolveNotebookAccess(adapter, "ws_t", [grant("nb_root", "write")], "write");
    expect(access.readableNotebookIds.sort()).toEqual(["nb_child", "nb_grandchild", "nb_root"]);
    expect(stats.queries).toBe(1);
    // Only the 3 authorized rows are read, not the 500+ unrelated notebooks.
    expect(stats.accessRows).toBe(3);
    // The expansion is a scoped recursive CTE seeded from the whitelist.
    expect(stats.accessSql[0]).toContain("json_each");
    expect(stats.accessSql[0]).not.toMatch(/SELECT id, parent_id FROM notebooks WHERE workspace_id = \? AND is_deleted = 0\s*$/);
  });

  test("read volume does not grow with the total notebook count", async () => {
    const db = createFixture();
    seedManyUnrelated(db, 200, "bulk_a");
    const first = countingAdapter(db);
    await resolveNotebookAccess(first.adapter, "ws_t", [grant("nb_root", "write")], "write");
    expect(first.stats.accessRows).toBe(3);

    // Add 800 more unrelated notebooks; the authorized read volume is unchanged.
    seedManyUnrelated(db, 800, "bulk_b");
    const second = countingAdapter(db);
    await resolveNotebookAccess(second.adapter, "ws_t", [grant("nb_root", "write")], "write");
    expect(second.stats.accessRows).toBe(3);
  });

  test("paged listings across isolates stay fresh and bounded by the granted subtree", async () => {
    const db = createFixture();
    seedManyUnrelated(db, 1000, "bulk");
    const entries = [grant("nb_root", "write")];

    // Ten pages, each on a fresh adapter (different isolate, no shared cache),
    // spaced far enough apart that any TTL cache would have expired.
    let totalRows = 0;
    for (let page = 0; page < 10; page++) {
      const isolate = createFixtureAdapter(db.db);
      const { adapter, stats } = countingAdapter(isolate);
      const access = await resolveNotebookAccess(adapter, "ws_t", entries, "write");
      expect(access.readableNotebookIds.length).toBe(3);
      expect(stats.queries).toBe(1);
      totalRows += stats.accessRows;
    }
    // 10 pages read 10 x 3 authorized rows, not 10 x 1003 whole-tree rows.
    expect(totalRows).toBe(30);

    // A move performed "on another worker" is visible on the next page even
    // though no cache was invalidated anywhere.
    db.db.query("UPDATE notebooks SET parent_id = NULL WHERE id = 'nb_child'").run();
    const isolate = createFixtureAdapter(db.db);
    const access = await resolveNotebookAccess(isolate, "ws_t", entries, "write");
    expect(access.readableNotebookIds).toEqual(["nb_root"]);
  });
});
