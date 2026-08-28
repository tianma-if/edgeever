import { describe, expect, test } from "bun:test";
import { ApiRequestError, createEdgeEverClient } from "./index.ts";

const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "Content-Type": "application/json" },
  ...init,
});

describe("EdgeEver client HTTP contract", () => {
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

  test("keeps multipart restore bodies free of a synthetic JSON content type", async () => {
    let headers;
    const client = createEdgeEverClient({
      fetch: async (_input, init) => {
        headers = new Headers(init.headers);
        return jsonResponse({ ok: true });
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
        size: 1,
        url: "/blob",
        createdAt: "",
        updatedAt: "",
      },
      new Blob(["x"]),
    );
    expect(headers.has("Content-Type")).toBe(false);
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
