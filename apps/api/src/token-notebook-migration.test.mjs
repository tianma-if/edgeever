import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  parseNotebookAccessJson,
  parseNotebookAccessLevel,
  resolveNotebookAccess,
} from "./token-notebook-access.ts";

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) {
    return new Statement(this.db, this.sql, bindings);
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
class Adapter {
  constructor(db) {
    this.db = db;
  }
  prepare(sql) {
    return new Statement(this.db, sql);
  }
}

const migrationSql = (name) => readFileSync(`migrations/${name}`, "utf8");

// Applies every migration strictly before 0095, then seeds a workspace with
// two notebooks. Returns the raw bun:sqlite handle.
const seedPre0095 = () => {
  const sqlite = new Database(":memory:");
  for (const file of globSync("migrations/*.sql").sort()) {
    const name = file.split("/").pop();
    if (name >= "0095") continue;
    sqlite.exec(readFileSync(file, "utf8"));
  }
  sqlite.exec(`INSERT INTO workspaces (id, name, is_personal) VALUES ('ws_1', 'W', 1)`);
  sqlite.exec(`INSERT INTO notebooks (id, workspace_id, name) VALUES ('nb_1', 'ws_1', 'One'), ('nb_2', 'ws_1', 'Two')`);
  return sqlite;
};

const seedOldGrants = (sqlite) => {
  sqlite.exec(`INSERT INTO api_tokens (id, workspace_id, name, token_hash, scopes_json, notebook_access_json, notebook_default_access, created_at) VALUES
    ('ro', 'ws_1', 'RO', 'h1', '["read:memos"]', '[{"notebookId":"nb_1","read":true,"write":false}]', 'none', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('rw', 'ws_1', 'RW', 'h2', '["read:memos"]', '[{"notebookId":"nb_1","read":true,"write":true},{"notebookId":"nb_2","read":true,"write":false}]', 'write', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('deny', 'ws_1', 'DENY', 'h3', '["read:memos"]', '[{"notebookId":"nb_1","read":false,"write":false}]', 'none', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('empty', 'ws_1', 'EMPTY', 'h4', '["read:memos"]', '[]', 'read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ('nullg', 'ws_1', 'NULL', 'h6', '["read:memos"]', NULL, 'none', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
};

const rows = (sqlite) =>
  sqlite.query("SELECT id, notebook_access_json, notebook_access_level FROM api_tokens ORDER BY id").all();

const resolve = async (sqlite, id) => {
  const row = sqlite.query("SELECT notebook_access_json, notebook_access_level FROM api_tokens WHERE id = ?").get(id);
  const entries = parseNotebookAccessJson(row.notebook_access_json);
  const level = parseNotebookAccessLevel(row.notebook_access_level);
  return resolveNotebookAccess(new Adapter(sqlite), "ws_1", entries, level);
};

describe("notebook whitelist migration (0095 + 0096)", () => {
  test("fresh install: 0095 emits parser-readable objects and 0096 is a no-op", async () => {
    const sqlite = seedPre0095();
    seedOldGrants(sqlite);
    sqlite.exec(migrationSql("0095_api_token_notebook_whitelist.sql"));
    // Capture effective access before 0096; it must be preserved. (0096 may
    // re-emit per-entry write flags to match the uniform level, which does not
    // change resolution because the level is authoritative.)
    const accessBefore = {};
    for (const id of ["ro", "rw", "deny", "empty", "nullg"]) {
      accessBefore[id] = await resolve(sqlite, id);
    }
    sqlite.exec(migrationSql("0096_api_token_notebook_whitelist_format.sql"));
    for (const id of ["ro", "rw", "deny", "empty", "nullg"]) {
      expect(await resolve(sqlite, id)).toEqual(accessBefore[id]);
    }

    // Every restricted row parses to a non-corrupted whitelist.
    for (const id of ["ro", "rw", "deny", "empty"]) {
      const row = sqlite.query("SELECT notebook_access_json FROM api_tokens WHERE id = ?").get(id);
      expect(parseNotebookAccessJson(row.notebook_access_json)).not.toBeNull();
    }

    expect(await resolve(sqlite, "ro")).toMatchObject({ restricted: true, readableNotebookIds: ["nb_1"], writableNotebookIds: [] });
    const rw = await resolve(sqlite, "rw");
    expect(rw.readableNotebookIds.sort()).toEqual(["nb_1", "nb_2"]);
    expect(rw.writableNotebookIds.sort()).toEqual(["nb_1", "nb_2"]);
    // Explicit deny is dropped under the whitelist model.
    expect((await resolve(sqlite, "deny")).readableNotebookIds).toEqual([]);
    expect((await resolve(sqlite, "empty")).readableNotebookIds).toEqual([]);
    // NULL stays unrestricted.
    expect((await resolve(sqlite, "nullg")).restricted).toBe(false);
  });

  test("upgrade from the string-array 0095: 0096 normalizes to the same result", async () => {
    const sqlite = seedPre0095();
    seedOldGrants(sqlite);
    // Reproduce what the earlier 0095 revision stored: it added the level
    // column and wrote a plain string array plus the resolved level. (An
    // instance that ran it successfully had no corrupt rows.)
    sqlite.exec(`ALTER TABLE api_tokens ADD COLUMN notebook_access_level TEXT`);
    sqlite.exec(`UPDATE api_tokens SET notebook_access_json = '["nb_1"]', notebook_access_level = 'read' WHERE id = 'ro'`);
    sqlite.exec(`UPDATE api_tokens SET notebook_access_json = '["nb_1","nb_2"]', notebook_access_level = 'write' WHERE id = 'rw'`);
    sqlite.exec(`UPDATE api_tokens SET notebook_access_json = '[]', notebook_access_level = 'read' WHERE id IN ('deny','empty')`);

    sqlite.exec(migrationSql("0096_api_token_notebook_whitelist_format.sql"));

    expect(await resolve(sqlite, "ro")).toMatchObject({ restricted: true, readableNotebookIds: ["nb_1"], writableNotebookIds: [] });
    const rw = await resolve(sqlite, "rw");
    expect(rw.readableNotebookIds.sort()).toEqual(["nb_1", "nb_2"]);
    expect(rw.writableNotebookIds.sort()).toEqual(["nb_1", "nb_2"]);
    expect((await resolve(sqlite, "deny")).readableNotebookIds).toEqual([]);
    expect((await resolve(sqlite, "nullg")).restricted).toBe(false);
  });

  test("0096 is idempotent", () => {
    const sqlite = seedPre0095();
    seedOldGrants(sqlite);
    sqlite.exec(migrationSql("0095_api_token_notebook_whitelist.sql"));
    sqlite.exec(migrationSql("0096_api_token_notebook_whitelist_format.sql"));
    const once = rows(sqlite);
    sqlite.exec(migrationSql("0096_api_token_notebook_whitelist_format.sql"));
    expect(rows(sqlite)).toEqual(once);
  });

  test("corrupted and non-array grants fail closed to an empty whitelist", async () => {
    const sqlite = seedPre0095();
    sqlite.exec(`INSERT INTO api_tokens (id, workspace_id, name, token_hash, scopes_json, notebook_access_json, created_at) VALUES
      ('bad', 'ws_1', 'BAD', 'hb', '["read:memos"]', 'corrupted{json', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ('obj', 'ws_1', 'OBJ', 'ho', '["read:memos"]', '{"notebookId":"nb_1"}', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
    sqlite.exec(migrationSql("0095_api_token_notebook_whitelist.sql"));
    sqlite.exec(migrationSql("0096_api_token_notebook_whitelist_format.sql"));
    for (const id of ["bad", "obj"]) {
      const access = await resolve(sqlite, id);
      expect(access.restricted).toBe(true);
      expect(access.readableNotebookIds).toEqual([]);
      expect(access.writableNotebookIds).toEqual([]);
    }
  });

  test("any malformed item fails the WHOLE record closed, matching the parser", async () => {
    const sqlite = seedPre0095();
    // A valid grant mixed with an invalid item must not keep the valid grant:
    // the runtime parser rejects the entire record, so the migration must too.
    sqlite.exec(`INSERT INTO api_tokens (id, workspace_id, name, token_hash, scopes_json, notebook_access_json, created_at) VALUES
      ('mix_empty_obj', 'ws_1', 'A', 'hm1', '["read:memos"]', '[{"notebookId":"nb_1","read":true,"write":false},{}]', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ('mix_missing_rw', 'ws_1', 'B', 'hm2', '["read:memos"]', '[{"notebookId":"nb_1","read":true,"write":false},{"notebookId":"nb_2"}]', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ('mix_empty_id', 'ws_1', 'C', 'hm3', '["read:memos"]', '[{"notebookId":"nb_1","read":true,"write":false},{"notebookId":"","read":true,"write":false}]', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ('mix_nonbool', 'ws_1', 'D', 'hm4', '["read:memos"]', '[{"notebookId":"nb_1","read":true,"write":false},{"notebookId":"nb_2","read":"yes","write":false}]', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
    sqlite.exec(migrationSql("0095_api_token_notebook_whitelist.sql"));
    sqlite.exec(migrationSql("0096_api_token_notebook_whitelist_format.sql"));
    for (const id of ["mix_empty_obj", "mix_missing_rw", "mix_empty_id", "mix_nonbool"]) {
      const row = sqlite.query("SELECT notebook_access_json FROM api_tokens WHERE id = ?").get(id);
      // The stored record must parse to an empty whitelist, not keep nb_1.
      expect(parseNotebookAccessJson(row.notebook_access_json)).toEqual([]);
      const access = await resolve(sqlite, id);
      expect(access.readableNotebookIds).toEqual([]);
      expect(access.writableNotebookIds).toEqual([]);
    }
  });

  test("0095 does not error on a string array; 0096 treats it as a legitimate whitelist", async () => {
    const sqlite = seedPre0095();
    sqlite.exec(`INSERT INTO api_tokens (id, workspace_id, name, token_hash, scopes_json, notebook_access_json, created_at) VALUES
      ('strarr', 'ws_1', 'S', 'hs1', '["read:memos"]', '["nb_1","nb_2"]', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
    // Must not throw "malformed JSON" when 0095 encounters a string array.
    sqlite.exec(migrationSql("0095_api_token_notebook_whitelist.sql"));
    sqlite.exec(migrationSql("0096_api_token_notebook_whitelist_format.sql"));
    const access = await resolve(sqlite, "strarr");
    expect(access.readableNotebookIds.sort()).toEqual(["nb_1", "nb_2"]);
  });

  test("0096 fails closed on mixed / empty-string / non-string arrays", async () => {
    const sqlite = seedPre0095();
    // These rows simulate post-0095 state, so the level column must exist.
    sqlite.exec(`ALTER TABLE api_tokens ADD COLUMN notebook_access_level TEXT`);
    sqlite.exec(`INSERT INTO api_tokens (id, workspace_id, name, token_hash, scopes_json, notebook_access_json, notebook_access_level, created_at) VALUES
      ('mixed', 'ws_1', 'M', 'hx1', '["read:memos"]', '["nb_1",{"notebookId":"nb_2","read":true,"write":false}]', 'read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ('emptystr', 'ws_1', 'E', 'hx2', '["read:memos"]', '["nb_1",""]', 'read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ('number', 'ws_1', 'N', 'hx3', '["read:memos"]', '[1,2]', 'read', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ('nullitem', 'ws_1', 'U', 'hx4', '["read:memos"]', '[null]', 'read', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
    sqlite.exec(migrationSql("0096_api_token_notebook_whitelist_format.sql"));
    for (const id of ["mixed", "emptystr", "number", "nullitem"]) {
      const access = await resolve(sqlite, id);
      expect(access.restricted).toBe(true);
      expect(access.readableNotebookIds).toEqual([]);
    }
  });
});
