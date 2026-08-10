import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { AI_ACTIONS, AiGenerateSchema } from "@edgeever/shared";
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

class SqliteD1PreparedStatement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new SqliteD1PreparedStatement(this.db, this.sql, bindings);
  }

  async all() {
    return { results: this.db.query(this.sql).all(...this.bindings), success: true, meta: {} };
  }

  async first() {
    return this.db.query(this.sql).get(...this.bindings) ?? null;
  }

  async run() {
    this.db.query(this.sql).run(...this.bindings);
    return { success: true, meta: {} };
  }
}

class SqliteD1Database {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new SqliteD1PreparedStatement(this.db, sql);
  }

  async batch(statements) {
    return this.db.transaction(() => statements.map((statement) =>
      this.db.query(statement.sql).run(...statement.bindings)))();
  }
}

const createDatabaseEnvironment = () => {
  const sqlite = new Database(":memory:");
  for (const migration of globSync("migrations/*.sql").sort()) {
    sqlite.exec(readFileSync(migration, "utf8"));
  }
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)")
    .run("ws_member", "Member workspace");
  return {
    sqlite,
    environment: {
      storage: { db: new SqliteD1Database(sqlite), resources: {} },
      EDGE_EVER_STORAGE_ENCRYPTION_KEY: "x".repeat(32),
    },
  };
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
  isEnabled: true,
  initialModelId: "model-a",
};

describe("AI route contracts", () => {
  test("accepts the shared semantic action catalog with required parameters", () => {
    for (const action of AI_ACTIONS) {
      const parsed = AiGenerateSchema.safeParse({
        action,
        title: "Note",
        contentMarkdown: "Body",
        ...(action === "translate" ? { targetLanguage: "en" } : {}),
        ...(action === "change-tone" ? { tone: "friendly" } : {}),
        ...(action === "custom" ? { instruction: "Keep every date." } : {}),
      });
      expect(parsed.success, action).toBe(true);
    }
  });

  test("does not allow API tokens to manage personal AI credentials", async () => {
    const app = createApp({ currentAuth: { ...auth, kind: "agent", actorType: "agent" } });
    const response = await app.request("/api/v1/ai/settings", {}, environment);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  test("keeps demo AI settings immutable", async () => {
    const app = createApp({ demoMode: true });
    const response = await app.request(
      "/api/v1/ai/providers",
      {
        method: "POST",
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
      "/api/v1/ai/providers",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...validSettings, baseUrl: "https://user:pass@models.example.com/v1" }),
      },
      environment,
    );
    expect(response.status).toBe(400);
  });

  test("rejects actions outside the shared note-processing catalog", async () => {
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

  test("bounds custom editing instructions", async () => {
    const app = createApp();
    const response = await app.request(
      "/api/v1/ai/generate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "rewrite-proofread",
          title: "Note",
          contentMarkdown: "Body",
          instruction: "x".repeat(2_001),
        }),
      },
      environment,
    );
    expect(response.status).toBe(400);
  });

  test("stores multiple models under one OpenRouter-style provider", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const createResponse = await app.request(
      "/api/v1/ai/providers",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...validSettings,
          displayName: "OpenRouter",
          baseUrl: "https://openrouter.ai/api/v1/",
          initialModelId: "openai/gpt-4.1",
        }),
      },
      databaseEnvironment,
    );
    const created = await createResponse.json();
    expect({ status: createResponse.status, created }).toMatchObject({ status: 201 });
    const provider = created.providers[0];
    expect(provider).toMatchObject({
      displayName: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      isEnabled: true,
    });
    expect(created.readOnly).toBe(false);
    expect(provider.models.map((model) => model.modelId)).toEqual(["openai/gpt-4.1"]);
    expect(created.defaultModelId).toBe(provider.models[0].id);

    const addResponse = await app.request(
      `/api/v1/ai/providers/${provider.id}/models`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelId: "anthropic/claude-sonnet-4",
          displayName: "Claude Sonnet 4",
        }),
      },
      databaseEnvironment,
    );
    expect(addResponse.status).toBe(201);
    const withTwoModels = await addResponse.json();
    expect(withTwoModels.providers[0].models.map((model) => model.modelId)).toEqual([
      "openai/gpt-4.1",
      "anthropic/claude-sonnet-4",
    ]);

    const disableResponse = await app.request(
      `/api/v1/ai/providers/${provider.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "openai-compatible",
          displayName: "OpenRouter",
          baseUrl: "https://openrouter.ai/api/v1",
          isEnabled: false,
        }),
      },
      databaseEnvironment,
    );
    expect(disableResponse.status).toBe(200);
    expect((await disableResponse.json()).providers[0].isEnabled).toBe(false);

    sqlite.close();
  });

  test("reports public demo AI settings as read-only", async () => {
    const app = createApp({ demoMode: true });
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const response = await app.request("/api/v1/ai/settings", {}, databaseEnvironment);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ readOnly: true });
    sqlite.close();
  });
});
