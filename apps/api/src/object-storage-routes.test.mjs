import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { registerObjectStorageRoutes } from "./object-storage-routes.ts";

const auth = {
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

const createApp = ({ currentAuth = auth, demoMode = false } = {}) => {
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", currentAuth);
    await next();
  });
  registerObjectStorageRoutes(app, { isDemoMode: () => demoMode });
  return app;
};

describe("object storage route contracts", () => {
  test("rejects non-owner settings access before storage reads", async () => {
    const app = createApp({ currentAuth: { ...auth, role: "member" } });
    const response = await app.request(
      "/api/v1/instance/object-storage",
      {},
      environment,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  test("keeps demo storage immutable", async () => {
    const app = createApp({ demoMode: true });
    const response = await app.request(
      "/api/v1/instance/object-storage",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "builtin" }),
      },
      environment,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });
});
