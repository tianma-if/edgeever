import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  assertMemoNotebookWriteAccess,
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
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- Native SQLite VM-cost measurement (optional) --------------------------
// bun:sqlite does not expose sqlite3_progress_handler. To prove the expansion's
// real VM cost does not grow with unrelated notebooks (not merely its returned
// row count), measure through the platform libsqlite3 when it is loadable. If
// it is not available on a given platform, the VM-cost test is skipped; the
// portable query-plan assertion in the read-budget suite still guards the
// directed access path.
const makeNativeVmMeasure = (ffi, libName) => {
  const lib = ffi.dlopen(libName, {
    sqlite3_open: { args: ["cstring", "ptr"], returns: "i32" },
    sqlite3_close: { args: ["u64"], returns: "i32" },
    sqlite3_progress_handler: { args: ["u64", "i32", "u64", "u64"], returns: "void" },
    sqlite3_prepare_v2: { args: ["u64", "cstring", "i32", "ptr", "ptr"], returns: "i32" },
    sqlite3_bind_text: { args: ["u64", "i32", "cstring", "i32", "u64"], returns: "i32" },
    sqlite3_step: { args: ["u64"], returns: "i32" },
    sqlite3_finalize: { args: ["u64"], returns: "i32" },
  });
  const S = lib.symbols;
  const cstr = (s) => ffi.ptr(Buffer.from(s + "\0"));
  return (file, sql, binds) => {
    const ppDb = new BigUint64Array(1);
    if (S.sqlite3_open(cstr(file), ffi.ptr(ppDb)) !== 0) throw new Error("sqlite3_open failed");
    const dbh = ppDb[0];
    let steps = 0;
    const cb = new ffi.JSCallback(() => { steps += 1; return 0; }, { args: [], returns: "i32" });
    S.sqlite3_progress_handler(dbh, 1, BigInt(cb.ptr), 0n);
    const ppStmt = new BigUint64Array(1);
    const tail = new BigUint64Array(1);
    if (S.sqlite3_prepare_v2(dbh, cstr(sql), -1, ffi.ptr(ppStmt), ffi.ptr(tail)) !== 0) {
      throw new Error("sqlite3_prepare_v2 failed");
    }
    const st = ppStmt[0];
    binds.forEach((b, i) => S.sqlite3_bind_text(st, i + 1, cstr(b), -1, 0n));
    while (S.sqlite3_step(st) === 100) { /* drain rows */ }
    S.sqlite3_finalize(st);
    S.sqlite3_close(dbh);
    cb.close();
    return steps;
  };
};
let nativeVmSteps = null;
try {
  const ffi = await import("bun:ffi");
  for (const libName of ["libsqlite3.so.0", "libsqlite3.dylib"]) {
    try { nativeVmSteps = makeNativeVmMeasure(ffi, libName); break; } catch { /* try next name */ }
  }
} catch { /* bun:ffi unavailable on this platform */ }

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

