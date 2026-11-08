import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mapApiToken, registerApiTokenRoutes } from "./api-token-routes.ts";

const userAuth = {
  kind: "user",
  actorType: "user",
  actorId: "usr_owner",
  username: "owner",
  displayName: "Owner",
  scopes: [],
  workspaceId: "ws_owner",
  role: "owner",
};

const environment = {
  storage: {
    db: {
      prepare: () => { throw new Error("Unexpected database access"); },
      batch: async () => [],
    },
    resources: {},
  },
};

const createApp = (auth) => {
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", auth);
    await next();
  });
  registerApiTokenRoutes(app, { sha256: async () => "hash" });
  return app;
};

describe("API token route contracts", () => {
  test("does not expose token management to API tokens", async () => {
    const app = createApp({ ...userAuth, kind: "agent", actorType: "agent" });
    const response = await app.request("/api/v1/api-tokens", {}, environment);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  test("rejects unsupported scopes before persistence", async () => {
    const response = await createApp(userAuth).request(
      "/api/v1/api-tokens",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "automation", scopes: ["admin:everything"] }),
      },
      environment,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "bad_request" } });
  });

  test("maps stored scopes without leaking the token hash", () => {
    expect(mapApiToken({
      id: "tok_1",
      name: "Reader",
      token_value: null,
      scopes_json: '["read:memos"]',
      notebook_access_json: null,
      notebook_default_access: null,
      last_used_at: null,
      expires_at: null,
      is_revoked: 0,
      created_at: "2026-08-08T00:00:00.000Z",
      workspace_id: "ws_owner",
    })).toEqual({
      id: "tok_1",
      name: "Reader",
      token: null,
      scopes: ["read:memos"],
      notebookAccess: null,
      notebookDefaultAccess: "none",
      lastUsedAt: null,
      expiresAt: null,
      isRevoked: false,
      createdAt: "2026-08-08T00:00:00.000Z",
    });
  });

  test("maps stored notebook grants", () => {
    expect(mapApiToken({
      id: "tok_2",
      name: "Scoped",
      token_value: "eev_x",
      scopes_json: '["read:memos","write:memos"]',
      notebook_access_json: '[{"notebookId":"nb_a","read":true,"write":true},{"notebookId":"nb_b","read":true,"write":false}]',
      notebook_default_access: "read",
      last_used_at: null,
      expires_at: null,
      is_revoked: 0,
      created_at: "2026-08-08T00:00:00.000Z",
      workspace_id: "ws_owner",
    }).notebookAccess).toEqual([
      { notebookId: "nb_a", read: true, write: true },
      { notebookId: "nb_b", read: true, write: false },
    ]);
    expect(mapApiToken({
      id: "tok_2",
      name: "Scoped",
      token_value: "eev_x",
      scopes_json: '["read:memos"]',
      notebook_access_json: null,
      notebook_default_access: "bogus",
      last_used_at: null,
      expires_at: null,
      is_revoked: 0,
      created_at: "2026-08-08T00:00:00.000Z",
      workspace_id: "ws_owner",
    }).notebookDefaultAccess).toBe("none");
  });
});
