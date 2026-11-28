import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { registerSyncRoutes } from "./sync-routes.ts";

const applyTableMigrations = (sqlite) => {
  for (const name of ["0100_shared_table_records", "0101_shared_table_memo_references", "0103_shared_table_current_memo_reads"]) {
    sqlite.exec(readFileSync(`migrations/${name}.sql`, "utf8"));
  }
};

const agentAuth = {
  kind: "agent",
  actorType: "agent",
  actorId: "tok_sync",
  username: "sync",
  displayName: null,
  scopes: ["read:notebooks", "read:memos"],
  workspaceId: "ws_1",
  role: "member",
};

const createApp = (auth = agentAuth) => {
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", auth);
    await next();
  });
  registerSyncRoutes(app, {
    clampNumber: (value, min, max) => Math.min(Math.max(value, min), max),
    mapMemoDetail: (row) => ({ id: row.id, title: row.title }),
  });
  return app;
};

const createSyncIntegrationFixture = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE notebooks (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL,
      slug TEXT, icon TEXT, color TEXT, text_color TEXT, color_target TEXT NOT NULL DEFAULT 'icon', is_bold INTEGER NOT NULL DEFAULT 0, icon_inverted INTEGER NOT NULL DEFAULT 0, row_inverted INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE memos (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, notebook_id TEXT NOT NULL, title TEXT,
      excerpt TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]',
      is_pinned INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0, source_memo_ids TEXT NOT NULL DEFAULT '[]',
      merge_source_count INTEGER NOT NULL DEFAULT 0, merged_into_memo_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE memo_contents (
      memo_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, content_json TEXT NOT NULL,
      content_markdown TEXT NOT NULL DEFAULT '', content_text TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE memo_revisions (id TEXT PRIMARY KEY);
    CREATE TABLE mobile_sync_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, operation TEXT NOT NULL
    );
    INSERT INTO workspaces VALUES ('ws_1', '2026-09-09T00:00:00.000Z');
    INSERT INTO notebooks (id, workspace_id, name, slug, is_deleted, created_at, updated_at) VALUES
      ('nb_inbox', 'ws_1', 'Inbox', 'inbox', 0, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z'),
      ('nb_deleted', 'ws_1', 'Deleted', 'deleted', 1, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z'),
      ('nb_child', 'ws_1', 'Recovered child', 'child', 0, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
    UPDATE notebooks SET parent_id = 'nb_deleted' WHERE id = 'nb_child';
    INSERT INTO memos (
      id, workspace_id, notebook_id, title, is_deleted, created_at, updated_at, deleted_at
    ) VALUES (
      'memo_trashed', 'ws_1', 'nb_deleted', 'Trashed', 1,
      '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z'
    );
    INSERT INTO memo_contents (memo_id, revision, content_json, content_markdown, content_text, content_hash) VALUES ('memo_trashed', 1, '{"type":"doc"}', '', '', 'hash');
    INSERT INTO mobile_sync_changes (workspace_id, entity_type, entity_id, operation) VALUES
      ('ws_1', 'memo', 'memo_trashed', 'upsert'),
      ('ws_1', 'notebook', 'nb_child', 'upsert');
  `);
  applyTableMigrations(sqlite);
  const storage = createSelfHostedStorageAdapter(sqlite, "/tmp/edgeever-sync-route-test-unused");
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", agentAuth);
    await next();
  });
  registerSyncRoutes(app, {
    clampNumber: (value, min, max) => Math.min(Math.max(value, min), max),
    mapMemoDetail: (row) => ({
      id: row.id,
      notebookId: row.notebook_id,
      title: row.title,
      isDeleted: row.is_deleted === 1,
    }),
  });
  return { app, sqlite, storage };
};

describe("sync route contracts", () => {
  test("opted-in continuation pages skip global counts and notebook aggregation, retaining the cursor and identity", async () => {
    const fixture = createSyncIntegrationFixture();
    try {
      const queries = [];
      const prepare = fixture.storage.db.prepare.bind(fixture.storage.db);
      fixture.storage.db.prepare = (sql) => { queries.push(sql); return prepare(sql); };
      const request = (query) => fixture.app.request(`/api/v1/sync/bootstrap?${query}`, {}, { storage: fixture.storage });
      const first = await (await request("limit=1&includeMetadata=0")).json();
      expect(first.totalCount).toBe(1);
      expect(first.notebooks.length).toBeGreaterThan(0);
      queries.length = 0;
      const page = await (await request("afterId=memo_0&limit=1&includeMetadata=0")).json();
      expect(page.memos.map((memo) => memo.id)).toEqual(["memo_trashed"]);
      expect(page.totalCount).toBeUndefined();
      expect(page.notebooks).toEqual([]);
      expect(page.syncIdentity).toBe(first.syncIdentity);
      expect(page.snapshotCursor).toBe(first.snapshotCursor);
      expect(page.nextAfterId).toBeNull();
      expect(queries.some((sql) => /COUNT\s*\(|GROUP BY/i.test(sql))).toBe(false);
      const legacy = await (await request("afterId=memo_0&limit=1")).json();
      expect(legacy.totalCount).toBe(1);
      expect(legacy.notebooks).toEqual(first.notebooks);
    } finally { fixture.sqlite.close(); }
  });

  test("keeps bootstrap references inside the active notebook snapshot", async () => {
    const fixture = createSyncIntegrationFixture();
    try {
      const response = await fixture.app.request(
        "/api/v1/sync/bootstrap?limit=200",
        {},
        { storage: fixture.storage },
      );
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.notebooks.map((notebook) => notebook.id)).toEqual(["nb_inbox", "nb_child"]);
      expect(payload.notebooks.find((notebook) => notebook.id === "nb_child")?.parentId).toBeNull();
      expect(payload.memos).toEqual([{
        id: "memo_trashed",
        notebookId: "nb_inbox",
        title: "Trashed",
        isDeleted: true,
      }]);
    } finally {
      fixture.sqlite.close();
    }
  });

  test("remaps dangling memos onto a renamed workspace inbox", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL,
        slug TEXT, icon TEXT, color TEXT, text_color TEXT, color_target TEXT NOT NULL DEFAULT 'icon', is_bold INTEGER NOT NULL DEFAULT 0, icon_inverted INTEGER NOT NULL DEFAULT 0, row_inverted INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE memos (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, notebook_id TEXT NOT NULL, title TEXT,
        excerpt TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]',
        is_pinned INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0, source_memo_ids TEXT NOT NULL DEFAULT '[]',
        merge_source_count INTEGER NOT NULL DEFAULT 0, merged_into_memo_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
      );
      CREATE TABLE memo_contents (
        memo_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, content_json TEXT NOT NULL,
        content_markdown TEXT NOT NULL DEFAULT '', content_text TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL,
        created_at TEXT, updated_at TEXT
      );
      CREATE TABLE memo_revisions (id TEXT PRIMARY KEY);
      CREATE TABLE mobile_sync_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL, operation TEXT NOT NULL
      );
      INSERT INTO workspaces VALUES ('ws_1', '2026-09-10T00:00:00.000Z');
      INSERT INTO notebooks (id, workspace_id, name, slug, is_deleted, created_at, updated_at) VALUES
        ('ws_1_inbox', 'ws_1', '收集箱', 'shou-ji-xiang', 0, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z');
      INSERT INTO memos (
        id, workspace_id, notebook_id, title, is_deleted, created_at, updated_at, deleted_at
      ) VALUES (
        'memo_trashed', 'ws_1', 'nb_deleted', 'Trashed', 1,
        '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z'
      );
      INSERT INTO memo_contents (memo_id, revision, content_json, content_markdown, content_text, content_hash) VALUES ('memo_trashed', 1, '{"type":"doc"}', '', '', 'hash');
    `);
    applyTableMigrations(sqlite);
    const storage = createSelfHostedStorageAdapter(sqlite, "/tmp/edgeever-sync-renamed-inbox-unused");
    const app = new Hono();
    app.use("/api/v1/*", async (context, next) => {
      context.set("auth", agentAuth);
      await next();
    });
    registerSyncRoutes(app, {
      clampNumber: (value, min, max) => Math.min(Math.max(value, min), max),
      mapMemoDetail: (row) => ({
        id: row.id,
        notebookId: row.notebook_id,
        title: row.title,
        isDeleted: row.is_deleted === 1,
      }),
    });
    try {
      const response = await app.request("/api/v1/sync/bootstrap?limit=200", {}, { storage });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.memos[0].notebookId).toBe("ws_1_inbox");
    } finally {
      sqlite.close();
    }
  });

  test("normalizes dangling references in incremental changes", async () => {
    const fixture = createSyncIntegrationFixture();
    try {
      const response = await fixture.app.request(
        "/api/v1/sync/changes?cursor=0&limit=200",
        {},
        { storage: fixture.storage },
      );
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.changes[0].memo.notebookId).toBe("nb_inbox");
      expect(payload.changes[1].notebook.parentId).toBeNull();
    } finally {
      fixture.sqlite.close();
    }
  });

  test("requires both notebook and memo read scopes", async () => {
    const app = createApp({ ...agentAuth, scopes: ["read:memos"] });
    const response = await app.request("/api/v1/sync/bootstrap", {}, {
      storage: {
        db: { prepare: () => { throw new Error("Unexpected database access"); } },
        resources: {},
      },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  test("preserves bootstrap pagination and snapshot metadata", async () => {
    const memoRows = [
      { id: "memo_1", title: "First" },
      { id: "memo_2", title: "Second" },
    ];
    const database = {
      prepare: (sql) => ({
        bind: () => ({
          all: async () => {
            if (sql.includes("FROM memos m")) return { results: memoRows };
            if (sql.includes("FROM notebooks n")) return { results: [] };
            return { results: [] };
          },
          first: async () => {
            if (sql.includes("COUNT(*)")) return { count: 2 };
            if (sql.includes("sync_identity")) {
              return { cursor: 42, sync_identity: "workspace-created-at" };
            }
            return null;
          },
        }),
      }),
    };
    const response = await createApp().request(
      "/api/v1/sync/bootstrap?limit=1",
      {},
      { storage: { db: database, resources: {} } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      notebooks: [],
      memos: [{ id: "memo_1", title: "First" }],
      snapshotCursor: 42,
      syncIdentity: "workspace-created-at",
      totalCount: 2,
      nextAfterId: "memo_1",
    });
  });

  test("loads changes and workspace cursor state in one indexed query", async () => {
    const sqlStatements = [];
    const database = {
      prepare: (sql) => {
        sqlStatements.push(sql);
        return {
          bind: () => ({
            all: async () => ({ results: [{
              id: null,
              entity_type: null,
              entity_id: null,
              operation: null,
              server_cursor: 0,
              sync_identity: "workspace-created-at",
            }] }),
            first: async () => null,
          }),
        };
      },
    };
    const response = await createApp().request(
      "/api/v1/sync/changes?cursor=0&limit=200",
      {},
      { storage: { db: database, resources: {} } },
    );

    expect(response.status).toBe(200);
    expect(sqlStatements).toHaveLength(1);
    const cursorSql = sqlStatements[0];
    expect(cursorSql).toContain("WHERE c.workspace_id = w.id");
    expect(cursorSql).toContain("WHERE workspace_id = ? AND id > ?");
  });

  test("folds repeated entities within a page while preserving the raw page cursor", async () => {
    const database = {
      prepare: (sql) => ({
        bind: () => ({
          all: async () => {
            if (sql.includes("WITH workspace_state")) {
              return {
                results: [
                  { id: 11, entity_type: "memo", entity_id: "memo_1", operation: "upsert", server_cursor: 13, sync_identity: "workspace-created-at" },
                  { id: 12, entity_type: "memo", entity_id: "memo_1", operation: "upsert", server_cursor: 13, sync_identity: "workspace-created-at" },
                  { id: 13, entity_type: "notebook", entity_id: "notebook_1", operation: "delete", server_cursor: 13, sync_identity: "workspace-created-at" },
                ],
              };
            }
            if (sql.includes("FROM memos m")) return { results: [{ id: "memo_1", title: "Latest" }] };
            return { results: [] };
          },
          first: async () => null,
        }),
      }),
    };
    const response = await createApp().request(
      "/api/v1/sync/changes?cursor=10&limit=200",
      {},
      { storage: { db: database, resources: {} } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      changes: [
        {
          cursor: 12,
          entityType: "memo",
          entityId: "memo_1",
          operation: "upsert",
          notebook: null,
          memo: { id: "memo_1", title: "Latest" },
        },
        {
          cursor: 13,
          entityType: "notebook",
          entityId: "notebook_1",
          operation: "delete",
          notebook: null,
          memo: null,
        },
      ],
      cursor: 13,
      hasMore: false,
      serverCursor: 13,
      syncIdentity: "workspace-created-at",
    });
  });

  test("does not fold changes across a raw page boundary", async () => {
    const database = {
      prepare: (sql) => ({
        bind: () => ({
          all: async () => {
            if (sql.includes("WITH workspace_state")) {
              return {
                results: [
                  { id: 21, entity_type: "memo", entity_id: "memo_1", operation: "delete", server_cursor: 22, sync_identity: "workspace-created-at" },
                  { id: 22, entity_type: "memo", entity_id: "memo_1", operation: "upsert", server_cursor: 22, sync_identity: "workspace-created-at" },
                ],
              };
            }
            return { results: [] };
          },
          first: async () => null,
        }),
      }),
    };
    const response = await createApp().request(
      "/api/v1/sync/changes?cursor=20&limit=1",
      {},
      { storage: { db: database, resources: {} } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      changes: [{ cursor: 21, operation: "delete" }],
      cursor: 21,
      hasMore: true,
      serverCursor: 22,
    });
  });

  test("batches detail queries below Cloudflare D1's bound-parameter limit", async () => {
    const changes = Array.from({ length: 200 }, (_, index) => ({
      id: index + 1,
      entity_type: "memo",
      entity_id: `memo_${String(index + 1).padStart(3, "0")}`,
      operation: "upsert",
      server_cursor: 200,
      sync_identity: "workspace-created-at",
    }));
    const detailQueryBindingCounts = [];
    const database = {
      prepare: (sql) => ({
        bind: (...bindings) => {
          if (bindings.length > 100) {
            throw new Error(`D1_ERROR: too many SQL variables (${bindings.length})`);
          }
          return {
            all: async () => {
              if (sql.includes("WITH workspace_state")) return { results: changes };
              if (sql.includes("FROM memos m")) {
                detailQueryBindingCounts.push(bindings.length);
                return {
                  results: bindings.slice(1).map((id) => ({ id, title: `Title ${id}` })),
                };
              }
              return { results: [] };
            },
            first: async () => null,
          };
        },
      }),
    };
    const response = await createApp().request(
      "/api/v1/sync/changes?cursor=0&limit=200",
      {},
      { storage: { db: database, resources: {} } },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.changes).toHaveLength(200);
    expect(body.changes[0]).toMatchObject({ entityId: "memo_001", operation: "upsert" });
    expect(body.changes.at(-1)).toMatchObject({ entityId: "memo_200", operation: "upsert" });
    expect(detailQueryBindingCounts).toEqual([91, 91, 21]);
  });
});

test("bootstrap request/read budget aggregates the notebook catalog and total only once across large snapshots", async () => {
  for (const count of [400, 1200]) {
    const fixture = createSyncIntegrationFixture();
    try {
      const add = fixture.sqlite.prepare("INSERT INTO memos (id,workspace_id,notebook_id,title,created_at,updated_at) VALUES (?,'ws_1','nb_inbox','Budget','2026-01-01','2026-01-01')");
      const content = fixture.sqlite.prepare("INSERT INTO memo_contents (memo_id, revision, content_json, content_markdown, content_text, content_hash) VALUES (?,1,'{}','','','hash')");
      fixture.sqlite.transaction(() => {
        for (let i = 0; i < count; i++) { const id = `budget_${String(i).padStart(6, "0")}`; add.run(id); content.run(id); }
      })();
      const queries = [];
      const prepare = fixture.storage.db.prepare.bind(fixture.storage.db);
      fixture.storage.db.prepare = sql => { queries.push(sql); return prepare(sql); };
      let afterId = null, pages = 0, received = 0;
      do {
        const search = new URLSearchParams({ limit: "200" });
        if (afterId) { search.set("afterId", afterId); search.set("includeMetadata", "0"); }
        const response = await fixture.app.request(`/api/v1/sync/bootstrap?${search}`, {}, { storage: fixture.storage });
        expect(response.status).toBe(200);
        const body = await response.json(); pages++; received += body.memos.length; afterId = body.nextAfterId;
      } while (afterId);
      expect(received).toBe(count + 1);
      expect(pages).toBe(Math.ceil((count + 1) / 200));
      expect(queries.filter(sql => /COUNT\(\*\)/.test(sql)).length).toBe(1);
      expect(queries.filter(sql => /GROUP BY/.test(sql)).length).toBe(1);
      expect(queries.length).toBe(pages * 2 + 2);
    } finally { fixture.sqlite.close(); }
  }
});
