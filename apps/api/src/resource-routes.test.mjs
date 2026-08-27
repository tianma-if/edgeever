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
        first: async () => null,
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

const createApp = (auth = agentAuth, getResourceRow = async () => null) => {
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
    getResourceRow,
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

  test("serves PDF attachments inline while preserving their filename", async () => {
    const environment = createEnvironment();
    environment.storage.resources = {
      get: async () => ({
        body: new Blob([new Uint8Array(256)]).stream(),
        size: 256,
        writeHttpMetadata: () => {},
      }),
    };
    const response = await createApp(agentAuth, async () => ({ ...resourceRow, storage_config_id: null })).request(
      "/api/v1/resources/res_1/blob",
      {},
      environment,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toStartWith("inline;");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  });

  test("serves a validated PDF byte range without reading the whole object", async () => {
    const environment = createEnvironment();
    let requestedOptions;
    environment.storage.resources = {
      get: async (_key, options) => {
        requestedOptions = options;
        return {
          body: new Blob([new TextEncoder().encode("2345")]).stream(),
          size: 256,
          range: { offset: 2, length: 4 },
          writeHttpMetadata: () => {},
        };
      },
    };
    const response = await createApp(agentAuth, async () => ({ ...resourceRow, storage_config_id: null })).request(
      "/api/v1/resources/res_1/blob",
      { headers: { Range: "bytes=2-5" } },
      environment,
    );

    expect(requestedOptions).toEqual({ range: { offset: 2, length: 4 } });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/256");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(await response.text()).toBe("2345");
  });

  test("rejects unsatisfiable ranges before object storage is read", async () => {
    const environment = createEnvironment();
    let reads = 0;
    environment.storage.resources = { get: async () => { reads += 1; return null; } };
    const response = await createApp(agentAuth, async () => ({ ...resourceRow, storage_config_id: null })).request(
      "/api/v1/resources/res_1/blob",
      { headers: { Range: "bytes=999-" } },
      environment,
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */256");
    expect(reads).toBe(0);
  });
});
