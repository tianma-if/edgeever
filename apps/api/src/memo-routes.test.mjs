import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { AppError } from "./app-error.ts";
import { registerMemoRoutes } from "./memo-routes.ts";

const agentAuth = {
  kind: "agent",
  actorType: "agent",
  actorId: "tok_memos",
  username: "memo-agent",
  displayName: null,
  scopes: ["read:memos", "write:memos"],
  workspaceId: "ws_1",
  role: "member",
};

const environment = {
  storage: {
    db: {},
    resources: {},
  },
};

const createDependencies = (overrides = {}) => ({
  clampNumber: (value, min, max) => Math.min(Math.max(value, min), max),
  createMemo: async () => ({ id: "memo_created" }),
  createMemoEditSession: async () => null,
  deleteMemo: async () => {},
  deleteMemos: async () => 0,
  emptyTrash: async () => 0,
  getMemoDetail: async () => null,
  listMemos: async () => ({ memos: [], totalCount: 0, nextCursor: null }),
  listMemoRevisions: async () => [],
  mergeMemos: async () => ({ id: "memo_merged" }),
  moveMemos: async () => 0,
  restoreMemo: async () => ({ id: "memo_1" }),
  restoreMemoRevision: async () => ({ id: "memo_1" }),
  updateMemo: async () => ({ memo: { id: "memo_1" } }),
  ...overrides,
});

const createApp = (dependencies, auth = agentAuth) => {
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", auth);
    await next();
  });
  registerMemoRoutes(app, dependencies);
  return app;
};