test("bulk memo authorization seeks only requested IDs as unrelated notes accumulate", async () => {
  const adapter = createFixture();
  const sqlite = adapter.db;
  const insert = sqlite.query("INSERT INTO memos (id, workspace_id, notebook_id) VALUES (?, 'ws_t', ?)");
  const access = await resolveNotebookAccess(adapter, "ws_t", [grant("nb_root", "write")], "write");
  const ids = Array.from({ length: 100 }, (_, index) => `requested_${index}`);
  for (const id of ids) insert.run(id, "nb_root");

  const calls = [];
  const measuredDb = {
    prepare: (sql) => ({
      bind: (...bindings) => ({
        async all() {
          const result = await adapter.prepare(sql).bind(...bindings).all();
          calls.push({ sql, bindings, count: result.results.length });
          return result;
        },
      }),
    }),
  };
  const checkBatch = async (idsToCheck, deletedState) => {
    await assertMemoNotebookWriteAccess(measuredDb, "ws_t", [...idsToCheck, idsToCheck[0]], access, "update memos", deletedState);
    expect(calls).toHaveLength(1);
    const { sql, bindings, count } = calls.pop();
    expect(bindings).toEqual(deletedState === undefined
      ? ["ws_t", JSON.stringify(idsToCheck)]
      : ["ws_t", deletedState, JSON.stringify(idsToCheck)]);
    expect(count).toBe(idsToCheck.length);
    const plan = sqlite.query("EXPLAIN QUERY PLAN " + sql).all(...bindings).map((row) => row.detail).join("\n");
    expect(plan).toMatch(/SEARCH memos .*\((?:workspace_id=\? AND )?id=\?\)/);
  };

  for (const deletedState of [undefined, 0]) await checkBatch(ids.slice(0, 1), deletedState);
  sqlite.transaction(() => {
    for (let i = 0; i < 5000; i++) insert.run(`unrelated_${i}`, "nb_other");
  })();
  for (const deletedState of [undefined, 0]) {
    await checkBatch(ids.slice(0, 1), deletedState);
    await checkBatch(ids, deletedState);
  }
  await assertMemoNotebookWriteAccess(measuredDb, "ws_t", ids, UNRESTRICTED_NOTEBOOK_ACCESS, "update memos");
  expect(calls).toHaveLength(0);
});

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
    // The whitelist is a set: the expansion CTE's row order is not part of the
    // contract, so compare the granted ids without regard to order.
    expect(withChild.restricted).toBe(parentOnly.restricted);
    expect(withChild.defaultWrite).toBe(parentOnly.defaultWrite);
    expect([...withChild.readableNotebookIds].sort()).toEqual([...parentOnly.readableNotebookIds].sort());
    expect([...withChild.writableNotebookIds].sort()).toEqual([...parentOnly.writableNotebookIds].sort());
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

  test("expansion is pinned to directed index seeks on a fresh database (no ANALYZE)", async () => {
    const db = createFixture();
    seedManyUnrelated(db, 1000, "bulk");
    const { adapter, stats } = countingAdapter(db);
    await resolveNotebookAccess(adapter, "ws_t", [grant("nb_root", "write")], "write");
    const accessSql = stats.accessSql[0];
    const plan = () => db.db.query("EXPLAIN QUERY PLAN " + accessSql)
      .all("ws_t", JSON.stringify(["nb_root"]), "ws_t").map((r) => r.detail).join("\n");

    const before = plan();
    // Seed seeks the whitelist by primary key; the recursion seeks children by
    // parent_id. Neither step may fall back to the deleted-index or a table scan.
    expect(before).toContain("sqlite_autoindex_notebooks_1");
    expect(before).toContain("idx_notebooks_parent");
    expect(before).not.toContain("idx_notebooks_deleted");
    expect(before).not.toMatch(/SCAN notebooks/);

    // The access path must not change as unrelated notebooks accumulate (the
    // planner has no ANALYZE statistics here; INDEXED BY pins it regardless).
    seedManyUnrelated(db, 3000, "bulk_more");
    expect(plan()).toEqual(before);
  });

  test.skipIf(!nativeVmSteps)("real VM cost is constant as unrelated notebooks grow (fresh DB)", async () => {
    // Capture the exact SQL the guard emits, then measure its VM cost through a
    // native progress handler on freshly migrated file databases of growing size.
    const fixture = createFixture();
    const { adapter, stats } = countingAdapter(fixture);
    await resolveNotebookAccess(adapter, "ws_t", [grant("nb_root", "write")], "write");
    const accessSql = stats.accessSql[0];
    // Pre-fix control: the same CTE without the index pins (full live-table scan).
    const unpinnedSql = accessSql
      .replace(/ INDEXED BY sqlite_autoindex_notebooks_1/, "")
      .replace(/ INDEXED BY idx_notebooks_parent/, "");

    const dir = mkdtempSync(join(tmpdir(), "edgeever-read-cost-"));
    const binds = ["ws_t", JSON.stringify(["nb_root"]), "ws_t"];
    // Build the migrated base (workspace + granted subtree) once, then clone it
    // per size and append unrelated notebooks in a single transaction.
    const base = join(dir, "base.sqlite");
    const baseDb = new Database(base, { create: true });
    for (const migration of globSync("migrations/*.sql").sort()) {
      baseDb.exec(readFileSync(migration, "utf8"));
    }
    baseDb.query("INSERT INTO workspaces (id, name, is_personal) VALUES ('ws_t', 'T', 1)").run();
    baseDb.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_root', 'ws_t', 'Root', NULL)").run();
    baseDb.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_child', 'ws_t', 'Child', 'nb_root')").run();
    baseDb.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES ('nb_grandchild', 'ws_t', 'Grandchild', 'nb_child')").run();
    baseDb.close();
    const withUnrelated = (file, n) => {
      copyFileSync(base, file);
      const sqlite = new Database(file);
      const ins = sqlite.query("INSERT INTO notebooks (id, workspace_id, name, parent_id) VALUES (?, 'ws_t', ?, NULL)");
      sqlite.transaction(() => { for (let i = 0; i < n; i++) ins.run(`u_${i}`, `Unrelated ${i}`); })();
      sqlite.close();
    };
    try {
      const sizes = [200, 1000, 4000];
      const fixed = [];
      for (const n of sizes) {
        const file = join(dir, `cost_${n}.sqlite`);
        withUnrelated(file, n);
        fixed.push(nativeVmSteps(file, accessSql, binds));
        rmSync(file);
      }
      // The pinned expansion reads only the granted subtree: its VM cost is
      // identical regardless of how many unrelated notebooks exist.
      expect(fixed[0]).toBeGreaterThan(0);
      expect(fixed[1]).toBe(fixed[0]);
      expect(fixed[2]).toBe(fixed[0]);
      // Sensitivity check: the unpinned full-scan control DOES grow with the
      // notebook count, so this metric would catch a regression to a full scan.
      const small = join(dir, "ctl_small.sqlite");
      const large = join(dir, "ctl_large.sqlite");
      withUnrelated(small, sizes[0]);
      withUnrelated(large, sizes[2]);
      const controlSmall = nativeVmSteps(small, unpinnedSql, binds);
      const controlLarge = nativeVmSteps(large, unpinnedSql, binds);
      expect(controlLarge).toBeGreaterThan(controlSmall * 2);
      expect(fixed[2]).toBeLessThan(controlLarge / 10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});
