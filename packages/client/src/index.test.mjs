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
});
