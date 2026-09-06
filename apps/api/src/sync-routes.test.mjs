import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { registerSyncRoutes } from "./sync-routes.ts";

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

describe("sync route contracts", () => {
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
            if (sql.includes("FROM notebooks")) return { results: [] };
            if (sql.includes("FROM memos m")) return { results: memoRows };
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
