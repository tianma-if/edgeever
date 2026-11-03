import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerBackupRoutes } from "./backup-routes.ts";
import { registerSyncRoutes } from "./sync-routes.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { createMemoRecord, getMemoDetail, mapMemoDetail } from "./memo-service.ts";
import { restoreJsonMemos, restoreJsonNotebooks } from "./backup-service.ts";
import { sha256Bytes } from "./hash-utils.ts";

const cleanups = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
const auth = { kind: "user", actorType: "user", actorId: "backup-test-user", username: "owner", displayName: "Owner", scopes: [], workspaceId: "ws_default", role: "owner" };

const installation = async ({ includeExportIndex = true, includeMemoIdIndex = true } = {}) => {
  const sqlite = new Database(":memory:");
  const migrations = globSync("migrations/*.sql").sort();
  // Start with the existing schema and data, then upgrade it in place.
  for (const file of migrations.filter((file) => !file.endsWith("0080_backup_revision.sql")
    && (includeExportIndex || !file.endsWith("0085_export_cursor_index.sql"))
    && (includeMemoIdIndex || !file.endsWith("0086_memo_id_paging_index.sql")))) sqlite.exec(readFileSync(file, "utf8"));
  const directory = mkdtempSync(join(tmpdir(), "edgeever-backup-protocol-"));
  cleanups.push(() => { sqlite.close(); rmSync(directory, { recursive: true, force: true }); });
  const storage = createSelfHostedStorageAdapter(sqlite, directory);
  const inbox = sqlite.query("SELECT id FROM notebooks WHERE workspace_id = 'ws_default' AND slug = 'inbox'").get().id;
  const note = await createMemoRecord(storage.db, "ws_default", { notebookId: inbox, title: "Before upgrade", contentMarkdown: "original body", tags: ["backup"] }, auth, "owner");
  sqlite.exec(readFileSync("migrations/0080_backup_revision.sql", "utf8"));
  let activeAuth = auth;
  const app = new Hono();
  app.use("/api/v1/*", async (c, next) => { c.set("auth", activeAuth); await next(); });
  registerBackupRoutes(app, { clampNumber: (v, min, max) => Math.min(Math.max(Number.isFinite(v) ? v : min, min), max), getMemoDetail, mapMemoDetail, restoreJsonMemos, restoreJsonNotebooks, sha256Bytes, initiateResourceRestoreUpload: async () => { throw new Error("unused"); } });
  registerSyncRoutes(app, { clampNumber: (v, min, max) => Math.min(Math.max(v, min), max), mapMemoDetail });
  return {
    sqlite, storage, note, inbox,
    revision: (workspace = "ws_default") => String(sqlite.query("SELECT backup_revision FROM workspaces WHERE id = ?").get(workspace).backup_revision),
    request: (path) => app.request(path, {}, { storage }),
    setAuth: (value) => { activeAuth = value; },
  };
};

const pageUrl = (state, kind = "memos", after = "") => `/api/v1/backups/data?${new URLSearchParams({ kind, identity: state.identity, revision: state.backupRevision, after, limit: "1" })}`;

