import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  MAX_MARKDOWN_EXPORT_MEMO_IDS,
  mapJsonBackupRevision,
  parseMarkdownExportMemoIds,
  registerBackupRoutes,
} from "./backup-routes.ts";

const userAuth = {
  kind: "user",
  actorType: "user",
  actorId: "user_1",
  username: "owner",
  displayName: "Owner",
  scopes: [],
  workspaceId: "ws_1",
  role: "owner",
};

const agentAuth = {
  kind: "agent",
  actorType: "agent",
  actorId: "tok_backup",
  username: "backup-agent",
  displayName: null,
  scopes: ["read:memos", "read:resources"],
  workspaceId: "ws_1",
  role: "member",
};

const memoRow = {
  id: "memo_1",
  notebook_id: "nb_1",
  title: "Backup memo",
  excerpt: "Excerpt",
  tags_json: "[]",
  is_pinned: 0,
  is_archived: 0,
  is_deleted: 0,
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T00:00:00.000Z",
  deleted_at: null,
  revision: 1,
  content_json: '{"type":"doc","content":[]}',
  content_markdown: "Body",
  content_text: "Body",
  content_hash: "hash",
  source_memo_ids: "[]",
  merge_source_count: 0,
  merged_into_memo_id: null,
};

const resourceRow = {
  id: "res_1",
  memo_id: "memo_1",
  original_memo_id: null,
  bucket_name: "resources",
  object_key: "object-key",
  storage_config_id: "builtin",
  kind: "attachment",
  mime_type: "text/plain",
  filename: "note.txt",
  byte_size: 4,
  sha256: "checksum",
  width: null,
  height: null,
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T00:00:00.000Z",
};

const createDatabase = () => {
  const statements = [];
  return {
    statements,
    prepare: (sql) => ({
      bind: (...args) => {
        statements.push({ sql, args });
        return {
          all: async () => {
            if (sql.includes("FROM memos m")) return { results: [memoRow] };
            if (sql.includes("FROM resources")) return { results: [resourceRow] };
            return { results: [] };
          },
          first: async () => sql.includes("COUNT(*)") ? { count: 2 } : null,
        };
      },
    }),
  };
};

const createDependencies = (overrides = {}) => ({
  clampNumber: (value, min, max) => Math.min(Math.max(value, min), max),
  getMemoDetail: async () => null,
  mapMemoDetail: (row) => ({ id: row.id, title: row.title }),
  restoreJsonMemos: async () => {},
  restoreJsonNotebooks: async () => {},
  sha256Bytes: async () => "checksum",
  initiateResourceRestoreUpload: async () => { throw new Error("Unexpected restore upload"); },
  ...overrides,
});

const createApp = (dependencies, auth = agentAuth) => {
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", auth);
    await next();
  });
  registerBackupRoutes(app, dependencies);
  return app;
};

