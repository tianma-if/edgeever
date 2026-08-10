import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { registerResourceRoutes } from "./resource-routes.ts";

const resourceRow = {
  id: "res_1",
  memo_id: "memo_1",
  original_memo_id: null,
  bucket_name: "resources",
  object_key: "resource-key",
  storage_config_id: "builtin",
  kind: "attachment",
  mime_type: "application/pdf",
  filename: "report.pdf",
  byte_size: 256,
  sha256: "checksum",
  width: null,
  height: null,
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T00:00:00.000Z",
  memo_title: "Report",
  memo_excerpt: "Quarterly report",
  memo_is_deleted: 0,
};

const agentAuth = {
  kind: "agent",
  actorType: "agent",
  actorId: "token_1",
  username: "automation",
  displayName: null,
  scopes: ["read:resources"],
  workspaceId: "ws_1",
  role: "member",
};

const createEnvironment = () => ({
  storage: {
    db: {
      prepare: (sql) => ({
        bind: () => ({
          all: async () => ({ results: sql.includes("ORDER BY r.created_at") ? [resourceRow] : [] }),
          first: async () => sql.includes("COUNT(*)") ? {
            total_count: 1,
            total_bytes: 256,
            image_count: 0,
            attachment_count: 1,
          } : null,
        }),
      }),
      batch: async () => [],
    },
    resources: {},
  },
});

const createApp = (auth = agentAuth) => {
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", auth);
    await next();
  });
  registerResourceRoutes(app, {
    clampNumber: (value, min, max) => Math.min(Math.max(value, min), max),
    createAttachmentResource: async () => { throw new Error("Unexpected upload"); },
    createImageResource: async () => { throw new Error("Unexpected upload"); },
    getMemoDetail: async () => null,
    getResourceRow: async () => null,
  });
  return app;
};

describe("resource route contracts", () => {
  test("returns mapped resources and aggregate storage usage", async () => {
    const response = await createApp().request(
      "/api/v1/resources?limit=9999",
      {},
      createEnvironment(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resources: [{
        id: "res_1",
        memoId: "memo_1",
        filename: "report.pdf",
        memoTitle: "Report",
      }],
      summary: {
        totalCount: 1,
        totalBytes: 256,
        imageCount: 0,
        attachmentCount: 1,
      },
    });
  });

  test("enforces write scope before parsing an upload", async () => {
    const response = await createApp().request(
      "/api/v1/memos/memo_1/resources",
      { method: "POST" },
      createEnvironment(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });
});
