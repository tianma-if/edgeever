import { describe, expect, test } from "bun:test";
import { ApiRequestError, createEdgeEverClient } from "./index.ts";

const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "Content-Type": "application/json" },
  ...init,
});

describe("EdgeEver client HTTP contract", () => {
  test("sends optional export cursors without changing legacy offset requests", async () => {
    const calls = [];
    const client = createEdgeEverClient({ baseUrl: "https://notes.example", fetch: async input => { calls.push(new URL(input)); return jsonResponse({}); } });
    const cursor = JSON.stringify({ id: "memo_续页", createdAt: "2020-01-01T00:00:00.000Z", offset: 25 });
    await client.getJsonBackupPage(25, 25, cursor);
    await client.getMarkdownExportPage(25, 25, ["memo_1"], cursor);
    expect(calls.map(url => url.searchParams.get("cursor"))).toEqual([cursor, cursor]);
    expect(calls.map(url => url.searchParams.get("includeTotal"))).toEqual(["0", "0"]);
    expect(calls[1].searchParams.get("ids")).toBe("memo_1");
  });

  test("requests full metadata initially and opts out only for later sync and export pages", async () => {
    const calls = [];
    const client = createEdgeEverClient({ baseUrl: "https://notes.example", fetch: async (input) => { calls.push(new URL(input)); return jsonResponse({}); } });
    await client.syncBootstrap({ limit: 1 });
    await client.syncBootstrap({ afterId: "memo_1", limit: 1 });
    await client.getMobileSyncBootstrapPage(null, 1);
    await client.getMobileSyncBootstrapPage("memo_1", 1);
    await client.getJsonBackupPage(0, 1);
    await client.getJsonBackupPage(1, 1);
    await client.getMarkdownExportPage(0, 1, ["memo_1", "memo_2"]);
    await client.getMarkdownExportPage(1, 1, ["memo_1", "memo_2"]);
    expect(calls.map((url) => url.searchParams.get("includeMetadata"))).toEqual([null, "0", null, "0", null, null, null, null]);
    expect(calls.map((url) => url.searchParams.get("includeTotal"))).toEqual([null, null, null, null, null, "0", null, "0"]);
    expect(calls[7].searchParams.get("ids")).toBe("memo_1,memo_2");
    await client.listMemos({ q: "hello", includeTotal: false });
    expect(calls.at(-1).searchParams.get("includeTotal")).toBe("0");
  });

  test("companion prepare errors authenticate and never retry on a server generation endpoint", async()=>{
 const paths=[];const client=createEdgeEverClient({baseUrl:"https://notes.example",token:"test-token",fetch:async(url,init)=>{paths.push(url);expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");return Response.json({error:{code:"ai_not_configured",message:"Choose a model"}},{status:409});}});
 await expect(client.streamCompanion({id:"request",message:"hi"},{onEvent(){}})).rejects.toMatchObject({code:"ai_not_configured"});expect(paths).toEqual(["https://notes.example/api/v1/companion/turns/prepare"]);
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
    expect(calls[0].input).toBe("https://notes.example/api/v1/backups/json?offset=25&limit=10&includeTotal=0");
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

  test("downloads GitHub plugin assets through the release-tag route", async () => {
    let requestUrl;
    const client = createEdgeEverClient({
      fetch: async (input) => {
        requestUrl = String(input);
        return new Response(new Uint8Array([1, 2, 3]));
      },
    });

    const buffer = await client.downloadGithubPluginAsset(
      "example-owner",
      "example-plugin",
      "v1.2.3-preview.1",
      "main.js",
    );

    expect(requestUrl).toBe(
      "/api/v1/plugins/github/example-owner/example-plugin/releases/v1.2.3-preview.1/assets/main.js",
    );
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3]);
  });

  test("downloads GitHub plugin assets through the release-asset id route", async () => {
    let requestUrl;
    const client = createEdgeEverClient({
      fetch: async (input) => {
        requestUrl = String(input);
        return new Response(new Uint8Array([4, 5]));
      },
    });

    const buffer = await client.downloadGithubPluginAssetById(
      "example-owner",
      "example-plugin",
      "42",
      "styles.css",
    );

    expect(requestUrl).toBe(
      "/api/v1/plugins/github/example-owner/example-plugin/assets/42/styles.css",
    );
    expect(Array.from(new Uint8Array(buffer))).toEqual([4, 5]);
  });

  test("reads GitHub plugin metadata through the instance proxy", async () => {
    const calls = [];
    const client = createEdgeEverClient({
      fetch: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/latest-manifest")) return new Response("{\"id\":\"plugin\",\"version\":\"1.2.3\"}");
        if (url.endsWith("/manifest")) return new Response("{\"id\":\"plugin\"}");
        if (url.includes("/releases/tags/missing")) return new Response(null, { status: 404 });
        return Response.json({ tag_name: "v1.2.3", draft: false, assets: [] });
      },
    });

    expect(await client.getGithubPluginLatestManifest("example-owner", "example-plugin")).toBe("{\"id\":\"plugin\",\"version\":\"1.2.3\"}");
    expect(await client.getGithubPluginRepositoryManifest("example-owner", "example-plugin")).toBe("{\"id\":\"plugin\"}");
    expect(await client.getGithubPluginRelease("example-owner", "example-plugin", "missing")).toBeNull();
    expect(await client.getGithubPluginRelease("example-owner", "example-plugin", "v1.2.3")).toEqual({
      tag_name: "v1.2.3",
      draft: false,
      assets: [],
    });
    expect(calls).toEqual([
      "/api/v1/plugins/github/example-owner/example-plugin/latest-manifest",
      "/api/v1/plugins/github/example-owner/example-plugin/manifest",
      "/api/v1/plugins/github/example-owner/example-plugin/releases/tags/missing",
      "/api/v1/plugins/github/example-owner/example-plugin/releases/tags/v1.2.3",
    ]);
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

  test("uploads binary parts without converting them to Blob", async () => {
    const parts = [];
    const client = createEdgeEverClient({
      fetch: async (input, init) => {
        const path = String(input);
        if (path.endsWith("/resource-uploads")) {
          return jsonResponse({ upload: { id: "upload_binary", partSize: 4, partCount: 2, byteSize: 6 } }, { status: 201 });
        }
        if (path.includes("/parts/")) {
          expect(init.body).toBeInstanceOf(Uint8Array);
          parts.push([...init.body]);
          return jsonResponse({ part: { partNumber: parts.length, byteSize: init.body.byteLength } });
        }
        return jsonResponse({ resource: { id: "binary_resource" } }, { status: 201 });
      },
    });

    await client.uploadMemoResourceParts("memo_1", {
      filename: "report.pdf",
      mimeType: "application/pdf",
      byteSize: 6,
      readPart: async (start, end) => new Uint8Array([0, 255, 37, 80, 68, 70].slice(start, end)),
    });
    expect(parts).toEqual([[0, 255, 37, 80], [68, 70]]);
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

  test("sends unsaved note content only to the tag preparation endpoint", async()=>{
 let received;const client=createEdgeEverClient({fetch:async(url,init)=>{received={url,body:JSON.parse(init.body)};return new Response("{}",{status:404});}});
 await expect(client.suggestAiTags({title:"Draft title",contentMarkdown:"Draft body",currentTags:["current"],locale:"en-US"})).rejects.toMatchObject({code:"ai_direct_unavailable"});
 expect(received).toEqual({url:"/api/v1/ai/tag-suggestions/prepare",body:{title:"Draft title",contentMarkdown:"Draft body",currentTags:["current"],locale:"en-US"}});
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

const createRecordingClient = (respond = () => jsonResponse({ ok: true }), clientOptions = {}) => {
  const calls = [];
  const client = createEdgeEverClient({
    baseUrl: "https://notes.example",
    token: "secret",
    ...clientOptions,
    fetch: async (input, init = {}) => {
      const headers = new Headers(init.headers);
      const call = {
        method: init.method ?? "GET",
        path: String(input).replace(/^https:\/\/notes\.example/, ""),
        headers,
        body: init.body,
        init,
      };
      calls.push(call);
      return respond(call);
    },
  });
  return { client, calls };
};

const parsedBody = (call) => (typeof call.body === "string" ? JSON.parse(call.body) : call.body);

// [method name, arguments, HTTP method, path with query, JSON body (undefined when none)]
const jsonEndpointCases = [
  ["getPublicNotebookShare", ["tok/1"], "GET", "/api/public/notebook-shares/tok%2F1", undefined],
  ["resolveNotebookSite", ["my site"], "GET", "/api/public/notebook-sites/my%20site/resolve", undefined],
  ["searchPublicNotebook", ["tok", { q: "hi", tag: "t", cursor: "c1" }], "GET", "/api/public/notebook-shares/tok/search?q=hi&tag=t&cursor=c1", undefined],
  ["searchPublicNotebook", ["tok", {}], "GET", "/api/public/notebook-shares/tok/search?", undefined],
  ["previewPublicNotebookMemo", ["tok", "m 1"], "GET", "/api/public/notebook-shares/tok/memos/m%201/preview", undefined],
  ["updateNotebookSite", ["nb", { title: "Site" }], "PATCH", "/api/v1/notebooks/nb/share/site", { title: "Site" }],
  ["getMemoNotebookSites", ["m1"], "GET", "/api/v1/memos/m1/notebook-sites", undefined],
  ["listNotebookSiteMemos", ["nb", { q: "x", visibility: "public", cursor: "c", limit: 0 }], "GET", "/api/v1/notebooks/nb/share/memos?q=x&visibility=public&cursor=c&limit=0", undefined],
  ["listNotebookSiteMemos", ["nb", {}], "GET", "/api/v1/notebooks/nb/share/memos?", undefined],
  ["listNotebookSiteExclusions", ["nb"], "GET", "/api/v1/notebooks/nb/share/excluded-memos", undefined],
  ["listNotebookSiteExclusions", ["nb", "a&b"], "GET", "/api/v1/notebooks/nb/share/excluded-memos?cursor=a%26b", undefined],
  ["setNotebookSiteExclusion", ["nb", "m1", true], "PATCH", "/api/v1/notebooks/nb/share/memos/m1", { excluded: true }],
  ["getPublicNotebookMemo", ["tok", "m1"], "GET", "/api/public/notebook-shares/tok/memos/m1", undefined],
  ["unlockPublicNotebookShare", ["tok", "pw"], "POST", "/api/public/notebook-shares/tok/unlock", { password: "pw" }],
  ["updateNotebookShare", ["nb", { passwordProtected: true }], "PATCH", "/api/v1/notebooks/nb/share", { passwordProtected: true }],
  ["listNotebookShares", [], "GET", "/api/v1/notebook-shares", undefined],
  ["getNotebookShare", ["nb"], "GET", "/api/v1/notebooks/nb/share", undefined],
  ["createNotebookShare", ["nb"], "POST", "/api/v1/notebooks/nb/share", undefined],
  ["revokeNotebookShare", ["nb"], "DELETE", "/api/v1/notebooks/nb/share", undefined],
  ["getPublicMemoShare", ["t?x"], "GET", "/api/public/shares/t%3Fx", undefined],
  ["updatePublishedNoteBodyFont", ["serif"], "PUT", "/api/v1/me/note-body-font", { bodyFont: "serif" }],
  ["getNoteProse", [], "GET", "/api/v1/me/note-prose", undefined],
  ["updateNoteProse", [{ lineHeight: 1.6 }], "PUT", "/api/v1/me/note-prose", { lineHeight: 1.6 }],
  ["unlockPublicMemoShare", ["tok", "pw"], "POST", "/api/public/shares/tok/unlock", { password: "pw" }],
  ["listLoginDeviceSessions", [], "GET", "/api/v1/auth/sessions", undefined],
  ["revokeLoginDeviceSession", ["sess_1"], "DELETE", "/api/v1/auth/sessions/sess_1", undefined],
  ["updateLoginDeviceSession", ["sess_1", { label: "Laptop" }], "PATCH", "/api/v1/auth/sessions/sess_1", { label: "Laptop" }],
  ["revokeOtherLoginDeviceSessions", [], "DELETE", "/api/v1/auth/sessions", undefined],
  ["changePassword", [{ currentPassword: "a", newPassword: "b", confirmPassword: "b" }], "POST", "/api/v1/auth/change-password", { currentPassword: "a", newPassword: "b", confirmPassword: "b" }],
  ["getObjectStorageSettings", [], "GET", "/api/v1/instance/object-storage", undefined],
  ["testObjectStorageConnection", [{ endpoint: "https://s3", bucket: "b" }], "POST", "/api/v1/instance/object-storage/test", { endpoint: "https://s3", bucket: "b" }],
  ["updateObjectStorageSettings", [{ provider: "builtin" }], "PUT", "/api/v1/instance/object-storage", { provider: "builtin" }],
  ["getAiSettings", [], "GET", "/api/v1/ai/settings", undefined],
  ["getAiSettings", ["zh CN"], "GET", "/api/v1/ai/settings?locale=zh%20CN", undefined],
  ["getAiTranscriptionSettings", [], "GET", "/api/v1/ai/transcription-settings", undefined],
  ["createAiTranscriptionProvider", [{ displayName: "S" }], "POST", "/api/v1/ai/transcription-providers", { displayName: "S" }],
  ["updateAiTranscriptionProvider", ["atp/1", { displayName: "S" }], "PUT", "/api/v1/ai/transcription-providers/atp%2F1", { displayName: "S" }],
  ["deleteAiTranscriptionProvider", ["atp_1"], "DELETE", "/api/v1/ai/transcription-providers/atp_1", undefined],
  ["addAiTranscriptionModel", ["atp_1", { modelId: "whisper" }], "POST", "/api/v1/ai/transcription-providers/atp_1/models", { modelId: "whisper" }],
  ["deleteAiTranscriptionModel", ["atp_1", "atm_1"], "DELETE", "/api/v1/ai/transcription-providers/atp_1/models/atm_1", undefined],
  ["updateDefaultAiTranscriptionModel", [null], "PUT", "/api/v1/ai/transcription-default-model", { modelConfigId: null }],
  ["prepareNoteResourceTranscription", ["m1", "r1"], "POST", "/api/v1/memos/m1/resources/r1/transcription-target", undefined],
  ["getAiTranscriptionDirectCredential", ["atp_1"], "POST", "/api/v1/ai/transcription-providers/atp_1/direct-credential", undefined],
  ["createAiProvider", [{ displayName: "P" }], "POST", "/api/v1/ai/providers", { displayName: "P" }],
  ["updateAiProvider", ["aip_1", { displayName: "P" }], "PUT", "/api/v1/ai/providers/aip_1", { displayName: "P" }],
  ["deleteAiProvider", ["aip_1"], "DELETE", "/api/v1/ai/providers/aip_1", undefined],
  ["addAiModel", ["aip_1", { modelId: "m" }], "POST", "/api/v1/ai/providers/aip_1/models", { modelId: "m" }],
  ["deleteAiModel", ["aip_1", "aim_1"], "DELETE", "/api/v1/ai/providers/aip_1/models/aim_1", undefined],
  ["updateDefaultAiModel", ["aim_1"], "PUT", "/api/v1/ai/default-model", { modelConfigId: "aim_1" }],
  ["listAiPrompts", [], "GET", "/api/v1/ai/prompts", undefined],
  ["listAiPrompts", ["en"], "GET", "/api/v1/ai/prompts?locale=en", undefined],
  ["createAiPrompt", [{ name: "P", instruction: "I" }], "POST", "/api/v1/ai/prompts", { name: "P", instruction: "I" }],
  ["updateAiPrompt", ["p 1", { name: "Q" }], "PATCH", "/api/v1/ai/prompts/p%201", { name: "Q" }],
  ["deleteAiPrompt", ["p1"], "DELETE", "/api/v1/ai/prompts/p1", undefined],
  ["restoreDefaultAiPrompts", [], "POST", "/api/v1/ai/prompts/restore-defaults", {}],
  ["restoreDefaultAiPrompts", ["pl"], "POST", "/api/v1/ai/prompts/restore-defaults?locale=pl", {}],
  ["listCompanionMemories", [], "GET", "/api/v1/companion/memories", undefined],
  ["getCompanionDiscoverySettings", [], "GET", "/api/v1/companion/discovery/settings", undefined],
  ["saveCompanionDiscoverySettings", [{ enabled: true }], "PUT", "/api/v1/companion/discovery/settings", { enabled: true }],
  ["listCompanionDiscoveries", [], "GET", "/api/v1/companion/discovery", undefined],
  ["acknowledgeCompanionDiscovery", ["d1"], "POST", "/api/v1/companion/discovery/d1/seen", {}],
  ["acknowledgeCompanionDiscovery", ["d1", true], "POST", "/api/v1/companion/discovery/d1/dismiss", {}],
  ["rememberCompanionDiscoveryFeedback", ["d1"], "POST", "/api/v1/companion/discovery/d1/feedback", {}],
  ["listCompanionActions", [], "GET", "/api/v1/companion/actions", undefined],
  ["applyCompanionAction", ["a1"], "POST", "/api/v1/companion/actions/a1/apply", {}],
  ["dismissCompanionAction", ["a1"], "POST", "/api/v1/companion/actions/a1/dismiss", {}],
  ["saveCompanionMemory", ["Remember", "turn_1"], "POST", "/api/v1/companion/memories", { content: "Remember", sourceTurnId: "turn_1" }],
  ["updateCompanionMemory", [{ id: "mem 1", version: 3 }, "New"], "PATCH", "/api/v1/companion/memories/mem%201", { content: "New", version: 3 }],
  ["forgetCompanionMemory", [{ id: "mem_1", version: 4 }], "DELETE", "/api/v1/companion/memories/mem_1?version=4", undefined],
  ["listCompanionTurns", [], "GET", "/api/v1/companion/turns", undefined],
  ["getCompanionTurn", ["t1"], "GET", "/api/v1/companion/turns/t1", undefined],
  ["cancelCompanionTurn", ["t1"], "POST", "/api/v1/companion/turns/t1/cancel", {}],
  ["clearCompanionHistory", [], "DELETE", "/api/v1/companion/history", undefined],
  ["uploadCompanionAttachment", [{ filename: "a.png", mediaType: "image/png", base64Data: "AA==" }], "POST", "/api/v1/companion/attachments", { filename: "a.png", mediaType: "image/png", base64Data: "AA==" }],
  ["exportCompanion", [], "GET", "/api/v1/companion/export", undefined],
  ["importCompanionMemories", [[{ content: "x" }], { useMemory: true, learningEnabled: false }], "POST", "/api/v1/companion/import-memories", { version: 2, memories: [{ content: "x" }], controls: { useMemory: true, learningEnabled: false } }],
  ["listUsers", [], "GET", "/api/v1/users", undefined],
  ["getInstanceStorageUsage", [], "GET", "/api/v1/instance/storage-usage", undefined],
  ["createUser", [{ username: "u", password: "p" }], "POST", "/api/v1/users", { username: "u", password: "p" }],
  ["updateUser", ["usr_1", { isDisabled: true }], "PATCH", "/api/v1/users/usr_1", { isDisabled: true }],
  ["logout", [], "POST", "/api/v1/auth/logout", {}],
  ["listNotebooks", [], "GET", "/api/v1/notebooks", undefined],
  ["syncBootstrap", [], "GET", "/api/v1/sync/bootstrap", undefined],
  ["syncChanges", [{ cursor: 7 }], "GET", "/api/v1/sync/changes?cursor=7", undefined],
  ["syncChanges", [{ cursor: 7, limit: 20 }], "GET", "/api/v1/sync/changes?cursor=7&limit=20", undefined],
  ["getMobileSyncChanges", [5], "GET", "/api/v1/sync/changes?cursor=5&limit=100", undefined],
  ["createNotebook", [{ name: "N", parentId: null }], "POST", "/api/v1/notebooks", { name: "N", parentId: null }],
  ["updateNotebook", ["nb_1", { name: "M" }], "PATCH", "/api/v1/notebooks/nb_1", { name: "M" }],
  ["deleteNotebook", ["nb_1"], "DELETE", "/api/v1/notebooks/nb_1", undefined],
  ["restoreNotebook", ["nb_1"], "POST", "/api/v1/notebooks/nb_1/restore", undefined],
  ["listTags", [], "GET", "/api/v1/tags", undefined],
  ["renameTag", ["a/b", "c"], "PATCH", "/api/v1/tags/a%2Fb", { name: "c" }],
  ["deleteTag", ["a b"], "DELETE", "/api/v1/tags/a%20b", undefined],
  ["listApiTokens", [], "GET", "/api/v1/api-tokens", undefined],
  ["createApiToken", [{ name: "CI", scopes: ["read:memos"], expiresAt: null }], "POST", "/api/v1/api-tokens", { name: "CI", scopes: ["read:memos"], expiresAt: null }],
  ["revokeApiToken", ["tok_1"], "DELETE", "/api/v1/api-tokens/tok_1", undefined],
  ["getImportCapabilities", [], "GET", "/api/v1/imports/capabilities", undefined],
  ["importMemos", [{ memos: [] }], "POST", "/api/v1/imports/memos", { memos: [] }],
  ["createMemo", [{ notebookId: "nb", title: "T" }], "POST", "/api/v1/memos", { notebookId: "nb", title: "T" }],
  ["listTemplates", [], "GET", "/api/v1/templates", undefined],
  ["createTemplate", [{ name: "T", contentMarkdown: "x" }], "POST", "/api/v1/templates", { name: "T", contentMarkdown: "x" }],
  ["updateTemplate", ["tpl_1", { name: "U" }], "PATCH", "/api/v1/templates/tpl_1", { name: "U" }],
  ["useTemplate", ["tpl_1", "nb_1"], "POST", "/api/v1/templates/tpl_1/use", { notebookId: "nb_1" }],
  ["useTemplate", ["tpl_1", "nb_1", "pl-PL"], "POST", "/api/v1/templates/tpl_1/use", { notebookId: "nb_1", locale: "pl-PL" }],
  ["deleteTemplate", ["tpl_1"], "DELETE", "/api/v1/templates/tpl_1", undefined],
  ["listScheduledTasks", [], "GET", "/api/v1/scheduled-tasks", undefined],
  ["listScheduledTasks", ["dev 1"], "GET", "/api/v1/scheduled-tasks?executorDeviceId=dev+1", undefined],
  ["listWorkspaceExtensions", [], "GET", "/api/v1/workspace-extensions", undefined],
  ["upsertWorkspaceExtension", ["ext/1", { enabled: true }], "PUT", "/api/v1/workspace-extensions/ext%2F1", { enabled: true }],
  ["deleteWorkspaceExtension", ["ext_1"], "DELETE", "/api/v1/workspace-extensions/ext_1", undefined],
  ["listScheduledTaskRunHistory", [], "GET", "/api/v1/scheduled-task-runs?offset=0&limit=50", undefined],
  ["listScheduledTaskRunHistory", [10, 5], "GET", "/api/v1/scheduled-task-runs?offset=10&limit=5", undefined],
  ["listPluginScheduledTasks", ["plugin.id"], "GET", "/api/v1/scheduled-tasks/plugin/plugin.id", undefined],
  ["upsertPluginScheduledTask", [{ pluginId: "p", scheduleKey: "k" }], "POST", "/api/v1/scheduled-tasks/plugin-upsert", { pluginId: "p", scheduleKey: "k" }],
  ["deletePluginScheduledTask", ["p", "k/1"], "DELETE", "/api/v1/scheduled-tasks/plugin/p/k%2F1", undefined],
  ["createScheduledTask", [{ name: "Daily" }], "POST", "/api/v1/scheduled-tasks", { name: "Daily" }],
  ["updateScheduledTask", ["task_1", { isEnabled: false }], "PATCH", "/api/v1/scheduled-tasks/task_1", { isEnabled: false }],
  ["deleteScheduledTask", ["task_1"], "DELETE", "/api/v1/scheduled-tasks/task_1", undefined],
  ["listScheduledTaskRuns", ["task_1"], "GET", "/api/v1/scheduled-tasks/task_1/runs?offset=0&limit=50", undefined],
  ["claimScheduledTaskRun", ["task_1", { scheduledFor: "2026-01-01", executorDeviceId: "d" }], "POST", "/api/v1/scheduled-tasks/task_1/runs/claim", { scheduledFor: "2026-01-01", executorDeviceId: "d" }],
  ["finishScheduledTaskRun", ["task_1", "run_1", { executorDeviceId: "d", status: "failed", errorMessage: "x" }], "POST", "/api/v1/scheduled-tasks/task_1/runs/run_1/finish", { executorDeviceId: "d", status: "failed", errorMessage: "x" }],
  ["moveMemos", [{ memoIds: ["m1"], notebookId: "nb" }], "POST", "/api/v1/memos/batch/move", { memoIds: ["m1"], notebookId: "nb" }],
  ["deleteMemos", [{ memoIds: ["m1"], permanent: true }], "POST", "/api/v1/memos/batch/delete", { memoIds: ["m1"], permanent: true }],
  ["emptyTrash", [], "DELETE", "/api/v1/memos/trash/empty", undefined],
  ["getMemo", ["m1"], "GET", "/api/v1/memos/m1", undefined],
  ["getMemo", ["m1", { includeDeleted: true }], "GET", "/api/v1/memos/m1?includeDeleted=1", undefined],
  ["getMemoShare", ["m1"], "GET", "/api/v1/memos/m1/share", undefined],
  ["listMemoShares", [], "GET", "/api/v1/memo-shares?offset=0&limit=50", undefined],
  ["createMemoShare", ["m1"], "POST", "/api/v1/memos/m1/share", {}],
  ["updateMemoShare", ["m1", { slug: "s", showBranding: false }], "PATCH", "/api/v1/memos/m1/share", { slug: "s", showBranding: false }],
  ["getTableForm", ["m 1"], "GET", "/api/v1/memos/m%201/form", undefined],
  ["updateTableForm", ["m1", { enabled: true }], "PUT", "/api/v1/memos/m1/form", { enabled: true }],
  ["getPublicTableForm", ["ft"], "GET", "/api/public/forms/ft", undefined],
  ["unlockPublicTableForm", ["ft", "pw"], "POST", "/api/public/forms/ft/unlock", { password: "pw" }],
  ["submitPublicTableForm", ["ft", { a: 1 }], "POST", "/api/public/forms/ft/submissions", { cells: { a: 1 } }],
  ["revokeMemoShare", ["m1"], "DELETE", "/api/v1/memos/m1/share", undefined],
  ["createMemoEditSession", ["m1"], "POST", "/api/v1/memos/m1/edit-sessions", {}],
  ["listMemoRevisions", ["m1"], "GET", "/api/v1/memos/m1/revisions", undefined],
  ["restoreMemoRevision", ["m1", "rev_1"], "POST", "/api/v1/memos/m1/revisions/rev_1/restore", {}],
  ["listResources", [], "GET", "/api/v1/resources", undefined],
  ["renameResource", ["res 1", "a.png"], "PATCH", "/api/v1/resources/res%201", { filename: "a.png" }],
  ["deleteResource", ["res_1"], "DELETE", "/api/v1/resources/res_1", undefined],
  ["restoreJsonNotebooks", [[{ id: "nb" }]], "POST", "/api/v1/restores/json/notebooks", { notebooks: [{ id: "nb" }] }],
  ["restoreJsonMemos", [[{ id: "m" }]], "POST", "/api/v1/restores/json/memos", { memos: [{ id: "m" }] }],
  ["restoreJsonAiPrompts", [[{ id: "p" }]], "POST", "/api/v1/restores/json/ai-prompts", { prompts: [{ id: "p" }] }],
  ["claimPosterRender", [], "POST", "/api/v1/poster-render/claim", {}],
  ["completePosterRender", ["job 1", { claimToken: "c", errorCode: "render_failed" }], "POST", "/api/v1/poster-render/job%201/complete", { claimToken: "c", errorCode: "render_failed" }],
  ["updateMemo", ["m1", { title: "T", expectedRevision: 2 }], "PATCH", "/api/v1/memos/m1", { title: "T", expectedRevision: 2 }],
  ["deleteMemo", ["m1"], "DELETE", "/api/v1/memos/m1", undefined],
  ["deleteMemo", ["m1", { permanent: true }], "DELETE", "/api/v1/memos/m1?permanent=1", undefined],
  ["restoreMemo", ["m1"], "POST", "/api/v1/memos/m1/restore", {}],
  ["duplicateMemo", ["m/1"], "POST", "/api/v1/memos/m%2F1/duplicate", {}],
  ["duplicateMemo", ["m1", { notebookId: "nb", title: "Copy" }], "POST", "/api/v1/memos/m1/duplicate", { notebookId: "nb", title: "Copy" }],
  ["mergeMemos", [{ memoIds: ["a", "b"], title: "Merged" }], "POST", "/api/v1/memos/merge", { memoIds: ["a", "b"], title: "Merged" }],
  ["resetDemo", [], "POST", "/api/v1/demo/reset", undefined],
  ["pluginAi.status", [], "GET", "/api/v1/plugins/ai/status", undefined],
];

const resolveMethod = (client, name) =>
  name.split(".").reduce((target, key) => target[key], client);

describe("EdgeEver client endpoint contract", () => {
  test.each(jsonEndpointCases)("%s sends the documented request", async (name, args, method, path, body) => {
    const responseBody = { value: name };
    const { client, calls } = createRecordingClient(() => jsonResponse(responseBody));

    const result = await resolveMethod(client, name)(...args);

    expect(result).toEqual(responseBody);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.method).toBe(method);
    expect(call.path).toBe(path);
    expect(call.headers.get("Authorization")).toBe("Bearer secret");
    expect(call.headers.get("Content-Type")).toBe("application/json");
    expect(call.init.credentials).toBe("include");
    if (body === undefined) {
      expect(call.body).toBeUndefined();
    } else {
      expect(parsedBody(call)).toEqual(body);
    }
  });

  test("lists memos with every supported filter and omits defaults", async () => {
    const { client, calls } = createRecordingClient(() => jsonResponse({ memos: [] }));

    await client.listMemos({
      notebookId: "nb_1",
      includeDescendants: true,
      q: "  hello  ",
      tag: "  work ",
      trash: true,
      sort: "updated-desc",
      filter: "pinned",
      cursor: "c1",
      limit: 25,
    });
    await client.listMemos({ q: "   ", tag: " ", filter: "all" });

    expect(calls[0].path).toBe(
      "/api/v1/memos?notebookId=nb_1&includeDescendants=1&q=hello&tag=work&trash=1&sort=updated-desc&filter=pinned&cursor=c1&limit=25",
    );
    expect(calls[1].path).toBe("/api/v1/memos?");
  });

  test("maps failed JSON requests to ApiRequestError with server details", async () => {
    const { client } = createRecordingClient(() => jsonResponse(
      { error: { code: "conflict", message: "Revision changed", details: { revision: 4 } } },
      { status: 409, headers: { "Content-Type": "application/json", "cf-ray": " ray-1 " } },
    ));

    const error = await client.updateMemo("m1", { title: "T" }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      name: "ApiRequestError",
      message: "Revision changed",
      status: 409,
      code: "conflict",
      details: { revision: 4 },
      responseDiagnostics: { cloudflareMitigated: false, isEdgeEverApiError: true, rayId: "ray-1" },
    });
  });

  test("falls back to the status text and then a generic message for non-API errors", async () => {
    const statusText = createRecordingClient(() => new Response("<html>", { status: 502, statusText: "Bad Gateway" }));
    await expect(statusText.client.listNotebooks()).rejects.toMatchObject({
      message: "Bad Gateway",
      status: 502,
      code: undefined,
      responseDiagnostics: { isEdgeEverApiError: false },
    });

    const generic = createRecordingClient(() => new Response("", { status: 500 }));
    await expect(generic.client.listNotebooks()).rejects.toMatchObject({ message: "Request failed", status: 500 });
  });

  test("only notifies unauthorized handlers for 401 responses", async () => {
    const unauthorized = [];
    let status = 403;
    const { client } = createRecordingClient(
      () => jsonResponse({ error: { code: "x", message: "denied" } }, { status }),
      { onUnauthorized: (context) => unauthorized.push(context.path) },
    );

    await expect(client.listUsers()).rejects.toMatchObject({ status: 403 });
    status = 401;
    await expect(client.listUsers()).rejects.toMatchObject({ status: 401 });

    expect(unauthorized).toEqual(["/api/v1/users"]);
  });

  test("does not attach a token when none is configured", async () => {
    const { client, calls } = createRecordingClient(() => jsonResponse({}), { token: () => "" });
    await client.listTags();
    expect(calls[0].headers.has("Authorization")).toBe(false);
  });

  test("keeps an explicit Authorization header instead of the configured token", async () => {
    const { client, calls } = createRecordingClient(() => jsonResponse({}));
    await client.getResourceResponse("/api/v1/resources/r1/blob", { headers: { Authorization: "Bearer share" } });
    expect(calls[0].headers.get("Authorization")).toBe("Bearer share");
  });
});

describe("EdgeEver client form uploads", () => {
  test("uploads public form files as multipart without a JSON content type", async () => {
    const { client, calls } = createRecordingClient(() => jsonResponse({ resource: { id: "r1" } }));

    const result = await client.uploadPublicTableFormFile("form/1", new File(["data"], "", { type: "text/plain" }));

    expect(result).toEqual({ resource: { id: "r1" } });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/public/forms/form%2F1/resources");
    expect(calls[0].headers.has("Content-Type")).toBe(false);
    const file = calls[0].body.get("file");
    expect(file.name).toBe("attachment");
    expect(await file.text()).toBe("data");
  });

  test("replaces resource content with filename, type and the concurrency baseline", async () => {
    const { client, calls } = createRecordingClient(() => jsonResponse({ resource: { id: "r1" } }));

    await client.updateResourceContent("res 1", new File(["png"], "pic.png", { type: "image/png" }), "hash-1");
    await client.updateResourceContent("res_2", new Blob(["raw"]), "hash-2");

    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ["PUT", "/api/v1/resources/res%201/blob"],
      ["PUT", "/api/v1/resources/res_2/blob"],
    ]);
    expect(calls[0].body.get("expectedContentHash")).toBe("hash-1");
    expect(calls[0].body.get("mimeType")).toBe("image/png");
    expect(calls[0].body.get("filename")).toBe("pic.png");
    expect(calls[1].body.get("mimeType")).toBe("application/octet-stream");
    expect(calls[1].body.has("filename")).toBe(false);
  });

  test("passes a caller-built FormData through unchanged", async () => {
    const { client, calls } = createRecordingClient(() => jsonResponse({ resource: { id: "r1" } }));
    const form = new FormData();
    form.append("file", new Blob(["x"]), "x.txt");

    await client.uploadMemoResource("m1", form);

    expect(calls[0].path).toBe("/api/v1/memos/m1/resources");
    expect(calls[0].body).toBe(form);
  });

  test("names unnamed small blobs as attachments", async () => {
    const { client, calls } = createRecordingClient(() => jsonResponse({ resource: { id: "r1" } }));
    await client.uploadMemoResource("m1", new Blob(["x"], { type: "text/plain" }));
    expect(calls[0].body.get("file").name).toBe("attachment");
  });
});

describe("EdgeEver client binary and plugin endpoints", () => {
  test("reads the community registry bytes and signature, or null when absent", async () => {
    let status = 200;
    const { client, calls } = createRecordingClient(() => new Response(
      status === 200 ? new Uint8Array([1, 2, 3]) : "missing",
      { status, headers: status === 200 ? { "x-edgeever-community-registry-signature": "sig" } : {} },
    ));

    const registry = await client.getCommunityPluginRegistry();
    expect(new Uint8Array(registry.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(registry.signatureBase64).toBe("sig");
    expect(calls[0].path).toBe("/api/v1/plugins/community-registry");
    expect(calls[0].headers.has("Content-Type")).toBe(false);

    status = 404;
    expect(await client.getCommunityPluginRegistry()).toBeNull();

    status = 500;
    await expect(client.getCommunityPluginRegistry()).rejects.toMatchObject({
      message: "Community registry request failed",
      status: 500,
    });
  });

  test("returns an empty registry signature when the header is missing", async () => {
    const { client } = createRecordingClient(() => new Response(new Uint8Array([9])));
    expect((await client.getCommunityPluginRegistry()).signatureBase64).toBe("");
  });

  test("reads GitHub releases, treating 404 as no release", async () => {
    let status = 200;
    const release = { tag_name: "v1.0.0", draft: false, assets: [] };
    const { client, calls } = createRecordingClient(() => (status === 200
      ? jsonResponse(release)
      : new Response("", { status })));

    expect(await client.getGithubPluginRelease("own er", "repo", "v1.0.0")).toEqual(release);
    expect(calls[0].path).toBe("/api/v1/plugins/github/own%20er/repo/releases/tags/v1.0.0");

    status = 404;
    expect(await client.getGithubPluginRelease("o", "r", "v2")).toBeNull();

    status = 403;
    await expect(client.getGithubPluginRelease("o", "r", "v2")).rejects.toMatchObject({
      message: "GitHub plugin release request failed",
      status: 403,
    });
  });

  test("reads the latest-release manifest as text and reports failures", async () => {
    let ok = true;
    const { client, calls } = createRecordingClient(() => (ok
      ? new Response('{"id":"plugin"}')
      : new Response("", { status: 404 })));

    expect(await client.getGithubPluginLatestManifest("o", "r")).toBe('{"id":"plugin"}');
    expect(calls[0].path).toBe("/api/v1/plugins/github/o/r/latest-manifest");

    ok = false;
    await expect(client.getGithubPluginLatestManifest("o", "r")).rejects.toMatchObject({
      message: "GitHub plugin latest-release manifest request failed",
    });
    await expect(client.getGithubPluginRepositoryManifest("o", "r")).rejects.toMatchObject({
      message: "GitHub plugin manifest request failed",
    });
  });

  test("reports binary and resource download failures with their fallback messages", async () => {
    const { client } = createRecordingClient(() => new Response("", { status: 500 }));
    await expect(client.downloadGithubPluginAsset("o", "r", "v1", "main.js")).rejects.toMatchObject({
      message: "Binary download failed",
    });
    await expect(client.getResourceBlob("/api/v1/resources/r/blob")).rejects.toMatchObject({
      message: "Resource download failed",
    });
  });

  test("proxies public plugin network requests and decodes upstream metadata", async () => {
    const { client, calls } = createRecordingClient(() => new Response("payload", {
      status: 200,
      headers: {
        "x-edgeever-upstream-status": "201",
        "x-edgeever-upstream-status-text": encodeURIComponent("Created ok"),
        "x-edgeever-upstream-header-content-type": "text/plain",
        "x-unrelated": "ignored",
      },
    }));

    const response = await client.pluginNetwork.fetchPublic({ url: "https://example.com/data", method: "GET" });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/api/v1/plugins/network/fetch");
    expect(parsedBody(calls[0])).toEqual({ url: "https://example.com/data", method: "GET" });
    expect(response.url).toBe("https://example.com/data");
    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created ok");
    expect(response.headers).toEqual({ "content-type": "text/plain" });
    expect(new TextDecoder().decode(response.body)).toBe("payload");
  });

  test("rejects public plugin responses without a valid upstream status", async () => {
    let headers = {};
    let status = 200;
    const { client } = createRecordingClient(() => new Response("", { status, headers }));

    await expect(client.pluginNetwork.fetchPublic({ url: "https://example.com" })).rejects.toMatchObject({
      message: "Public network request failed",
    });

    headers = { "x-edgeever-upstream-status": "99" };
    await expect(client.pluginNetwork.fetchPublic({ url: "https://example.com" })).rejects.toThrow(
      "Invalid public network response status",
    );

    headers = { "x-edgeever-upstream-status": "200" };
    status = 502;
    await expect(client.pluginNetwork.fetchPublic({ url: "https://example.com" })).rejects.toMatchObject({ status: 502 });
  });
});

describe("EdgeEver client direct AI preparation", () => {
  const preparedText = {
    provider: "openai-compatible",
    baseUrl: "https://models.example/v1",
    apiKey: "model-key",
    modelId: "m",
    system: "s",
    prompt: "p",
    maxOutputTokens: 10,
  };

  test("reports instances without direct AI preparation as unavailable", async () => {
    for (const status of [404, 410]) {
      const { client, calls } = createRecordingClient(() => new Response("", { status }));
      await expect(client.streamAiGeneration(
        { action: "summarize", title: "T", contentMarkdown: "B" },
        { onEvent() {} },
      )).rejects.toMatchObject({ status: 409, code: "ai_direct_unavailable" });
      await expect(client.resumeCompanionTurn("turn 1", {}, { onEvent() {} }))
        .rejects.toMatchObject({ code: "ai_direct_unavailable" });
      expect(calls.map((call) => call.path)).toEqual([
        "/api/v1/ai/generate/prepare",
        "/api/v1/companion/turns/turn%201/resume/prepare",
      ]);
    }

    const { client } = createRecordingClient(() => new Response("", { status: 404 }));
    await expect(client.suggestAiTags({ title: "T", contentMarkdown: "B" }))
      .rejects.toMatchObject({ code: "ai_direct_unavailable" });
    await expect(client.checkCompanionDiscoveries("en"))
      .rejects.toMatchObject({ code: "ai_direct_unavailable" });
    await expect(client.pluginAi.generate({ prompt: "x" }))
      .rejects.toMatchObject({ code: "ai_direct_unavailable" });
  });

  test("rejects malformed prepare responses without contacting a model provider", async () => {
    const providerCalls = [];
    const { client } = createRecordingClient(() => jsonResponse({ provider: "unknown" }), {
      providerFetch: async (url) => { providerCalls.push(String(url)); return new Response(""); },
    });

    await expect(client.streamAiGeneration({ action: "summarize", title: "T", contentMarkdown: "B" }, { onEvent() {} }))
      .rejects.toMatchObject({ status: 502, code: "ai_generation_failed" });
    await expect(client.suggestAiTags({ title: "T", contentMarkdown: "B" }))
      .rejects.toMatchObject({ status: 502, code: "ai_tag_suggestions_failed" });
    await expect(client.checkCompanionDiscoveries("en"))
      .rejects.toMatchObject({ status: 502, code: "companion_failed" });
    await expect(client.pluginAi.generate({ prompt: "x" }))
      .rejects.toMatchObject({ status: 502, code: "plugin_ai_failed" });
    await expect(client.resumeCompanionTurn("t1", undefined, { onEvent() {} }))
      .rejects.toMatchObject({ status: 502, code: "companion_failed" });
    expect(providerCalls).toEqual([]);
  });

  test("surfaces prepare errors from the instance", async () => {
    const { client } = createRecordingClient(() => jsonResponse(
      { error: { code: "ai_not_configured", message: "Choose a model" } },
      { status: 409 },
    ));

    for (const run of [
      () => client.streamAiGeneration({ action: "summarize", title: "T", contentMarkdown: "B" }, { onEvent() {} }),
      () => client.suggestAiTags({ title: "T", contentMarkdown: "B" }),
      () => client.checkCompanionDiscoveries("en"),
      () => client.pluginAi.generate({ prompt: "x" }),
      () => client.streamInfographicAgent({ prompt: "x", candidates: [] }, { onEvent() {} }),
      () => client.testAiProvider("aip_1", { modelId: "m" }),
      () => client.discoverAiProviderModels("aip_1"),
    ]) {
      await expect(run()).rejects.toMatchObject({ status: 409, code: "ai_not_configured" });
    }
  });

  test("does not send a request when the signal is already aborted", async () => {
    const { client, calls } = createRecordingClient();
    const controller = new AbortController();
    controller.abort();

    await expect(client.streamAiGeneration(
      { action: "summarize", title: "T", contentMarkdown: "B" },
      { signal: controller.signal, onEvent() {} },
    )).rejects.toThrow();
    await expect(client.suggestAiTags({ title: "T", contentMarkdown: "B" }, controller.signal)).rejects.toThrow();
    await expect(client.streamCompanion({ id: "r", message: "hi" }, { signal: controller.signal, onEvent() {} })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  test("returns quiet discovery results without calling a model", async () => {
    const providerCalls = [];
    const items = [{ id: "d1" }];
    const { client, calls } = createRecordingClient(() => jsonResponse({ quiet: true, items }), {
      providerFetch: async (url) => { providerCalls.push(String(url)); return new Response(""); },
    });

    expect(await client.checkCompanionDiscoveries("zh-CN")).toEqual({ items });
    expect(calls.map((call) => [call.method, call.path, call.body])).toEqual([
      ["POST", "/api/v1/companion/discovery/check/prepare?locale=zh-CN", "{}"],
    ]);
    expect(providerCalls).toEqual([]);
  });

  test("sends tag suggestion requests to the model provider directly without instance credentials", async () => {
    const providerCalls = [];
    const { client, calls } = createRecordingClient(() => jsonResponse({
      ...preparedText,
      currentTags: [],
      canonicalTags: { react: "React" },
    }), {
      providerFetch: async (url, init) => {
        providerCalls.push({ url: String(url), init, headers: new Headers(init.headers) });
        return jsonResponse({ choices: [{ message: { content: '{"tags":["react"]}' } }] });
      },
    });

    const result = await client.suggestAiTags({ title: "T", contentMarkdown: "React hooks" });

    expect(calls.map((call) => call.path)).toEqual(["/api/v1/ai/tag-suggestions/prepare"]);
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0].url.startsWith("https://models.example/v1")).toBe(true);
    expect(providerCalls[0].init.credentials).toBe("omit");
    expect(providerCalls[0].init.redirect).toBe("error");
    expect(providerCalls[0].headers.get("Authorization")).not.toBe("Bearer secret");
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  test("exposes a provider fetch that never shares instance cookies or follows redirects", async () => {
    const providerCalls = [];
    const { client, calls } = createRecordingClient(undefined, {
      providerFetch: async (url, init) => { providerCalls.push({ url: String(url), init }); return new Response("ok"); },
    });

    const response = await client.fetchAiProvider("https://models.example/v1/models", { method: "GET" });

    expect(await response.text()).toBe("ok");
    expect(providerCalls[0].init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error" });
    expect(calls).toEqual([]);
  });
});

describe("EdgeEver client JSON resource restore", () => {
  test("aborts the restore upload when reading the source fails", async () => {
    const { client, calls } = createRecordingClient((call) => (call.path.endsWith("/uploads")
      ? jsonResponse({ upload: { id: "up 1", partSize: 1024, partCount: 1 } })
      : jsonResponse({ ok: true })));
    const failing = new Blob([]);
    failing.stream = () => new ReadableStream({
      pull(controller) { controller.error(new Error("disk read failed")); },
    });

    await expect(client.restoreJsonResource("res_1", { id: "res_1", filename: "a.txt" }, failing))
      .rejects.toThrow("disk read failed");

    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ["POST", "/api/v1/restores/json/resources/res_1/uploads"],
      ["DELETE", "/api/v1/resource-uploads/up%201"],
    ]);
  });
});

describe("EdgeEver client direct AI runs", () => {
  const companionTurn = {
    turn: {
      id: "11111111-1111-1111-1111-111111111111",
      threadId: "22222222-2222-2222-2222-222222222222",
      message: "hi",
      response: "",
      process: "",
      status: "running",
      sources: [],
      tools: [],
      todos: [],
      questions: [],
      mentions: [],
      model: "direct-model",
      inputTokens: null,
      outputTokens: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    provider: "openai-compatible",
    baseUrl: "https://models.example/v1",
    apiKey: "model-key",
    modelId: "m",
    instructions: "You are EdgeEver.",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    maxSteps: 2,
    maxOutputTokens: 64,
  };
  const streamedReply = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
    + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

  test("relays a CORS-blocked companion request through the instance and completes the turn", async () => {
    const relayed = [];
    const { client, calls } = createRecordingClient(async (call) => {
      if (call.path.endsWith("/resume/prepare")) return jsonResponse(companionTurn);
      if (call.path === "/api/v1/ai/provider-relay") {
        relayed.push({
          target: call.headers.get("x-edgeever-ai-target"),
          method: call.headers.get("x-edgeever-ai-method"),
          forwarded: JSON.parse(call.headers.get("x-edgeever-ai-headers")),
          contentType: call.headers.get("Content-Type"),
          authorization: call.headers.get("Authorization"),
          hasBody: call.body !== undefined,
        });
        return new Response(streamedReply, { headers: { "content-type": "text/event-stream" } });
      }
      if (call.path.endsWith("/complete")) {
        const body = JSON.parse(call.body);
        return jsonResponse({ turn: { ...companionTurn.turn, ...body } });
      }
      throw new Error(`Unexpected request ${call.path}`);
    }, {
      allowAiServerFallback: true,
      providerFetch: async () => { throw new TypeError("Failed to fetch"); },
    });
    const events = [];

    await client.resumeCompanionTurn(companionTurn.turn.id, { answers: {} }, { onEvent: (event) => events.push(event) });

    expect(calls.map((call) => call.path)).toEqual([
      `/api/v1/companion/turns/${companionTurn.turn.id}/resume/prepare`,
      "/api/v1/ai/provider-relay",
      `/api/v1/companion/turns/${companionTurn.turn.id}/complete`,
    ]);
    expect(relayed).toHaveLength(1);
    expect(relayed[0]).toMatchObject({
      target: "https://models.example/v1/chat/completions",
      method: "POST",
      contentType: "application/octet-stream",
      authorization: "Bearer secret",
      hasBody: true,
    });
    expect(events).toContainEqual({ type: "text-delta", text: "Hello" });
    expect(events.at(-1)).toMatchObject({ type: "done", turn: { status: "completed" } });
  });

  test("does not relay through the instance unless server fallback is allowed", async () => {
    const { client, calls } = createRecordingClient(async (call) => {
      if (call.path.endsWith("/prepare")) return jsonResponse(companionTurn);
      if (call.path.endsWith("/complete")) return jsonResponse({ turn: { ...companionTurn.turn, ...JSON.parse(call.body) } });
      throw new Error(`Unexpected request ${call.path}`);
    }, {
      providerFetch: async () => { throw new TypeError("Failed to fetch"); },
    });
    const events = [];

    await client.streamCompanion({ id: companionTurn.turn.id, message: "hi" }, { onEvent: (event) => events.push(event) }).catch(() => undefined);

    expect(calls.map((call) => call.path)).not.toContain("/api/v1/ai/provider-relay");
  });

  test("generates plugin text with the prepared model directly", async () => {
    const providerCalls = [];
    const { client, calls } = createRecordingClient(() => jsonResponse({
      provider: "openai-compatible",
      baseUrl: "https://models.example/v1",
      apiKey: "model-key",
      modelId: "m",
      system: "s",
      prompt: "p",
      maxOutputTokens: 10,
    }), {
      providerFetch: async (url, init) => {
        providerCalls.push({ url: String(url), headers: new Headers(init.headers) });
        return jsonResponse({ choices: [{ message: { content: "Plugin answer" } }] });
      },
    });

    const result = await client.pluginAi.generate({ prompt: "Say hi", system: "Be brief" });

    expect(result).toEqual({ text: "Plugin answer" });
    expect(calls.map((call) => [call.method, call.path])).toEqual([["POST", "/api/v1/plugins/ai/generate/prepare"]]);
    expect(parsedBody(calls[0])).toEqual({ prompt: "Say hi", system: "Be brief" });
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0].headers.get("Authorization")).toBe("Bearer model-key");
  });
});
