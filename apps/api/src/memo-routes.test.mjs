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
  createImageResource: async () => ({ id: "res_1" }),
  createMemo: async () => ({ id: "memo_created" }),
  createMemoEditSession: async () => null,
  deleteMemo: async () => {},
  deleteMemos: async () => 0,
  emptyTrash: async () => 0,
  getMemoDetail: async () => null,
  listMemos: async () => ({ memos: [], totalCount: 0, nextCursor: null }),
  listMemoRevisions: async () => [],
  duplicateMemo: async () => ({ id: "memo_copy" }),
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
  test("creates an image note with the resource id already in the markdown", async () => {
    const calls = [];
    const dependencies = createDependencies({
      createMemo: async (_db, _workspaceId, input) => {
        calls.push(["create", input.contentMarkdown]);
        return { id: "memo_created" };
      },
      createImageResource: async (_context, input) => {
        calls.push(["image", input.memoId, input.resourceId, input.bytes.byteLength]);
        return { id: input.resourceId };
      },
    });
    const form = new FormData();
    form.set("notebookId", "nb_1");
    form.set("title", "猫 - Google 搜索");
    form.set("tags", JSON.stringify(["web-clip"]));
    form.set("contentMarkdown", "![图片](/api/v1/resources/EDGEVERRESOURCEID/blob)\n\n来源: https://www.google.com/search?q=%E7%8C%AB&udm=2");
    form.set("file", new File([Uint8Array.of(0xff, 0xd8, 0xff)], "cat.jpg", { type: "image/jpeg" }));
    const response = await createApp(dependencies).request("/api/v1/memos/with-image", {
      method: "POST",
      body: form,
    }, environment);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.memo.id).toBe("memo_created");
    expect(calls[0][1]).toBe(`![图片](/api/v1/resources/${body.resourceId}/blob)\n\n来源: https://www.google.com/search?q=%E7%8C%AB&udm=2`);
    expect(calls[1]).toEqual(["image", "memo_created", body.resourceId, 3]);
  });

  test("deletes the new note when the image cannot be stored", async () => {
    const deleted = [];
    const dependencies = createDependencies({
      createMemo: async () => ({ id: "memo_created" }),
      createImageResource: async () => {
        throw new AppError("unsupported_media_type", "Unsupported image type", 415);
      },
      deleteMemo: async (_env, _workspaceId, memoId) => {
        deleted.push(memoId);
      },
    });
    const form = new FormData();
    form.set("notebookId", "nb_1");
    form.set("contentMarkdown", "![图片](/api/v1/resources/EDGEVERRESOURCEID/blob)");
    form.set("file", new File([Uint8Array.of(1)], "cat.jpg", { type: "image/jpeg" }));
    const response = await createApp(dependencies).request("/api/v1/memos/with-image", {
      method: "POST",
      body: form,
    }, environment);
    expect(response.status).toBe(415);
    expect(deleted).toEqual(["memo_created"]);
  });

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
      includeTotal: true,
      notebookId: "nb_1",
      includeNotebookDescendants: true,
      query: "hello",
      tag: "Demo",
      includeTrash: true,
      sort: "title-asc",
      filter: "pinned",
      limit: 25,
      cursor: "opaque",
      notebookAccess: { restricted: false, readableNotebookIds: [], writableNotebookIds: [] },
    });
  });

  test("forwards an explicit count opt-out for bounded result consumers", async () => {
    let input;
    const dependencies = createDependencies({ listMemos: async (_db, value) => { input = value; return { memos: [], nextCursor: null }; } });
    const response = await createApp(dependencies).request("/api/v1/memos?q=hello&includeTotal=0", {}, environment);
    expect(response.status).toBe(200);
    expect(input.includeTotal).toBe(false);
    expect((await response.json()).totalCount).toBeUndefined();
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

  test("stores the line breaks of a multipart image note as LF", async () => {
    let contentMarkdown;
    const dependencies = createDependencies({
      createMemo: async (_db, _workspaceId, input) => {
        contentMarkdown = input.contentMarkdown;
        return { id: "memo_created" };
      },
    });
    // Browsers encode line breaks in multipart text fields as CRLF.
    const boundary = "edgeever-boundary";
    const part = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const body = [
      part("notebookId", "nb_1"),
      part("contentMarkdown", "![clip](/api/v1/resources/EDGEVERRESOURCEID/blob)\r\n\r\nSource: https://example.com\r\nLine"),
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.png"\r\nContent-Type: image/png\r\n\r\n\x89PNG\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const response = await createApp(dependencies).request("/api/v1/memos/with-image", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    }, environment);

    expect(response.status).toBe(201);
    const { resourceId } = await response.json();
    expect(contentMarkdown).toBe(`![clip](/api/v1/resources/${resourceId}/blob)\n\nSource: https://example.com\nLine`);
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

  test("validates and delegates note duplication", async () => {
    let received;
    const dependencies = createDependencies({
      duplicateMemo: async (_context, memoId, input, actor, actorLabel) => {
        received = { memoId, input, actor, actorLabel };
        return { id: "memo_copy", title: input.title };
      },
    });
    const request = (body) => createApp(dependencies).request(
      "/api/v1/memos/memo_1/duplicate",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      environment,
    );

    const response = await request({ title: "  Plan (copy)  ", notebookId: "nb_2" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ memo: { id: "memo_copy", title: "Plan (copy)" } });
    expect(received).toEqual({
      memoId: "memo_1",
      input: { title: "Plan (copy)", notebookId: "nb_2" },
      actor: { actorType: "agent", actorId: "tok_memos" },
      actorLabel: "agent:tok_memos",
    });
    expect((await request({ title: "x".repeat(161) })).status).toBe(400);
  });

  test("reports duplication errors and requires the write scope", async () => {
    const failing = createDependencies({
      duplicateMemo: async () => {
        throw new AppError("duplicate_too_large", "Too large", 413);
      },
    });
    const response = await createApp(failing).request(
      "/api/v1/memos/memo_1/duplicate",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      environment,
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("duplicate_too_large");

    let called = false;
    const readOnly = createApp(
      createDependencies({ duplicateMemo: async () => { called = true; return { id: "memo_copy" }; } }),
      { ...agentAuth, scopes: ["read:memos"] },
    );
    const denied = await readOnly.request(
      "/api/v1/memos/memo_1/duplicate",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      environment,
    );
    expect(denied.status).toBe(403);
    expect(called).toBe(false);
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