describe("consistent backup reads across a real schema upgrade", () => {
  test("upgrades populated backup and bootstrap pages to workspace-scoped ID seeks without changing their data", async () => {
    const db = await installation({ includeMemoIdIndex: false });
    db.sqlite.exec("INSERT INTO workspaces(id,name) VALUES('ws_other','Other'); INSERT INTO notebooks(id,workspace_id,name) VALUES('nb_other','ws_other','Other');");
    const addMemo = db.sqlite.query(`INSERT INTO memos
      (id,workspace_id,notebook_id,title,tags_json,is_deleted,deleted_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    const addContent = db.sqlite.query(`INSERT INTO memo_contents
      (memo_id,content_json,content_markdown,content_text,content_hash,revision) VALUES(?,?,?,?,?,2)`);
    db.sqlite.transaction(() => {
      for (let index = 0; index < 64; index++) for (const workspaceId of ["ws_default", "ws_other"]) {
        const id = `memo_paging_${String(index).padStart(3, "0")}_${workspaceId}`;
        const deleted = index % 4 === 0;
        const body = `Body ${id}`;
        addMemo.run(id, workspaceId, workspaceId === "ws_default" ? db.inbox : "nb_other", `Title ${index}`, '["paging"]',
          Number(deleted), deleted ? "2021-02-03T00:00:00.000Z" : null, "2020-01-01T00:00:00.000Z", "2021-02-03T00:00:00.000Z");
        addContent.run(id, JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] }), body, body, `hash-${id}`);
        db.sqlite.query("INSERT INTO resources(id,memo_id,object_key,kind,byte_size,filename) VALUES(?,?,?,'attachment',4,'sample.txt')").run(`resource_${id}`, id, `object_${id}`);
        db.sqlite.query("INSERT INTO memo_revisions(id,memo_id,revision,content_json,content_markdown,content_text,content_hash,created_by) VALUES(?,?,1,'{\"type\":\"doc\",\"content\":[]}','Previous','Previous','previous','user')").run(`revision_${id}`, id);
      }
    })();
    const originalMemos = db.sqlite.query("SELECT * FROM memos ORDER BY id").all();
    const dataSnapshot = () => Object.fromEntries([
      ["memos", "id"], ["memo_contents", "memo_id"], ["resources", "id"], ["memo_revisions", "id"], ["notebooks", "id"], ["workspaces", "id"],
    ].map(([table, key]) => [table, db.sqlite.query(`SELECT * FROM ${table} ORDER BY ${key}`).all()]));
    const beforeData = dataSnapshot();
    const pageQueries = [];
    const prepare = db.storage.db.prepare.bind(db.storage.db);
    db.storage.db.prepare = (sql) => {
      const statement = prepare(sql), bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        if (sql.includes("INNER JOIN memo_contents") && sql.includes("ORDER BY m.id ASC")) pageQueries.push({ sql, values });
        return bind(...values);
      };
      return statement;
    };
    const readAll = async () => {
      const values = {};
      for (const workspaceId of ["ws_default", "ws_other"]) {
        db.setAuth({ ...auth, workspaceId });
        const state = await (await db.request("/api/v1/backups/state")).json();
        const backup = [];
        let after = "";
        do {
          const response = await db.request(`/api/v1/backups/data?${new URLSearchParams({ kind: "memos", identity: state.identity, revision: state.backupRevision, after, limit: "7" })}`);
          expect(response.status).toBe(200);
          const page = await response.json();
          backup.push(page); after = page.nextCursor;
        } while (after !== null);
        const bootstrap = [];
        after = "";
        do {
          // No opt-in flags: preserve the metadata and defaults used by old clients.
          const response = await db.request(`/api/v1/sync/bootstrap?${new URLSearchParams({ afterId: after, limit: "7" })}`);
          expect(response.status).toBe(200);
          const page = await response.json();
          bootstrap.push(page); after = page.nextAfterId;
        } while (after !== null);
        const expected = originalMemos.filter(memo => memo.workspace_id === workspaceId);
        expect(backup.flatMap(page => page.memos.map(memo => memo.id))).toEqual(expected.filter(memo => !memo.is_deleted).map(memo => memo.id));
        expect(bootstrap.flatMap(page => page.memos.map(memo => memo.id))).toEqual(expected.map(memo => memo.id));
        expect(backup.flatMap(page => page.resources)).toHaveLength(48);
        expect(backup.flatMap(page => page.revisions)).toHaveLength(48);
        values[workspaceId] = { state, backup, bootstrap };
      }
      return values;
    };
    // Keep the planner's ordinary pre-migration statistics: no ANALYZE warm-up.
    const before = await readAll();
    const explain = ({ sql, values }) => db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...values);
    expect(pageQueries.some(query => explain(query).some(row => row.parent === 0 && row.detail.includes("TEMP B-TREE FOR ORDER BY")))).toBe(true);
    pageQueries.length = 0;
    db.sqlite.exec(readFileSync("migrations/0086_memo_id_paging_index.sql", "utf8"));
    expect(dataSnapshot()).toEqual(beforeData);
    expect(await readAll()).toEqual(before);
    expect(pageQueries.length).toBeGreaterThan(2);
    for (const query of pageQueries) {
      const plan = explain(query);
      expect(plan.some(row => row.detail.includes("idx_memos_workspace_id (workspace_id=? AND id>?)"))).toBe(true);
      // Bootstrap's orphan-notebook fallback may sort; only the main page must not.
      expect(plan.some(row => row.parent === 0 && row.detail.includes("TEMP B-TREE FOR ORDER BY"))).toBe(false);
    }
    expect(db.sqlite.query("SELECT name FROM sqlite_master WHERE name='idx_memos_workspace_created_export'").get()).not.toBeNull();
  });

  test("upgrades existing data to indexed, stable browser-export continuation pages", async () => {
    const db = await installation({ includeExportIndex: false, includeMemoIdIndex: false });
    for (let index = 0; index < 60; index++) await createMemoRecord(db.storage.db, "ws_default", {
      notebookId: db.inbox, title: `Cursor ${index}`, contentMarkdown: `Body ${index}`, tags: ["budget"],
      createdAt: index % 2 ? "2020-01-02T00:00:00.000Z" : "2020-01-01T00:00:00.000Z",
    }, auth, "owner");
    const snapshot = () => db.sqlite.query("SELECT m.*, c.content_markdown, c.content_json, c.content_hash, c.revision FROM memos m JOIN memo_contents c ON c.memo_id=m.id ORDER BY m.id").all();
    const before = snapshot();
    db.sqlite.exec(readFileSync("migrations/0085_export_cursor_index.sql", "utf8"));
    expect(snapshot()).toEqual(before);
    const expected = db.sqlite.query("SELECT id FROM memos WHERE workspace_id='ws_default' AND is_deleted=0 ORDER BY created_at,id").all().map(row => row.id);
    for (const endpoint of ["backups/json", "exports/markdown"]) {
      const queries = [], prepare = db.storage.db.prepare.bind(db.storage.db);
      db.storage.db.prepare = sql => {
        const statement = prepare(sql), bind = statement.bind.bind(statement);
        statement.bind = (...values) => {
          if (/SELECT m\.id, m\.notebook_id/.test(sql)) queries.push({ sql, values });
          return bind(...values);
        };
        return statement;
      };
      let cursor, offset = 0;
      const ids = [];
      do {
        const search = new URLSearchParams({ limit: "7", offset: String(offset) });
        if (cursor) search.set("cursor", cursor);
        const response = await db.request(`/api/v1/${endpoint}?${search}`);
        expect(response.status).toBe(200);
        const page = await response.json();
        expect(page.totalCount).toBe(cursor ? undefined : expected.length);
        ids.push(...page.memos.map(memo => memo.id));
        expect(page.nextOffset).toBe(page.nextCursor === null ? null : ids.length);
        expect(page.nextCursor === null || typeof page.nextCursor === "string").toBe(true);
        cursor = page.nextCursor; offset = page.nextOffset;
      } while (cursor);
      expect(ids).toEqual(expected);
      expect(new Set(ids).size).toBe(expected.length);
      for (const { sql, values } of queries.slice(1)) {
        expect(sql).not.toContain("OFFSET");
        const plan = db.sqlite.query(`EXPLAIN QUERY PLAN ${sql}`).all(...values).map(row => row.detail).join("\n");
        expect(plan).toContain("idx_memos_workspace_created_export");
        expect(plan).not.toContain("TEMP B-TREE");
      }
      // Old clients still receive their historical fields and creation-time order.
      const legacy = await (await db.request(`/api/v1/${endpoint}?limit=7&offset=7`)).json();
      expect(legacy.totalCount).toBe(expected.length);
      expect(legacy.memos.map(memo => memo.id)).toEqual(expected.slice(7,14));
      const selectedIds = expected.filter((_, index) => index % 3 === 1).slice(0, 12);
      const selected = [];
      cursor = undefined;
      do {
        const search = new URLSearchParams({ limit: "3", ids: selectedIds.join(",") });
        if (cursor) search.set("cursor", cursor);
        const response = await db.request(`/api/v1/${endpoint}?${search}`);
        const page = await response.json();
        expect(response.status).toBe(200);
        selected.push(...page.memos.map(memo => memo.id));
        expect(page.nextOffset).toBe(page.nextCursor === null ? null : selected.length);
        cursor = page.nextCursor;
      } while (cursor);
      expect(selected).toEqual(endpoint === "exports/markdown" ? selectedIds : expected);
      db.storage.db.prepare = prepare;
    }
  });

  test("validates only the new export cursor and supports explicitly requested continuation totals", async () => {
    const db = await installation();
    const total = db.sqlite.query("SELECT COUNT(*) AS n FROM memos WHERE workspace_id='ws_default' AND is_deleted=0").get().n;
    for (const endpoint of ["backups/json", "exports/markdown"]) {
      for (const cursor of ["", "not-json", "null", JSON.stringify({ id: "memo", createdAt: "date", offset: -1 })]) {
        const response = await db.request(`/api/v1/${endpoint}?${new URLSearchParams({ cursor })}`);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: "invalid_export_cursor" } });
      }
      const first = await (await db.request(`/api/v1/${endpoint}?limit=1`)).json();
      expect(first.totalCount).toBe(total);
      expect(typeof first.nextCursor).toBe("string");
      const next = await (await db.request(`/api/v1/${endpoint}?${new URLSearchParams({ limit: "1", cursor: first.nextCursor, includeTotal: "1" })}`)).json();
      expect(next.totalCount).toBe(first.totalCount);
      expect(next.memos[0].id).not.toBe(first.memos[0].id);
      expect(next.nextOffset).toBe(total > 2 ? 2 : null);
    }
  });

  test("keeps existing data and old export callers usable, with a separate revision", async () => {
    const db = await installation();
    expect(db.revision()).toBe("0");
    expect((await db.request("/api/v1/backups/json")).status).toBe(200);
    const response = await db.request("/api/v1/backups/state");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const state = await response.json();
    expect(state).toMatchObject({ protocolVersion: 1, userId: auth.actorId, workspaceId: "ws_default", backupRevision: "0" });
    expect(state.counts.memos).toBeGreaterThan(0);
    const page = await (await db.request(pageUrl(state))).json();
    expect(page.memos).toHaveLength(1);
    expect(typeof page.nextCursor).toBe("string");
    const ids = page.memos.map((memo) => memo.id);
    let cursor = page.nextCursor;
    while (cursor !== null) {
      const next = await (await db.request(pageUrl(state, "memos", cursor))).json();
      ids.push(...next.memos.map((memo) => memo.id));
      cursor = next.nextCursor;
    }
    expect(new Set(ids).size).toBe(state.counts.memos);
    expect(ids).toContain(db.note.id);
  });

  test("rejects stale pages after deletion instead of silently skipping notes", async () => {
    const db = await installation();
    const state = await (await db.request("/api/v1/backups/state")).json();
    expect((await db.request(pageUrl(state))).status).toBe(200);
    db.sqlite.query("UPDATE memos SET is_deleted = 1 WHERE id = ?").run(db.note.id);
    const stale = await db.request(pageUrl(state));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "backup_source_changed" } });
    expect((await db.request("/api/v1/backups/json")).status).toBe(200);
  });

  test("counts the source only for snapshots, never for each backup page", async () => {
    const db = await installation();
    const queries = [];
    const prepare = db.storage.db.prepare.bind(db.storage.db);
    db.storage.db.prepare = (sql) => { queries.push(sql); return prepare(sql); };
    const state = await (await db.request("/api/v1/backups/state")).json();
    const isFullCount = (sql) => /COUNT\s*\(/i.test(sql) && /backup_revision/.test(sql);
    expect(queries.filter(isFullCount)).toHaveLength(1);
    queries.length = 0;
    for (const kind of ["memos", "notebooks", "prompts"]) {
      let after = "";
      let count = 0;
      do {
        const response = await db.request(pageUrl(state, kind, after));
        expect(response.status).toBe(200);
        const page = await response.json();
        count += page[kind].length;
        after = page.nextCursor;
      } while (after !== null);
      expect(count).toBe(state.counts[kind]);
    }
    expect(queries.filter(isFullCount)).toHaveLength(0);
    const final = await (await db.request("/api/v1/backups/state")).json();
    expect(final).toEqual(state);
    expect(queries.filter(isFullCount)).toHaveLength(1);
  });

  for (const endpoint of ["backups/json", "exports/markdown"]) test(`${endpoint} can traverse continuation pages without recounting or leaking lookahead resources`, async () => {
    const db = await installation();
    const memos = db.sqlite.query("SELECT id FROM memos WHERE workspace_id = 'ws_default' AND is_deleted = 0 ORDER BY created_at, id").all();
    for (const [index, memo] of memos.entries()) {
      db.sqlite.query("INSERT INTO resources (id,memo_id,object_key,kind,byte_size) VALUES (?,?,?,'attachment',4)").run(`resource-${index}`, memo.id, `object-${index}`);
    }
    const queries = [];
    const prepare = db.storage.db.prepare.bind(db.storage.db);
    db.storage.db.prepare = (sql) => { queries.push(sql); return prepare(sql); };
    let offset = 0;
    const ids = [];
    const resourceIds = [];
    do {
      const response = await db.request(`/api/v1/${endpoint}?limit=1&offset=${offset}&includeTotal=0`);
      expect(response.status).toBe(200);
      const page = await response.json();
      if (offset === 0) expect(page.totalCount).toBe(memos.length);
      else expect(page.totalCount).toBeUndefined();
      expect(page.memos).toHaveLength(1);
      expect(page.resources.every((resource) => resource.memoId === page.memos[0].id)).toBe(true);
      ids.push(...page.memos.map((memo) => memo.id));
      resourceIds.push(...page.resources.map((resource) => resource.id));
      offset = page.nextOffset;
    } while (offset !== null);
    expect(ids).toEqual(memos.map((memo) => memo.id));
    expect(new Set(resourceIds).size).toBe(memos.length);
    expect(queries.filter((sql) => /COUNT\s*\(/i.test(sql))).toHaveLength(1);
    const legacy = await (await db.request(`/api/v1/${endpoint}?limit=1&offset=1`)).json();
    expect(legacy.totalCount).toBe(memos.length);
  });

  for (const change of ["revision", "identity"]) test(`rejects a ${change} change while assembling a page`, async () => {
    const db = await installation();
    const state = await (await db.request("/api/v1/backups/state")).json();
    const prepare = db.storage.db.prepare.bind(db.storage.db);
    let checks = 0;
    db.storage.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (!/FROM workspaces/.test(sql)) return statement;
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        const bound = bind(...values);
        const first = bound.first.bind(bound);
        bound.first = async (...args) => {
          if (++checks === 2) {
            if (change === "revision") db.sqlite.query("UPDATE memo_contents SET content_markdown = 'Changed during read' WHERE memo_id = ?").run(db.note.id);
            else db.sqlite.exec("UPDATE workspaces SET created_at = 'replacement-instance' WHERE id = 'ws_default'");
          }
          return first(...args);
        };
        return bound;
      };
      return statement;
    };
    const response = await db.request(pageUrl(state));
    expect(checks).toBe(2);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "backup_source_changed" } });
  });

  test("covers content, revisions, resources, prompts and deletions in their transaction", async () => {
    const db = await installation();
    const changes = [
      () => db.sqlite.query("UPDATE memo_contents SET content_markdown = 'changed' WHERE memo_id = ?").run(db.note.id),
      () => db.sqlite.query("INSERT INTO memo_revisions (id,memo_id,revision,content_json,content_hash,created_by) VALUES ('backup-revision',?,1,'{\"type\":\"doc\",\"content\":[]}','test','user')").run(db.note.id),
      () => db.sqlite.exec("DELETE FROM memo_revisions WHERE id = 'backup-revision'"),
      () => db.sqlite.query("INSERT INTO resources (id,memo_id,object_key,kind,byte_size) VALUES ('backup-resource',?,'backup-object','attachment',4)").run(db.note.id),
      () => db.sqlite.exec("UPDATE resources SET filename = 'changed.txt' WHERE id = 'backup-resource'"),
      () => db.sqlite.exec("DELETE FROM resources WHERE id = 'backup-resource'"),
      () => db.sqlite.exec("UPDATE ai_prompt_templates SET description = 'changed' WHERE workspace_id = 'ws_default'"),
      () => db.sqlite.query("UPDATE notebooks SET name = 'Changed inbox' WHERE id = ?").run(db.inbox),
    ];
    for (const mutate of changes) {
      const before = BigInt(db.revision());
      mutate();
      expect(BigInt(db.revision())).toBeGreaterThan(before);
    }
    const before = db.revision();
    expect(() => db.sqlite.transaction(() => { changes[0](); throw new Error("rollback"); })()).toThrow("rollback");
    expect(db.revision()).toBe(before);
    const restored = await restoreJsonMemos(db.storage.db, "ws_default", [{ memo: db.note, revisions: [], resources: [] }]);
    expect(restored).toBeUndefined();
    expect(BigInt(db.revision())).toBeGreaterThan(BigInt(before));
  });

  test("keeps workspace counters isolated and invalidates both sides of a move", async () => {
    const db = await installation();
    db.sqlite.exec("INSERT INTO workspaces (id,name) VALUES ('ws_other','Other'); INSERT INTO notebooks (id,name,workspace_id) VALUES ('nb_move','Move','ws_default');");
    expect(db.revision("ws_other")).toBe("0");
    const before = db.revision();
    db.sqlite.exec("UPDATE notebooks SET workspace_id = 'ws_other' WHERE id = 'nb_move'");
    expect(BigInt(db.revision())).toBeGreaterThan(BigInt(before));
    expect(BigInt(db.revision("ws_other"))).toBeGreaterThan(0n);
    db.setAuth({ ...auth, workspaceId: "ws_other", actorId: "other-user" });
    const state = await (await db.request("/api/v1/backups/state")).json();
    const page = await (await db.request(pageUrl(state, "notebooks"))).json();
    expect(page.notebooks.map((n) => n.id)).toEqual(["nb_move"]);
  });

  test("retains prompt and notebook permissions and rejects missing consistency context", async () => {
    const db = await installation();
    const state = await (await db.request("/api/v1/backups/state")).json();
    expect((await db.request("/api/v1/backups/data?kind=memos")).status).toBe(400);
    db.setAuth({ ...auth, kind: "agent", scopes: ["read:memos", "read:resources"] });
    expect((await db.request(pageUrl(state, "prompts"))).status).toBe(403);
    expect((await db.request(pageUrl(state, "notebooks"))).status).toBe(403);
    expect((await db.request("/api/v1/backups/json")).status).toBe(200);
  });
});
