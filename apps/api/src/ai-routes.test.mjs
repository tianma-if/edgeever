import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { registerAiRoutes } from "./ai-routes.ts";

const auth = {
  kind: "user",
  actorType: "user",
  actorId: "usr_member",
  username: "member",
  displayName: "Member",
  scopes: [],
  workspaceId: "ws_member",
  role: "member",
};

const environment = {
  storage: {
    db: {
      prepare: () => { throw new Error("Unexpected database access"); },
      batch: async () => [],
    },
    resources: {},
  },
  EDGE_EVER_STORAGE_ENCRYPTION_KEY: "x".repeat(32),
};

const createApp = ({ currentAuth = auth, demoMode = false } = {}) => {
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", currentAuth);
    await next();
  });
  registerAiRoutes(app, { isDemoMode: () => demoMode });
  return app;
};

const validSettings = {
  provider: "openai-compatible",
  displayName: "Cloud model",
  baseUrl: "https://models.example.com/v1",
  apiKey: "secret",
  modelId: "model-a",
  isEnabled: true,
};

describe("AI route contracts", () => {
  test("does not allow API tokens to manage personal AI credentials", async () => {
    const app = createApp({ currentAuth: { ...auth, kind: "agent", actorType: "agent" } });
    const response = await app.request("/api/v1/ai/settings", {}, environment);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  test("keeps demo AI settings immutable", async () => {
    const app = createApp({ demoMode: true });
    const response = await app.request(
      "/api/v1/ai/settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validSettings),
      },
      environment,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  test("rejects credentials embedded in a Base URL", async () => {
    const app = createApp();
    const response = await app.request(
      "/api/v1/ai/settings",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...validSettings, baseUrl: "https://user:pass@models.example.com/v1" }),
      },
      environment,
    );
    expect(response.status).toBe(400);
  });

  test("rejects actions outside the first note-processing release", async () => {
    const app = createApp();
    const response = await app.request(
      "/api/v1/ai/generate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "continue", title: "Note", contentMarkdown: "Body" }),
      },
      environment,
    );
    expect(response.status).toBe(400);
  });

  test("requires a target language for translation", async () => {
    const app = createApp();
    const response = await app.request(
      "/api/v1/ai/generate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "translate", title: "Note", contentMarkdown: "Body" }),
      },
      environment,
    );
    expect(response.status).toBe(400);
  });
});
