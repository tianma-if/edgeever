import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import {
  acquireMaintenanceLease,
  createMemoEditSession,
  fetchEdgeEverApp,
  mergeMemosRecord,
  updateMemoRecord,
} from "./index.ts";

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
};

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

class SqlitePreparedStatement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new SqlitePreparedStatement(this.sqlite, this.sql, bindings);
  }

  async all() {
    return { results: this.sqlite.query(this.sql).all(...this.bindings) };
  }

  async first() {
    return this.sqlite.query(this.sql).get(...this.bindings) ?? null;
  }

  async run() {
    this.sqlite.query(this.sql).run(...this.bindings);
    return { success: true, meta: {} };
  }
}

class SqliteD1Database {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new SqlitePreparedStatement(this.sqlite, sql);
  }

  async batch(statements) {
    const results = [];
    this.sqlite.transaction(() => {
      for (const statement of statements) {
        results.push(this.sqlite.query(statement.sql).run(...statement.bindings));
      }
    })();
    return results;
  }
}

const createDatabase = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const path of globSync("migrations/*.sql").sort()) {
    sqlite.exec(readFileSync(path, "utf8"));
  }
  return { database: new SqliteD1Database(sqlite), sqlite };
};

const getSeedMemo = (sqlite) => sqlite.query(
  `SELECT m.id, m.workspace_id, m.title, m.tags_json, m.notebook_id, m.is_pinned,
          c.revision, c.content_hash
   FROM memos m
   INNER JOIN memo_contents c ON c.memo_id = m.id
   WHERE m.is_deleted = 0
   ORDER BY m.id
   LIMIT 1`,
).get();