describe("memo route contracts", () => {
  test("maps list query parameters into the list service", async () => {
    let received;
    const dependencies = createDependencies({
      listMemos: async (...args) => {
        received = args;
        return { memos: [], totalCount: 0, nextCursor: null };
      },
    });
    const response = await createApp(dependencies).request(
      "/api/v1/memos?notebookId=nb_1&includeDescendants=1&q=hello&tag=Demo&trash=1&sort=title-asc&filter=pinned&limit=25&cursor=opaque",
      {},
      environment,
    );

    expect(response.status).toBe(200);
    expect(received[1]).toEqual({
      workspaceId: "ws_1",
      notebookId: "nb_1",
      includeNotebookDescendants: true,
      query: "hello",
      tag: "Demo",
      includeTrash: true,
      sort: "title-asc",
      filter: "pinned",
      limit: 25,
      cursor: "opaque",
    });
  });

  test("validates and delegates memo creation", async () => {
    let received;
    const dependencies = createDependencies({
      createMemo: async (...args) => {
        received = args;
        return { id: "memo_created", title: args[2].title };
      },
    });
    const response = await createApp(dependencies).request(
      "/api/v1/memos",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId: "nb_1", title: "Created" }),
      },
      environment,
    );

    expect(response.status).toBe(201);
    expect(received.slice(1, 3)).toEqual([
      "ws_1",
      { notebookId: "nb_1", title: "Created" },
    ]);
    expect(await response.json()).toMatchObject({ memo: { id: "memo_created" } });
  });

  test("enforces read scope before loading a memo", async () => {
    let called = false;
    const dependencies = createDependencies({
      getMemoDetail: async () => {
        called = true;
        return null;
      },
    });
    const response = await createApp(
      dependencies,
      { ...agentAuth, scopes: ["write:memos"] },
    ).request("/api/v1/memos/memo_1", {}, environment);

    expect(response.status).toBe(403);
    expect(called).toBe(false);
  });

  test("forwards workspace and deleted visibility to memo lookup", async () => {
    let received;
    const dependencies = createDependencies({
      getMemoDetail: async (...args) => {
        received = args;
        return { id: "memo_1", title: "Archived" };
      },
    });
    const response = await createApp(dependencies).request(
      "/api/v1/memos/memo_1?includeDeleted=1",
      {},
      environment,
    );

    expect(response.status).toBe(200);
    expect(received.slice(1)).toEqual(["ws_1", "memo_1", true]);
    expect(await response.json()).toMatchObject({ memo: { id: "memo_1" } });
  });

  test("clamps revision history limits and maps domain errors", async () => {
    let receivedLimit;
    const successful = createDependencies({
      listMemoRevisions: async (_database, _workspaceId, _memoId, limit) => {
        receivedLimit = limit;
        return [{ id: "rev_1", revision: 1 }];
      },
    });
    const response = await createApp(successful).request(
      "/api/v1/memos/memo_1/revisions?limit=500",
      {},
      environment,
    );
    expect(response.status).toBe(200);
    expect(receivedLimit).toBe(100);

    const missing = createDependencies({
      listMemoRevisions: async () => {
        throw new AppError("not_found", "Memo not found", 404);
      },
    });
    const missingResponse = await createApp(missing).request(
      "/api/v1/memos/missing/revisions",
      {},
      environment,
    );
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toMatchObject({ error: { code: "not_found" } });
  });

  test("forwards permanent deletion and the authenticated actor", async () => {
    let received;
    const dependencies = createDependencies({
      deleteMemo: async (...args) => {
        received = args;
      },
    });
    const response = await createApp(dependencies).request(
      "/api/v1/memos/memo_1?permanent=1",
      { method: "DELETE" },
      environment,
    );

    expect(response.status).toBe(200);
    expect(received.slice(1)).toEqual([
      "ws_1",
      "memo_1",
      true,
      { actorType: "agent", actorId: "tok_memos" },
    ]);
  });

  test("requires the REST save path to use edit-session validation", async () => {
    let received;
    const dependencies = createDependencies({
      updateMemo: async (...args) => {
        received = args;
        return {
          error: "edit_session_required",
          message: "A bound edit session is required to save note content.",
          status: 428,
        };
      },
    });
    const response = await createApp(dependencies).request(
      "/api/v1/memos/memo_1/save",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentMarkdown: "Changed" }),
      },
      environment,
    );

    expect(response.status).toBe(428);
    expect(received[2]).toBe("memo_1");
    expect(received.at(-1)).toBe(true);
    expect(await response.json()).toMatchObject({ error: { code: "edit_session_required" } });
  });

  test("preserves revision conflict details", async () => {
    const dependencies = createDependencies({
      updateMemo: async () => ({
        error: "revision_conflict",
        message: "Memo was updated elsewhere. Reload before saving.",
        status: 409,
        details: { expectedRevision: 4, currentRevision: 5 },
      }),
    });
    const response = await createApp(dependencies).request(
      "/api/v1/memos/memo_1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: 4, title: "Changed" }),
      },
      environment,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: "revision_conflict",
        details: { expectedRevision: 4, currentRevision: 5 },
      },
    });
  });

  test("validates and delegates memo merging", async () => {
    let receivedInput;
    const dependencies = createDependencies({
      mergeMemos: async (_database, _workspaceId, input) => {
        receivedInput = input;
        return { id: "memo_merged", title: input.title };
      },
    });
    const response = await createApp(dependencies).request(
      "/api/v1/memos/merge",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoIds: ["memo_1", "memo_2"], title: "Merged" }),
      },
      environment,
    );

    expect(response.status).toBe(201);
    expect(receivedInput).toEqual({ memoIds: ["memo_1", "memo_2"], title: "Merged" });
  });

  test("delegates batch moves through the memo service boundary", async () => {
    let received;
    const dependencies = createDependencies({
      moveMemos: async (...args) => {
        received = args;
        return 2;
      },
    });
    const response = await createApp(dependencies).request(
      "/api/v1/memos/batch/move",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoIds: ["memo_1", "memo_2"], notebookId: "nb_2" }),
      },
      environment,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, moved: 2 });
    expect(received.slice(1, 4)).toEqual(["ws_1", ["memo_1", "memo_2"], "nb_2"]);
  });
});
