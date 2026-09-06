import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { registerUserRoutes } from "./user-routes.ts";

const ownerAuth = {
  kind: "user",
  actorType: "user",
  actorId: "usr_owner",
  username: "owner",
  displayName: "Owner",
  scopes: [],
  workspaceId: "ws_owner",
  role: "owner",
};

const createEnvironment = (rows = []) => ({
  storage: {
    db: {
      prepare: () => ({
        all: async () => ({ results: rows }),
      }),
      batch: async () => [],
    },
    resources: {},
  },
});

const createApp = (authenticateRequest) => {
  const app = new Hono();
  registerUserRoutes(app, {
    authenticateRequest,
    getInstanceUser: async () => null,
  });
  return app;
};

describe("user route contracts", () => {
  test("rejects unauthenticated user listing", async () => {
    const app = createApp(async () => null);
    const response = await app.request("/api/v1/users", {}, createEnvironment());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  test("rejects non-owner user listing", async () => {
    const app = createApp(async () => ({ ...ownerAuth, role: "member" }));
    const response = await app.request("/api/v1/users", {}, createEnvironment());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  test("maps owner-visible users at the HTTP boundary", async () => {
    const app = createApp(async () => ownerAuth);
    const response = await app.request("/api/v1/users", {}, createEnvironment([{
      id: "usr_member",
      username: "writer",
      password_hash: "hidden",
      display_name: "Writer",
      is_disabled: 0,
      last_login_at: null,
      created_at: "2026-08-08T00:00:00.000Z",
      role: "member",
    }]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      users: [{
        id: "usr_member",
        username: "writer",
        displayName: "Writer",
        role: "member",
        isDisabled: false,
        lastLoginAt: null,
        createdAt: "2026-08-08T00:00:00.000Z",
      }],
    });
  });
});