describe("database write optimizations", () => {
  test("returns the completed merge when the same source set is retried", async () => {
    const { database, sqlite } = createDatabase();
    const first = getSeedMemo(sqlite);
    const secondId = "memo_merge_retry_source";
    sqlite.query(
      `INSERT INTO memos (id, workspace_id, notebook_id, title, excerpt, tags_json, created_by, updated_by)
       VALUES (?, ?, ?, 'Retry source', 'retry body', '[]', 'user', 'user')`,
    ).run(secondId, first.workspace_id, first.notebook_id);
    sqlite.query(
      `INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_text, content_hash)
       VALUES (?, '{"type":"doc","content":[]}', 'retry body', 'retry body', 'retry-hash')`,
    ).run(secondId);

    const input = { memoIds: [first.id, secondId], title: "Idempotent merge" };
    const actor = { actorType: "user", actorId: "user_owner" };
    const completed = await mergeMemosRecord(database, first.workspace_id, input, actor, "owner");
    const retried = await mergeMemosRecord(database, first.workspace_id, input, actor, "owner");

    expect(retried.id).toBe(completed.id);
    expect(retried.sourceMemoIds).toEqual(input.memoIds);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memos WHERE is_deleted = 0 AND title = 'Idempotent merge'").get().count).toBe(1);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'memo.merge' AND entity_id = ?").get(completed.id).count).toBe(1);
    sqlite.close();
  });

  test("reuses a matching live edit session without another insert", async () => {
    const { database, sqlite } = createDatabase();
    const memo = getSeedMemo(sqlite);
    const auth = {
      kind: "user",
      actorType: "user",
      actorId: "user_owner",
      username: "owner",
      displayName: "Owner",
      scopes: [],
      workspaceId: memo.workspace_id,
      role: "owner",
    };
    const context = {
      env: { storage: { db: database, resources: {} } },
      get: (name) => name === "auth" ? auth : undefined,
    };

    const first = await createMemoEditSession(context, memo.id);
    const countAfterFirst = sqlite.query("SELECT COUNT(*) AS count FROM memo_edit_sessions").get().count;
    const second = await createMemoEditSession(context, memo.id);

    expect(second).toEqual(first);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM memo_edit_sessions").get().count).toBe(countAfterFirst);
    sqlite.close();
  });

  test("returns an unchanged memo without revision, audit, or search writes", async () => {
    const { database, sqlite } = createDatabase();
    const memo = getSeedMemo(sqlite);
    const auditCount = sqlite.query("SELECT COUNT(*) AS count FROM audit_events").get().count;
    const searchRow = sqlite.query(
      "SELECT id, title, content_text, tags FROM memo_search_documents WHERE memo_id = ?",
    ).get(memo.id);

    const result = await updateMemoRecord(
      database,
      memo.workspace_id,
      memo.id,
      { title: memo.title },
      { actorType: "user", actorId: "user_owner" },
      "owner",
    );

    expect(result.memo.revision).toBe(memo.revision);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM audit_events").get().count).toBe(auditCount);
    expect(sqlite.query(
      "SELECT id, title, content_text, tags FROM memo_search_documents WHERE memo_id = ?",
    ).get(memo.id)).toEqual(searchRow);
    sqlite.close();
  });

  test("allows only one live maintenance lease owner", async () => {
    const { database, sqlite } = createDatabase();
    const first = await acquireMaintenanceLease(database, "demo-reset-test", 60_000);
    const second = await acquireMaintenanceLease(database, "demo-reset-test", 60_000);

    expect(first).toStartWith("lease_");
    expect(second).toBeNull();

    sqlite.query(
      "UPDATE maintenance_leases SET expires_at = '2000-01-01T00:00:00.000Z' WHERE name = 'demo-reset-test'",
    ).run();
    expect(await acquireMaintenanceLease(database, "demo-reset-test", 60_000)).toStartWith("lease_");
    sqlite.close();
  });

  test("does not report a demo reset as successful when another reset owns the lease", async () => {
    const { database, sqlite } = createDatabase();
    expect(await acquireMaintenanceLease(database, "demo-reset", 60_000)).toStartWith("lease_");

    const response = await fetchEdgeEverApp(
      new Request("https://notes.example.com/api/v1/demo/reset", { method: "POST" }),
      {
        storage: { db: database, resources: {} },
        EDGE_EVER_ALLOW_UNAUTHENTICATED: "true",
        EDGE_EVER_DEMO_MODE: "true",
      },
      executionContext,
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toMatchObject({
      error: { code: "demo_reset_in_progress" },
    });
    sqlite.close();
  });

  test("does not rewrite current demo seed data while listing notebooks", async () => {
    const { database, sqlite } = createDatabase();
    const resources = {
      put: async () => {},
    };
    const request = () => fetchEdgeEverApp(
      new Request("https://notes.example.com/api/v1/notebooks"),
      {
        storage: { db: database, resources },
        EDGE_EVER_ALLOW_UNAUTHENTICATED: "true",
        EDGE_EVER_DEMO_MODE: "true",
      },
      executionContext,
    );

    expect((await request()).status).toBe(200);
    expect(sqlite.query(
      "SELECT COUNT(*) AS count FROM memos WHERE id IN ('memo_demo_overview', 'memo_demo_overview_en')",
    ).get().count).toBe(2);

    const changesAfterSeed = sqlite.query("SELECT total_changes() AS count").get().count;
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    expect(sqlite.query("SELECT total_changes() AS count").get().count).toBe(changesAfterSeed);

    sqlite.query("UPDATE memos SET title = 'Changed demo title' WHERE id = 'memo_demo_overview'").run();
    const changesBeforeRepair = sqlite.query("SELECT total_changes() AS count").get().count;
    expect((await request()).status).toBe(200);
    expect(sqlite.query("SELECT title FROM memos WHERE id = 'memo_demo_overview'").get().title).not.toBe("Changed demo title");
    expect(sqlite.query("SELECT total_changes() AS count").get().count).toBeGreaterThan(changesBeforeRepair);

    const changesAfterRepair = sqlite.query("SELECT total_changes() AS count").get().count;
    expect((await request()).status).toBe(200);
    expect(sqlite.query("SELECT total_changes() AS count").get().count).toBe(changesAfterRepair);
    sqlite.close();
  });

  test("touches API tokens at most once per hour", async () => {
    const { database, sqlite } = createDatabase();
    const token = "edgeever_api_test_token";
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    sqlite.query(
      `INSERT INTO api_tokens (
         id, workspace_id, name, token_hash, token_value, scopes_json, last_used_at
       ) VALUES ('tok_touch_test', 'ws_default', 'Touch test', ?, ?, '["read:notebooks"]', ?)`,
    ).run(await sha256(token), token, recent);

    const request = () => fetchEdgeEverApp(
      new Request("https://notes.example.com/api/v1/notebooks", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { storage: { db: database, resources: {} }, EDGE_EVER_AUTH_PASSWORD: "configured" },
      executionContext,
    );

    expect((await request()).status).toBe(200);
    expect(sqlite.query("SELECT last_used_at FROM api_tokens WHERE id = 'tok_touch_test'").get().last_used_at).toBe(recent);

    const stale = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    sqlite.query("UPDATE api_tokens SET last_used_at = ? WHERE id = 'tok_touch_test'").run(stale);
    expect((await request()).status).toBe(200);
    expect(sqlite.query("SELECT last_used_at FROM api_tokens WHERE id = 'tok_touch_test'").get().last_used_at).not.toBe(stale);
    sqlite.close();
  });

  test("touches login sessions at most once per hour", async () => {
    const { database, sqlite } = createDatabase();
    const token = "edgeever_session_test_token";
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    const now = new Date().toISOString();
    sqlite.query(
      `INSERT INTO users (id, username, password_hash, display_name)
       VALUES ('user_touch_test', 'touch-test', 'scrypt$placeholder', 'Touch Test')`,
    ).run();
    sqlite.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ('ws_default', 'user_touch_test', 'owner')`,
    ).run();
    sqlite.query(
      `INSERT INTO sessions (
         id, user_id, token_hash, device_id, expires_at, created_at, last_seen_at
       ) VALUES ('session_touch_test', 'user_touch_test', ?, 'test-device', ?, ?, ?)`,
    ).run(await sha256(token), new Date(Date.now() + 60 * 60_000).toISOString(), now, recent);

    const request = () => fetchEdgeEverApp(
      new Request("https://notes.example.com/api/v1/notebooks", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { storage: { db: database, resources: {} }, EDGE_EVER_AUTH_PASSWORD: "configured" },
      executionContext,
    );

    expect((await request()).status).toBe(200);
    expect(sqlite.query("SELECT last_seen_at FROM sessions WHERE id = 'session_touch_test'").get().last_seen_at).toBe(recent);

    const stale = new Date(Date.now() - 61 * 60_000).toISOString();
    sqlite.query("UPDATE sessions SET last_seen_at = ? WHERE id = 'session_touch_test'").run(stale);
    expect((await request()).status).toBe(200);
    expect(sqlite.query("SELECT last_seen_at FROM sessions WHERE id = 'session_touch_test'").get().last_seen_at).not.toBe(stale);
    sqlite.close();
  });
});