describe("backup route contracts", () => {
  test("requires both memo and resource read scopes", async () => {
    const response = await createApp(
      createDependencies(),
      { ...agentAuth, scopes: ["read:memos"] },
    ).request("/api/v1/exports/markdown", {}, {
      storage: {
        db: { prepare: () => { throw new Error("Unexpected database access"); } },
        resources: {},
      },
    });

    expect(response.status).toBe(403);
  });

  test("returns a paginated export with mapped resources", async () => {
    const database = createDatabase();
    const response = await createApp(createDependencies()).request(
      "/api/v1/exports/markdown?limit=1&offset=0",
      {},
      { storage: { db: database, resources: {} } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      memos: [{ id: "memo_1", title: "Backup memo" }],
      resources: [{ id: "res_1", memoId: "memo_1", filename: "note.txt" }],
      totalCount: 2,
      nextOffset: 1,
    });
    expect(database.statements.some((statement) => statement.sql.includes("json_each"))).toBe(false);
  });

  test("filters markdown export pages to requested memo ids in the current workspace", async () => {
    const database = createDatabase();
    const response = await createApp(createDependencies()).request(
      "/api/v1/exports/markdown?ids=memo_1,memo_missing&limit=50&offset=0",
      {},
      { storage: { db: database, resources: {} } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      memos: [{ id: "memo_1", title: "Backup memo" }],
      resources: [{ id: "res_1", memoId: "memo_1", filename: "note.txt" }],
    });
    const memoQuery = database.statements.find((statement) => statement.sql.includes("FROM memos m"));
    expect(memoQuery.sql).toContain("json_each(?)");
    expect(memoQuery.sql).toContain("m.workspace_id = ?");
    expect(memoQuery.sql).toContain("m.is_deleted = 0");
    expect(memoQuery.args[0]).toBe("ws_1");
    expect(JSON.parse(memoQuery.args[1])).toEqual(["memo_1", "memo_missing"]);
  });

  test("rejects markdown export requests that exceed the batch size", async () => {
    const ids = Array.from({ length: MAX_MARKDOWN_EXPORT_MEMO_IDS + 1 }, (_, index) => `memo_${index}`).join(",");
    const response = await createApp(createDependencies()).request(
      `/api/v1/exports/markdown?ids=${ids}`,
      {},
      {
        storage: {
          db: { prepare: () => { throw new Error("Unexpected database access"); } },
          resources: {},
        },
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "bad_request" },
    });
  });

  test("returns an empty markdown export page when ids is present but empty", async () => {
    const response = await createApp(createDependencies()).request(
      "/api/v1/exports/markdown?ids=",
      {},
      {
        storage: {
          db: { prepare: () => { throw new Error("Unexpected database access"); } },
          resources: {},
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      memos: [],
      resources: [],
      totalCount: 0,
      nextOffset: null,
      nextCursor: null,
    });
  });

  test("parses markdown export memo ids without interpolating them into SQL", () => {
    expect(parseMarkdownExportMemoIds(undefined)).toEqual({ ids: null });
    expect(parseMarkdownExportMemoIds("")).toEqual({ ids: [] });
    expect(parseMarkdownExportMemoIds(" memo_1, memo_2, memo_1 ")).toEqual({ ids: ["memo_1", "memo_2"] });
    expect(parseMarkdownExportMemoIds(Array.from({ length: 101 }, (_, index) => `memo_${index}`).join(","))).toEqual({
      ids: null,
      error: "too_many",
    });
  });

  test("allows only user sessions to restore notebooks", async () => {
    let restored;
    const dependencies = createDependencies({
      restoreJsonNotebooks: async (...args) => {
        restored = args;
      },
    });
    const payload = {
      notebooks: [{
        id: "nb_1",
        parentId: null,
        name: "Inbox",
        slug: "inbox",
        icon: null,
        color: null,
        sortOrder: 0,
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
      }],
    };

    const denied = await createApp(dependencies).request(
      "/api/v1/restores/json/notebooks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      { storage: { db: createDatabase(), resources: {} } },
    );
    expect(denied.status).toBe(403);

    const allowed = await createApp(dependencies, userAuth).request(
      "/api/v1/restores/json/notebooks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      { storage: { db: createDatabase(), resources: {} } },
    );
    expect(allowed.status).toBe(200);
    expect(restored.slice(1)).toEqual(["ws_1", payload.notebooks]);
  });

  test("initializes a resumable resource restore with the original resource id", async () => {
    let received;
    const metadata = {
      id: "res_restore",
      memoId: "memo_1",
      originalMemoId: null,
      kind: "attachment",
      mimeType: "application/octet-stream",
      filename: "archive.bin",
      byteSize: 600 * 1024 * 1024,
      sha256: "checksum",
      width: null,
      height: null,
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:00.000Z",
      archivePath: "resources/res_restore/archive.bin",
    };
    const response = await createApp(createDependencies({
      initiateResourceRestoreUpload: async (_context, input) => {
        received = input;
        return {
          id: "upload_restore",
          resourceId: input.id,
          partSize: 8 * 1024 * 1024,
          partCount: 75,
          byteSize: input.byteSize,
          expiresAt: "2026-09-01T00:00:00.000Z",
        };
      },
    }), userAuth).request(
      "/api/v1/restores/json/resources/res_restore/uploads",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      },
      { storage: { db: createDatabase(), resources: {} } },
    );

    expect(response.status).toBe(201);
    expect(received).toEqual(metadata);
    expect(await response.json()).toMatchObject({
      upload: { resourceId: "res_restore", partCount: 75 },
    });
  });

  test("maps damaged revision JSON to an empty document", () => {
    expect(mapJsonBackupRevision({
      id: "rev_1",
      memo_id: "memo_1",
      revision: 1,
      title: "Revision",
      tags_json: '["tag"]',
      content_json: "damaged",
      content_markdown: "Body",
      content_text: "Body",
      content_hash: "hash",
      created_by: "Owner",
      created_at: "2026-08-08T00:00:00.000Z",
    })).toMatchObject({
      memoId: "memo_1",
      tags: ["tag"],
      contentJson: { type: "doc" },
    });
  });
});
