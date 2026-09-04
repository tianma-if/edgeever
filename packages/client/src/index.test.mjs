import { describe, expect, test } from "bun:test";
import { ApiRequestError, createEdgeEverClient } from "./index.ts";

const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "Content-Type": "application/json" },
  ...init,
});

describe("EdgeEver client HTTP contract", () => {
  test("companion streaming handles split UTF-8 frames, authenticates and does not retry", async () => {
    const expected = [{ type: "start", id: "request" }, { type: "text-delta", text: "你好" }, { type: "error", code: "failed" }];
    const bytes = new TextEncoder().encode(expected.map(event => `data: ${JSON.stringify(event)}`).join("\n\n"));
    let calls = 0;
    const client = createEdgeEverClient({ baseUrl: "https://notes.example", token: "test-token", fetch: async (url, init) => {
      calls++;
      expect(url).toBe("https://notes.example/api/v1/companion/turns");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");
      return new Response(new ReadableStream({ start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      } }));
    } });
    const actual = [];
    await client.streamCompanion({ id: "request", message: "hi" }, { onEvent: event => actual.push(event) });
    expect(actual).toEqual(expected);
    expect(calls).toBe(1);
  });

  test("reads public instance diagnostics through the configured base URL", async () => {
    const calls = [];
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example/",
      fetch: async (input) => {
        calls.push(String(input));
        return jsonResponse(String(input).endsWith("/api/health")
          ? { ok: true, name: "edgeever", runtime: "cloudflare-workers" }
          : { version: "1.47.0", changes: {} });
      },
    });

    const [health, release] = await Promise.all([
      client.getInstanceHealth(),
      client.getInstanceRelease(),
    ]);

    expect(calls).toEqual([
      "https://notes.example/api/health",
      "https://notes.example/api/release",
    ]);
    expect(health.runtime).toBe("cloudflare-workers");
    expect(release.version).toBe("1.47.0");
  });

  test("normalizes the base URL and sends backup pagination with auth", async () => {
    const calls = [];
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example///",
      token: "secret",
      fetch: async (input, init) => {
        calls.push({ input: String(input), init });
        return jsonResponse({ memos: [], resources: [], revisions: [], totalCount: 0, nextOffset: null });
      },
    });

    await client.getJsonBackupPage(25, 10);
    expect(calls[0].input).toBe("https://notes.example/api/v1/backups/json?offset=25&limit=10");
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer secret");
    expect(calls[0].init.credentials).toBe("include");
  });

  test("resolves runtime base URLs and credentials for every request", async () => {
    let baseUrl = "https://first.example/";
    let token = "first-token";
    const calls = [];
    const contexts = [];
    const client = createEdgeEverClient({
      baseUrl: () => baseUrl,
      token: () => token,
      beforeRequest: (context) => contexts.push(context),
      shouldAttachToken: (path) => path !== "/api/v1/auth/login",
      fetch: async (input, init) => {
        calls.push({
          input: String(input),
          authorization: new Headers(init.headers).get("Authorization"),
        });
        return jsonResponse({ authenticated: true, notebooks: [], memos: [], totalCount: 0, nextAfterId: null });
      },
    });

    await client.getSession();
    baseUrl = "https://second.example///";
    token = "second-token";
    await client.syncBootstrap({ limit: 20 });
    await client.login({ username: "admin", password: "secret" });

    expect(calls).toEqual([
      { input: "https://first.example/api/v1/auth/session", authorization: "Bearer first-token" },
      { input: "https://second.example/api/v1/sync/bootstrap?limit=20", authorization: "Bearer second-token" },
      { input: "https://second.example/api/v1/auth/login", authorization: null },
    ]);
    expect(contexts.map(({ path, token: requestToken }) => [path, requestToken])).toEqual([
      ["/api/v1/auth/session", "first-token"],
      ["/api/v1/sync/bootstrap?limit=20", "second-token"],
      ["/api/v1/auth/login", "second-token"],
    ]);
  });

  test("does not leak API credentials or JSON headers to absolute resource URLs", async () => {
    let call;
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      token: "secret",
      fetch: async (input, init) => {
        call = { input: String(input), headers: new Headers(init.headers) };
        return new Response("asset");
      },
    });

    const blob = await client.getResourceBlob("https://assets.example/file.bin");

    expect(await blob.text()).toBe("asset");
    expect(call.input).toBe("https://assets.example/file.bin");
    expect(call.headers.get("Authorization")).toBeNull();
    expect(call.headers.get("Content-Type")).toBeNull();
  });

  test("exposes an authenticated resource response without forcing Blob buffering", async () => {
    let authorization;
    const client = createEdgeEverClient({
      baseUrl: "https://notes.example",
      token: "secret",
      fetch: async (_input, init) => {
        authorization = new Headers(init.headers).get("Authorization");
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
            controller.enqueue(new Uint8Array([3]));
            controller.close();
          },
        }), { headers: { "Content-Length": "3" } });
      },
    });

    const response = await client.getResourceResponse("/api/v1/resources/res/blob");
    expect(authorization).toBe("Bearer secret");
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  test("streams restored resources through bounded multipart requests", async () => {
    const calls = [];
    const client = createEdgeEverClient({
      fetch: async (input, init) => {
        const path = String(input);
        calls.push({ path, headers: new Headers(init.headers), body: init.body });
        if (path.endsWith("/uploads")) {
          return jsonResponse({
            upload: {
              id: "restore_upload",
              resourceId: "resource/id",
              partSize: 4,
              partCount: 2,
              byteSize: 5,
              expiresAt: "2026-09-01T00:00:00.000Z",
            },
          }, { status: 201 });
        }
        if (path.includes("/parts/")) {
          return jsonResponse({ part: { partNumber: Number(path.split("/").at(-1)), byteSize: init.body.size } });
        }
        return jsonResponse({ resource: { id: "resource/id" } }, { status: 201 });
      },
    });

    await client.restoreJsonResource(
      "resource/id",
      {
        id: "resource/id",
        memoId: "memo",
        filename: "file.bin",
        mimeType: "application/octet-stream",
        kind: "attachment",
        byteSize: 5,
        sha256: null,
        width: null,
        height: null,
        originalMemoId: null,
        archivePath: "resources/file.bin",
        createdAt: "2026-08-31T00:00:00.000Z",
        updatedAt: "2026-08-31T00:00:00.000Z",
      },
      new Blob(["abcde"]),
    );
    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/restores/json/resources/resource%2Fid/uploads",
      "/api/v1/resource-uploads/restore_upload/parts/1",
      "/api/v1/resource-uploads/restore_upload/parts/2",
      "/api/v1/resource-uploads/restore_upload/complete",
    ]);
    expect(await calls[1].body.text()).toBe("abcd");
    expect(await calls[2].body.text()).toBe("e");
    expect(calls[1].headers.get("Content-Type")).toBe("application/octet-stream");
  });

  test("uploads memo resources as ordered resumable parts", async () => {
    const calls = [];
    const file = new File(["abcdefghij", new Uint8Array(5 * 1024 * 1024 - 9)], "archive.bin", { type: "application/octet-stream" });
    const client = createEdgeEverClient({
      fetch: async (input, init) => {
        const path = String(input);
        calls.push({ path, method: init.method, body: init.body });
        if (path.endsWith("/resource-uploads")) {
          expect(JSON.parse(init.body)).toEqual({
            filename: "archive.bin",
            mimeType: "application/octet-stream",
            byteSize: file.size,
          });
          return jsonResponse({
            upload: {
              id: "upload_1",
              resourceId: "res_1",
              partSize: 2 * 1024 * 1024,
              partCount: 3,
              byteSize: file.size,
              expiresAt: "2026-09-01T00:00:00.000Z",
            },
          }, { status: 201 });
        }
        if (path.includes("/parts/")) {
          const partNumber = Number(path.split("/").at(-1));
          return jsonResponse({ part: { partNumber, byteSize: init.body.size } });
        }
        return jsonResponse({ resource: { id: "res_1", url: "/api/v1/resources/res_1/blob" } }, { status: 201 });
      },
    });

    const result = await client.uploadMemoResource("memo/1", file);

    expect(result.resource.id).toBe("res_1");
    expect(calls.map(({ path }) => path)).toEqual([
      "/api/v1/memos/memo%2F1/resource-uploads",
      "/api/v1/resource-uploads/upload_1/parts/1",
      "/api/v1/resource-uploads/upload_1/parts/2",
      "/api/v1/resource-uploads/upload_1/parts/3",
      "/api/v1/resource-uploads/upload_1/complete",
    ]);
    expect(await calls[1].body.slice(0, 10).text()).toBe("abcdefghij");
    expect(calls.slice(1, 4).map((call) => call.body.size)).toEqual([
      2 * 1024 * 1024, 2 * 1024 * 1024, 1024 * 1024 + 1,
    ]);
  });

  test("uploads small images in one request and preserves file metadata", async () => {
    const calls = [];
    const client = createEdgeEverClient({
      fetch: async (input, init) => {
        calls.push({ path: String(input), init });
        return jsonResponse({ resource: { id: "image_1" } }, { status: 201 });
      },
    });
    const file = new File(["webp bytes"], "截图.webp", { type: "image/webp" });
    expect((await client.uploadMemoResource("memo/1", file)).resource.id).toBe("image_1");
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/v1/memos/memo%2F1/resources");
    const uploaded = calls[0].init.body.get("file");
    expect(uploaded.name).toBe(file.name);
    expect(uploaded.type).toBe(file.type);
    expect(await uploaded.text()).toBe(await file.text());
    expect(calls[0].init.headers.get("Content-Type")).toBeNull();
  });

  test("replaces resource content with a multipart concurrency baseline", async () => {
    let request;
    const client = createEdgeEverClient({
      fetch: async (input, init) => {
        request = { path: String(input), init };
        return jsonResponse({ resource: { id: "res_1", sha256: "next" } });
      },
    });
    const file = new File(["scene"], "drawing.excalidraw", { type: "application/vnd.excalidraw+json" });

    await client.updateResourceContent("res/1", file, "previous");

    expect(request.path).toBe("/api/v1/resources/res%2F1/blob");
    expect(request.init.method).toBe("PUT");
    expect(request.init.body).toBeInstanceOf(FormData);
    expect(request.init.body.get("file")).toBeInstanceOf(File);
    expect(await request.init.body.get("file").text()).toBe("scene");
    expect(request.init.body.get("expectedContentHash")).toBe("previous");
    expect(request.init.body.get("mimeType")).toBe("application/vnd.excalidraw+json");
    expect(request.init.body.get("filename")).toBe("drawing.excalidraw");
  });

  test("uploads a file-backed source without requesting more than one part at a time", async () => {
    const ranges = [];
    const bodies = [];
    const client = createEdgeEverClient({
      fetch: async (input, init) => {
        const path = String(input);
        if (path.endsWith("/resource-uploads")) {
          return jsonResponse({
            upload: {
              id: "upload_staged",
              resourceId: "res_staged",
              partSize: 4,
              partCount: 3,
              byteSize: 9,
              expiresAt: "2026-09-01T00:00:00.000Z",
            },
          }, { status: 201 });
        }
        if (path.includes("/parts/")) {
          bodies.push(await init.body.text());
          return jsonResponse({ part: { partNumber: Number(path.split("/").at(-1)), byteSize: init.body.size } });
        }
        return jsonResponse({ resource: { id: "res_staged" } }, { status: 201 });
      },
    });

    await client.uploadMemoResourceParts("memo_1", {
      filename: "offline.bin",
      mimeType: "application/octet-stream",
      byteSize: 9,
      readPart: async (start, end) => {
        ranges.push([start, end]);
        return new Blob(["abcdefghi".slice(start, end)]);
      },
    });

    expect(ranges).toEqual([[0, 4], [4, 8], [8, 9]]);
    expect(bodies).toEqual(["abcd", "efgh", "i"]);
  });

  test("sends unsaved note content to the AI tag suggestion endpoint", async () => {
    let call;
    const client = createEdgeEverClient({
      fetch: async (input, init) => {
        call = { input: String(input), init };
        return jsonResponse({ suggestions: [{ name: "existing", existing: true }] });
      },
    });

    const result = await client.suggestAiTags({
      title: "Draft title",
      contentMarkdown: "Draft body",
      currentTags: ["current"],
      locale: "en-US",
    });

    expect(call.input).toBe("/api/v1/ai/tag-suggestions");
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(call.init.body)).toEqual({
      title: "Draft title",
      contentMarkdown: "Draft body",
      currentTags: ["current"],
      locale: "en-US",
    });
    expect(result.suggestions).toEqual([{ name: "existing", existing: true }]);
  });

  test("sends an exact tag constraint when listing memos", async () => {
    let requestUrl;
    const client = createEdgeEverClient({
      fetch: async (input) => {
        requestUrl = String(input);
        return jsonResponse({ memos: [], totalCount: 0, nextCursor: null });
      },
    });

    await client.listMemos({ tag: "产品 和 交互" });

    expect(requestUrl).toBe("/api/v1/memos?tag=%E4%BA%A7%E5%93%81+%E5%92%8C+%E4%BA%A4%E4%BA%92");
  });

  test("updates the workspace AI tag suggestion prompt", async () => {
    let call;
    const client = createEdgeEverClient({
      fetch: async (input, init) => {
        call = { input: String(input), init };
        return jsonResponse({ tagSuggestionPrompt: "Custom", tagSuggestionPromptCustomized: true });
      },
    });

    await client.updateAiTagSuggestionPrompt({ prompt: "Custom" }, "zh-CN");
    expect(call.input).toBe("/api/v1/ai/tag-suggestion-prompt?locale=zh-CN");
    expect(call.init.method).toBe("PUT");
    expect(JSON.parse(call.init.body)).toEqual({ prompt: "Custom" });
  });

  test("preserves API error codes and invokes unauthorized handling", async () => {
    let unauthorized = 0;
    const client = createEdgeEverClient({
      onUnauthorized: () => { unauthorized += 1; },
      fetch: async () => jsonResponse(
        { error: { code: "session_expired", message: "Sign in again" } },
        { status: 401, statusText: "Unauthorized" },
      ),
    });

    try {
      await client.getSession();
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({ status: 401, code: "session_expired", message: "Sign in again" });
    }
    expect(unauthorized).toBe(1);
  });

  test("preserves Cloudflare diagnostics when an HTML challenge intercepts the API", async () => {
    const client = createEdgeEverClient({
      fetch: async () => new Response("<html>challenge</html>", {
        status: 403,
        headers: {
          "CF-Mitigated": "challenge",
          "CF-Ray": "abc123-NRT",
          "Content-Type": "text/html",
        },
      }),
    });

    try {
      await client.login({ username: "admin", password: "secret" });
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({
        status: 403,
        message: "Request failed",
        responseDiagnostics: {
          cloudflareMitigated: true,
          isEdgeEverApiError: false,
          rayId: "abc123-NRT",
        },
      });
    }
  });

  test("distinguishes EdgeEver API errors from edge security responses", async () => {
    const client = createEdgeEverClient({
      fetch: async () => jsonResponse(
        { error: { code: "forbidden", message: "Forbidden", details: { reason: "policy" } } },
        { status: 403, headers: { "CF-Ray": "def456-SJC", "Content-Type": "application/json" } },
      ),
    });

    await expect(client.login({ username: "admin", password: "secret" })).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      details: { reason: "policy" },
      responseDiagnostics: {
        cloudflareMitigated: false,
        isEdgeEverApiError: true,
        rayId: "def456-SJC",
      },
    });
  });
});
