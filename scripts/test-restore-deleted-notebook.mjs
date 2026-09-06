import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { Database } from "bun:sqlite";
import worker from "../apps/api/src/index.ts";

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
    return {
      results: this.db.query(this.sql).all(...this.bindings),
      success: true,
      meta: {},
    };
  }

  async first() {
    return this.db.query(this.sql).get(...this.bindings) ?? null;
  }

  async run() {
    this.db.query(this.sql).run(...this.bindings);
    return {
      success: true,
      meta: {},
    };
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
    const results = [];
    this.db.transaction(() => {
      for (const statement of statements) {
        results.push(this.db.query(statement.sql).run(...statement.bindings));
      }
    })();
    return results;
  }
}

const applyMigrations = (db) => {
  for (const file of globSync("migrations/*.sql").sort()) {
    db.exec(readFileSync(file, "utf8"));
  }
};

const createEnv = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);

  return {
    sqlite,
    env: {
      DB: new SqliteD1Database(sqlite),
      EDGE_EVER_ALLOW_UNAUTHENTICATED: "true",
      RESOURCES: {
        delete: async () => undefined,
        get: async () => null,
        put: async () => undefined,
      },
    },
  };
};

const fetchWorker = async (env, path, init = {}) =>
  worker.fetch(
    new Request(`https://edgeever.test${path}`, init),
    env,
    {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
    }
  );

const assertStatus = async (response, status) => {
  if (response.status !== status) {
    assert.fail(`Expected status ${status}, got ${response.status}: ${await response.text()}`);
  }
};

const { sqlite, env } = createEnv();

sqlite.run(
  `INSERT INTO notebooks (id, parent_id, name, slug, icon, color, sort_order)
   VALUES ('nb_bug', NULL, 'Bug Notebook', 'bug-notebook', 'notebook', '#000000', 99)`
);
sqlite.run(
  `INSERT INTO memos (id, notebook_id, title, excerpt, tags_json, created_by, updated_by)
   VALUES ('memo_bug', 'nb_bug', 'Bug Memo', 'Bug', '[]', 'test', 'test')`
);
sqlite.run(
  `INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_text, content_hash, revision)
   VALUES (
     'memo_bug',
     '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Bug"}]}]}',
     'Bug',
     'Bug',
     'hash',
     0
   )`
);
sqlite.run(
  `INSERT INTO memo_search_documents (memo_id, title, content_text, tags)
   VALUES ('memo_bug', 'Bug Memo', 'Bug', '')`
);

let response = await fetchWorker(env, "/api/v1/memos/memo_bug", { method: "DELETE" });
await assertStatus(response, 200);

response = await fetchWorker(env, "/api/v1/notebooks/nb_bug", { method: "DELETE" });
await assertStatus(response, 200);

response = await fetchWorker(env, "/api/v1/memos/memo_bug/restore", { method: "POST" });
await assertStatus(response, 200);

const body = await response.json();
assert.equal(body.memo.id, "memo_bug");
assert.equal(body.memo.isDeleted, false);
assert.equal(body.memo.notebookId, "nb_inbox");

const restored = sqlite
  .query(
    `SELECT m.notebook_id, m.is_deleted, deleted_notebook.is_deleted AS old_notebook_deleted
     FROM memos m
     INNER JOIN notebooks deleted_notebook ON deleted_notebook.id = 'nb_bug'
     WHERE m.id = 'memo_bug'`
  )
  .get();

assert.deepEqual(restored, {
  notebook_id: "nb_inbox",
  is_deleted: 0,
  old_notebook_deleted: 1,
});

console.log("restore-deleted-notebook regression passed");
