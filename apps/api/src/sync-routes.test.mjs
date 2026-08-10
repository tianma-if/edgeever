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
});
