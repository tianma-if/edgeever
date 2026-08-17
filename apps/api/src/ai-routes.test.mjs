import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import {
  AI_ACTIONS,
  AiGenerateSchema,
  AiTagSuggestionsRequestSchema,
  DEFAULT_AI_TAG_SUGGESTION_PROMPT,
  DEFAULT_AI_TAG_SUGGESTION_PROMPT_ZH_CN,
} from "@edgeever/shared";
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

const createApp = ({ currentAuth = auth, demoMode = false, suggestTags, testConnection } = {}) => {
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", currentAuth);
    await next();
  });
  registerAiRoutes(app, { isDemoMode: () => demoMode, suggestTags, testConnection });
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

  test("defaults AI generation to non-streaming and accepts an explicit opt-in", () => {
    const input = { action: "summarize", title: "Note", contentMarkdown: "Body" };
    expect(AiGenerateSchema.parse(input).stream).toBe(false);
    expect(AiGenerateSchema.parse({ ...input, stream: true }).stream).toBe(true);
  });

  test("validates AI tag suggestion inputs without requiring saved note content", () => {
    expect(AiTagSuggestionsRequestSchema.safeParse({
      title: "Unsaved title",
      contentMarkdown: "",
      currentTags: ["draft"],
      locale: "en-US",
    }).success).toBe(true);
    expect(AiTagSuggestionsRequestSchema.safeParse({
      title: "",
      contentMarkdown: "   ",
    }).success).toBe(false);
  });

  test("stores and restores the workspace AI tag suggestion prompt", async () => {
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const app = createApp();

    const initial = await app.request("/api/v1/ai/settings", {}, databaseEnvironment);
    expect(await initial.json()).toMatchObject({
      tagSuggestionPrompt: DEFAULT_AI_TAG_SUGGESTION_PROMPT,
      tagSuggestionPromptCustomized: false,
    });

    const initialChinese = await app.request("/api/v1/ai/settings?locale=zh-CN", {}, databaseEnvironment);
    expect(await initialChinese.json()).toMatchObject({
      tagSuggestionPrompt: DEFAULT_AI_TAG_SUGGESTION_PROMPT_ZH_CN,
      tagSuggestionPromptCustomized: false,
    });

    const customized = await app.request(
      "/api/v1/ai/tag-suggestion-prompt",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "只推荐人物、作品类型和创作手法。" }),
      },
      databaseEnvironment,
    );
    expect(customized.status).toBe(200);
    expect(await customized.json()).toMatchObject({
      tagSuggestionPrompt: "只推荐人物、作品类型和创作手法。",
      tagSuggestionPromptCustomized: true,
    });

    const customizedEnglish = await app.request("/api/v1/ai/settings?locale=en-US", {}, databaseEnvironment);
    expect(await customizedEnglish.json()).toMatchObject({
      tagSuggestionPrompt: "只推荐人物、作品类型和创作手法。",
      tagSuggestionPromptCustomized: true,
    });

    const restored = await app.request(
      "/api/v1/ai/tag-suggestion-prompt?locale=zh-CN",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: null }),
      },
      databaseEnvironment,
    );
    expect(await restored.json()).toMatchObject({
      tagSuggestionPrompt: DEFAULT_AI_TAG_SUGGESTION_PROMPT_ZH_CN,
      tagSuggestionPromptCustomized: false,
    });
    sqlite.close();
  });

  test("returns normalized AI tag suggestions and reuses canonical workspace tags", async () => {
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    sqlite.query("INSERT INTO notebooks (id, workspace_id, name) VALUES (?, ?, ?)")
      .run("nb_member", "ws_member", "Inbox");
    sqlite.query("INSERT INTO memos (id, workspace_id, notebook_id, title, tags_json) VALUES (?, ?, ?, ?, ?)")
      .run("memo_member", "ws_member", "nb_member", "React note", JSON.stringify(["React", "Current"]));
    sqlite.query("INSERT INTO memo_contents (memo_id, content_json, content_markdown, content_text, content_hash) VALUES (?, ?, ?, ?, ?)")
      .run("memo_member", JSON.stringify({ type: "doc", content: [] }), "Body", "Body", "hash");
    let receivedInput = null;
    const app = createApp({
      suggestTags: async (input) => {
        receivedInput = input;
        return ["react", "#new-topic", "new-topic", "Current"];
      },
    });
    const response = await app.request(
      "/api/v1/ai/tag-suggestions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Unsaved title",
          contentMarkdown: "Unsaved body",
          currentTags: ["Current"],
          locale: "en-US",
        }),
      },
      databaseEnvironment,
    );

    expect(response.status).toBe(200);
    expect(receivedInput).toMatchObject({
      title: "Unsaved title",
      currentTags: ["Current"],
      existingTags: ["Current", "React"],
    });
    expect(await response.json()).toEqual({
      suggestions: [
        { name: "React", existing: true },
        { name: "new-topic", existing: false },
      ],
    });
    sqlite.close();
  });

  test("defers prompt-specific action and parameter validation to the saved prompt", () => {
    expect(AiGenerateSchema.safeParse({
      action: "custom",
      promptId: "aiprompt_saved",
      title: "Note",
      contentMarkdown: "Body",
    }).success).toBe(true);
    expect(AiGenerateSchema.safeParse({
      action: "translate",
      promptId: "aiprompt_server_resolves_behavior",
      title: "Note",
      contentMarkdown: "Body",
    }).success).toBe(true);
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

  test("resolves saved prompt behavior inside the authenticated workspace", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const now = "2026-08-12T01:00:00.000Z";
    sqlite.query(
      `INSERT INTO ai_prompt_templates (
         id, workspace_id, seed_key, action, parameter_kind, result_mode,
         name, description, instruction,
         name_customized, description_customized, instruction_customized,
         created_at, updated_at
       ) VALUES (?, ?, NULL, 'custom', 'tone', 'replace', ?, NULL, ?, 1, 1, 1, ?, ?)`,
    ).run("aiprompt_tone", auth.workspaceId, "Tone prompt", "Use the requested tone.", now, now);

    const missingParameter = await app.request(
      "/api/v1/ai/generate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "summarize",
          promptId: "aiprompt_tone",
          title: "Note",
          contentMarkdown: "Body",
        }),
      },
      databaseEnvironment,
    );
    expect(missingParameter.status).toBe(400);
    expect(await missingParameter.json()).toMatchObject({ error: { code: "ai_tone_required" } });

    const missingPrompt = await app.request(
      "/api/v1/ai/generate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "custom",
          promptId: "aiprompt_other_workspace",
          title: "Note",
          contentMarkdown: "Body",
        }),
      },
      databaseEnvironment,
    );
    expect(missingPrompt.status).toBe(404);
    expect(await missingPrompt.json()).toMatchObject({ error: { code: "ai_prompt_not_found" } });
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

  test("tests unsaved connection fields without changing the saved provider", async () => {
    const testedConnections = [];
    const app = createApp({
      testConnection: async (config) => {
        testedConnections.push(config);
        return { text: "OK" };
      },
    });
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const createResponse = await app.request(
      "/api/v1/ai/providers",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validSettings),
      },
      databaseEnvironment,
    );
    const created = await createResponse.json();
    const provider = created.providers[0];

    const testResponse = await app.request(
      `/api/v1/ai/providers/${provider.id}/test`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelId: "draft-model",
          provider: "google",
          baseUrl: "https://draft.example.com/v1/",
          apiKey: "draft-key",
        }),
      },
      databaseEnvironment,
    );

    expect(testResponse.status).toBe(200);
    expect(await testResponse.json()).toEqual({ ok: true, response: "OK" });
    expect(testedConnections).toEqual([{
      modelId: "draft-model",
      provider: "google",
      baseUrl: "https://draft.example.com/v1",
      apiKey: "draft-key",
    }]);
    expect((await app.request("/api/v1/ai/settings", {}, databaseEnvironment).then((response) => response.json())).providers[0])
      .toMatchObject({
        provider: validSettings.provider,
        baseUrl: validSettings.baseUrl,
      });

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
