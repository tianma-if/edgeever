import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { registerAuthRoutes } from "./auth-routes.ts";

const interactiveAuth = {
  kind: "user",
  actorType: "user",
  actorId: "usr_owner",
  username: "owner",
  displayName: "Owner",
  scopes: [],
  workspaceId: "ws_owner",
  role: "owner",
  sessionId: "session_current",
};

const environment = {
  storage: {
    db: {
      prepare: () => {
        throw new Error("Database access was not expected");
      },
      batch: async () => [],
    },
    resources: {},
  },
};

const createApp = (overrides = {}) => {
  const app = new Hono();
  registerAuthRoutes(app, {
    authenticateRequest: async () => null,
    authenticateSession: async () => null,
    createSession: async () => ({ id: "session", token: "token", maxAge: 60 }),
    ensureUserWorkspace: async () => ({ workspaceId: "workspace", role: "owner" }),
    getBearerToken: () => null,
    getInstanceAuthMode: async () => "required",
    getLoginAttemptKeys: async () => [],
    isDemoEnvironment: () => false,
    isDemoMode: () => false,
    revokeSession: async () => undefined,
    setSessionCookie: () => undefined,
    tooManyLoginAttempts: () => new Response(null, { status: 429 }),
    verifyLogin: async () => null,
    ...overrides,
  });
  return app;
};

describe("auth route contracts", () => {
  test("reports the local owner when authentication is disabled", async () => {
    const app = createApp({
      getInstanceAuthMode: async () => "disabled",
      isDemoEnvironment: () => true,
    });
    const response = await app.request("/api/v1/auth/session", {}, environment);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authRequired: false,
      authenticated: true,
      demoMode: true,
      user: {
        id: "local",
        username: "owner",
        displayName: "Owner",
        role: "owner",
      },
    });
  });

  test("reports an anonymous required-auth session without touching storage", async () => {
    const app = createApp();
    const response = await app.request("/api/v1/auth/session", {}, environment);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      authRequired: true,
      authenticated: false,
      user: null,
    });
  });

  test("does not allow the current session to revoke itself", async () => {
    const app = createApp({ authenticateRequest: async () => interactiveAuth });
    const response = await app.request(
      "/api/v1/auth/sessions/session_current",
      { method: "DELETE" },
      environment,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "current_session_cannot_be_revoked" },
    });
  });
});
