import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import {
  AI_ACTIONS,
  AiGenerateSchema,
  AiTagSuggestionsRequestSchema,
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
  EDGE_EVER_AUTH_PASSWORD: "x".repeat(32),
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
      EDGE_EVER_AUTH_PASSWORD: "x".repeat(32),
    },
  };
};

const createApp = ({ currentAuth = auth, demoMode = false, suggestTags, testConnection, generateVideoOutline } = {}) => {
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", currentAuth);
    await next();
  });
  registerAiRoutes(app, { isDemoMode: () => demoMode, suggestTags, testConnection, generateVideoOutline });
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
  test("speech settings stay encrypted and transcription requires a note-owned resource", async () => {
    const app = createApp();
    const { environment: databaseEnvironment } = createDatabaseEnvironment();
    const saved = await app.request(
      "/api/v1/ai/transcription-providers",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...validSettings, initialModelId: "whisper-1" }),
      },
      databaseEnvironment,
    );
    expect(saved.status).toBe(201);
    const settings = await saved.json();
    expect(JSON.stringify(settings)).not.toContain("secret");

    const credentialPath = `/api/v1/ai/transcription-providers/${settings.providers[0].id}/direct-credential`;
    const credential = await app.request(credentialPath, { method: "POST" }, databaseEnvironment);
    expect(credential.status).toBe(200);
    expect(credential.headers.get("Cache-Control")).toBe("no-store");
    expect(await credential.json()).toEqual({ apiKey: "secret" });

    const transcript = await app.request(
      "/api/v1/memos/missing/resources/missing/transcription-target",
      { method: "POST" },
      databaseEnvironment,
    );
    expect(transcript.status).toBe(404);

    const scopedApp = createApp({ currentAuth: { ...auth, kind: "agent", scopes: ["read:resources"] } });
    const denied = await scopedApp.request(
      "/api/v1/memos/missing/resources/missing/transcription-target",
      { method: "POST" },
      databaseEnvironment,
    );
    expect(denied.status).toBe(403);
    const deniedCredential = await scopedApp.request(credentialPath, { method: "POST" }, databaseEnvironment);
    expect(deniedCredential.status).toBe(403);
    const otherWorkspaceApp = createApp({ currentAuth: { ...auth, workspaceId: "ws_other" } });
    const otherWorkspaceCredential = await otherWorkspaceApp.request(credentialPath, { method: "POST" }, databaseEnvironment);
    expect(otherWorkspaceCredential.status).toBe(404);
  });

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

  test("allows custom generation from an empty note while source-based actions still require content", async () => {
    expect(AiGenerateSchema.safeParse({
      action: "custom",
      title: "",
      contentMarkdown: "",
      instruction: "Write a friendly greeting email.",
    }).success).toBe(true);
    expect(AiGenerateSchema.safeParse({
      action: "custom",
      promptId: "aiprompt_blank_note_generator",
      title: "",
      contentMarkdown: "",
    }).success).toBe(true);
    expect(AiGenerateSchema.safeParse({
      action: "summarize",
      title: "",
      contentMarkdown: "",
    }).success).toBe(false);

    const app = createApp();
    const response = await app.request(
      "/api/v1/ai/generate/prepare",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "summarize", title: "", contentMarkdown: "" }),
      },
      environment,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "ai_source_required",
        message: "Note content is required for this AI action.",
      },
    });
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

  test("retired model generation endpoints reject even configured server generators", async()=>{
 let called=0;const app=createApp({suggestTags:async()=>{called++;return [];},testConnection:async()=>{called++;return {text:"OK"};},generateVideoOutline:async()=>{called++;return '{}';}});
 for(const path of ["/api/v1/ai/tag-suggestions","/api/v1/ai/generate","/api/v1/ai/infographic-agent","/api/v1/ai/providers/provider/test","/api/v1/ai/providers/provider/discover-models","/api/v1/ai/video-outline"]){const res=await app.request(path,{method:"POST",headers:{"content-type":"application/json"},body:"{}"},environment);expect(res.status).toBe(410);expect(await res.json()).toMatchObject({error:{code:"ai_client_required"}});}expect(called).toBe(0);
});

  ;

  test("prepares tag suggestions with model credentials and no provider call", async () => {
    const app = createApp();
    const { environment: databaseEnvironment } = createDatabaseEnvironment();
    const created = await app.request(
      "/api/v1/ai/providers",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validSettings),
      },
      databaseEnvironment,
    );
    expect(created.status).toBe(201);
    const response = await app.request(
      "/api/v1/ai/tag-suggestions/prepare",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Note", contentMarkdown: "Body about React", currentTags: ["Current"] }),
      },
      databaseEnvironment,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.apiKey).toBe("secret");
    expect(body.prompt).toContain("Body about React");
    expect(body.currentTags).toEqual(["Current"]);
    expect(body.maxOutputTokens).toBe(300);
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

  test("requires a user session and valid candidates for the infographic agent", async () => {
    const payload = { prompt: "做个列表", currentContent: "", candidates: ["list-grid-simple"], history: [] };
    const tokenApp = createApp({ currentAuth: { ...auth, kind: "agent", actorType: "agent" } });
    const forbidden = await tokenApp.request("/api/v1/ai/infographic-agent/prepare", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }, environment);
    expect(forbidden.status).toBe(403);
    const invalid = await createApp().request("/api/v1/ai/infographic-agent/prepare", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, candidates: [] }),
    }, environment);
    expect(invalid.status).toBe(400);
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

  test("prepares a direct generation payload without calling the model provider", async () => {
    const app = createApp();
    const { environment: databaseEnvironment } = createDatabaseEnvironment();
    const created = await app.request(
      "/api/v1/ai/providers",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validSettings),
      },
      databaseEnvironment,
    );
    expect(created.status).toBe(201);

    const response = await app.request(
      "/api/v1/ai/generate/prepare",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "summarize", title: "Note", contentMarkdown: "Body" }),
      },
      databaseEnvironment,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.apiKey).toBe("secret");
    expect(body.provider).toBe("openai-compatible");
    expect(body.baseUrl).toBe("https://models.example.com/v1");
    expect(body.modelId).toBe("model-a");
    expect(body.prompt).toContain("Body");
    expect(body.system).toContain(body.resultBoundary.start);
    expect(body.system).toContain(body.resultBoundary.end);
  });

  test("returns the default model endpoint without the API key", async () => {
    const app = createApp();
    const { environment: databaseEnvironment } = createDatabaseEnvironment();
    const created = await app.request(
      "/api/v1/ai/providers",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validSettings),
      },
      databaseEnvironment,
    );
    expect(created.status).toBe(201);

    const response = await app.request("/api/v1/ai/direct-target", {}, databaseEnvironment);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      provider: "openai-compatible",
      baseUrl: "https://models.example.com/v1",
      modelId: "model-a",
    });
    expect(body.apiKey).toBeUndefined();
  });

  test("rejects actions outside the shared note-processing catalog", async () => {
    const app = createApp();
    const response = await app.request(
      "/api/v1/ai/generate/prepare",
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
      "/api/v1/ai/generate/prepare",
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
      "/api/v1/ai/generate/prepare",
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
      "/api/v1/ai/generate/prepare",
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
      "/api/v1/ai/generate/prepare",
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
      `/api/v1/ai/providers/${provider.id}/direct-credential`,
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
    expect(testedConnections).toEqual([]);
    expect(await testResponse.json()).toEqual({
      modelId: "draft-model",
      provider: "google",
      baseUrl: "https://draft.example.com/v1",
      apiKey: "draft-key",
    });
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

const videoOutlineBody = (overrides = {}) => ({
  platform: "youtube",
  title: "Current video",
  author: "Channel",
  duration: 90,
  hasChapters: false,
  blocks: [
    { start: 0, text: "Hello world" },
    { start: 45, text: "Second block" },
  ],
  ...overrides,
});

describe("video outline", () => {
  test("retired video outline endpoint keeps authorization and never returns model credentials", async()=>{
 const response=await createApp({currentAuth:null}).request("/api/v1/ai/video-outline",{method:"POST"},environment);expect(response.status).toBe(401);
 const res=await createApp().request("/api/v1/ai/video-outline",{method:"POST"},environment);expect(res.status).toBe(410);expect(await res.text()).not.toContain("apiKey");
});

  ;

  test("outline preparation requires a configured model without invoking generation",async()=>{
 const {sqlite,environment:env}=createDatabaseEnvironment();const response=await createApp().request("/api/v1/ai/video-outline/prepare",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(videoOutlineBody())},env);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:"ai_not_configured"}});sqlite.close();
});

  test("outline preparation rejects oversized transcripts before loading credentials",async()=>{
 const input=videoOutlineBody();input.blocks=Array.from({length:10},(_,i)=>({start:i,text:"x".repeat(6000)}));const res=await createApp().request("/api/v1/ai/video-outline/prepare",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)},environment);expect(res.status).toBe(413);
});
});

const jsonRequest = (method, body) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const createProvider = async (app, databaseEnvironment, overrides = {}) => {
  const response = await app.request(
    "/api/v1/ai/providers",
    jsonRequest("POST", { ...validSettings, ...overrides }),
    databaseEnvironment,
  );
  expect(response.status).toBe(201);
  return response.json();
};

const transcriptionSettings = {
  provider: "openai-compatible",
  displayName: "Speech",
  baseUrl: "https://speech.example.com/v1",
  apiKey: "speech-secret",
  isEnabled: true,
};

const createTranscriptionProvider = async (app, databaseEnvironment, overrides = {}) => {
  const response = await app.request(
    "/api/v1/ai/transcription-providers",
    jsonRequest("POST", { ...transcriptionSettings, ...overrides }),
    databaseEnvironment,
  );
  expect(response.status).toBe(201);
  return response.json();
};

const auditActionsOf = (sqlite) =>
  sqlite.query("SELECT action FROM audit_events ORDER BY rowid").all().map((row) => row.action);

const otherWorkspaceAuth = { ...auth, actorId: "usr_other", workspaceId: "ws_other" };
const agentAuth = { ...auth, kind: "agent", actorType: "agent", scopes: ["ai:generate"] };

describe("speech transcription settings routes", () => {
  test("rejects invalid transcription settings with a dedicated error code", async () => {
    const response = await createApp().request(
      "/api/v1/ai/transcription-providers",
      jsonRequest("POST", { ...transcriptionSettings, displayName: "" }),
      environment,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "ai_transcription_request_invalid",
        message: "The speech transcription settings are invalid.",
      },
    });
  });

  test("requires an interactive user to read transcription settings", async () => {
    const response = await createApp({ currentAuth: agentAuth }).request(
      "/api/v1/ai/transcription-settings",
      {},
      environment,
    );
    expect(response.status).toBe(403);
  });

  test("refuses transcription credentials and targets in demo mode", async () => {
    const app = createApp({ demoMode: true });
    const target = await app.request("/api/v1/memos/m/resources/r/transcription-target", { method: "POST" }, environment);
    const credential = await app.request(
      "/api/v1/ai/transcription-providers/atp_x/direct-credential",
      { method: "POST" },
      environment,
    );
    expect(target.status).toBe(403);
    expect(credential.status).toBe(403);
  });

  test("returns 404 for an unknown speech provider credential", async () => {
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const response = await createApp().request(
      "/api/v1/ai/transcription-providers/atp_missing/direct-credential",
      { method: "POST" },
      databaseEnvironment,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { message: "Speech service not found." } });
    sqlite.close();
  });

  test("fails closed when no credential encryption key is configured", async () => {
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const { EDGE_EVER_AUTH_PASSWORD: _password, ...withoutKey } = databaseEnvironment;
    const response = await createApp().request(
      "/api/v1/ai/transcription-providers",
      jsonRequest("POST", transcriptionSettings),
      withoutKey,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "ai_encryption_key_missing" } });
    expect(sqlite.query("SELECT COUNT(*) AS count FROM ai_transcription_providers").get().count).toBe(0);
    sqlite.close();
  });

  test("manages providers, models and the default model inside one workspace", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)").run("ws_other", "Other");

    const created = await createTranscriptionProvider(app, databaseEnvironment);
    expect(created.providers).toHaveLength(1);
    expect(created.providers[0].models).toEqual([]);
    expect(created.defaultModelId).toBeNull();
    expect(JSON.stringify(created)).not.toContain("speech-secret");
    const providerId = created.providers[0].id;

    const addModel = await app.request(
      `/api/v1/ai/transcription-providers/${providerId}/models`,
      jsonRequest("POST", { modelId: "whisper-1" }),
      databaseEnvironment,
    );
    expect(addModel.status).toBe(201);
    const withModel = await addModel.json();
    const model = withModel.providers[0].models[0];
    expect(model).toMatchObject({ modelId: "whisper-1", displayName: "whisper-1" });
    // The first model of an enabled service becomes the workspace default.
    expect(withModel.defaultModelId).toBe(model.id);
    expect(withModel.enabled).toBe(true);

    const second = await app.request(
      `/api/v1/ai/transcription-providers/${providerId}/models`,
      jsonRequest("POST", { modelId: "whisper-large", displayName: "Large" }),
      databaseEnvironment,
    );
    const withTwo = await second.json();
    expect(withTwo.defaultModelId).toBe(model.id);
    const secondModel = withTwo.providers[0].models.find((entry) => entry.modelId === "whisper-large");
    expect(secondModel.displayName).toBe("Large");

    const switchDefault = await app.request(
      "/api/v1/ai/transcription-default-model",
      jsonRequest("PUT", { modelConfigId: secondModel.id }),
      databaseEnvironment,
    );
    expect(switchDefault.status).toBe(200);
    expect((await switchDefault.json()).defaultModelId).toBe(secondModel.id);

    const clearDefault = await app.request(
      "/api/v1/ai/transcription-default-model",
      jsonRequest("PUT", { modelConfigId: null }),
      databaseEnvironment,
    );
    expect(clearDefault.status).toBe(200);
    expect((await clearDefault.json()).defaultModelId).toBeNull();

    // Another workspace can neither see nor select these models.
    const otherApp = createApp({ currentAuth: otherWorkspaceAuth });
    const foreignDefault = await otherApp.request(
      "/api/v1/ai/transcription-default-model",
      jsonRequest("PUT", { modelConfigId: secondModel.id }),
      databaseEnvironment,
    );
    expect(foreignDefault.status).toBe(400);
    expect(await foreignDefault.json()).toMatchObject({ error: { code: "ai_transcription_default_unavailable" } });
    const foreignSettings = await (await otherApp.request("/api/v1/ai/transcription-settings", {}, databaseEnvironment)).json();
    expect(foreignSettings.providers).toEqual([]);
    for (const [path, init] of [
      [`/api/v1/ai/transcription-providers/${providerId}`, jsonRequest("PUT", transcriptionSettings)],
      [`/api/v1/ai/transcription-providers/${providerId}`, { method: "DELETE" }],
      [`/api/v1/ai/transcription-providers/${providerId}/models`, jsonRequest("POST", { modelId: "x" })],
      [`/api/v1/ai/transcription-providers/${providerId}/models/${model.id}`, { method: "DELETE" }],
      [`/api/v1/ai/transcription-providers/${providerId}/direct-credential`, { method: "POST" }],
    ]) {
      const response = await otherApp.request(path, init, databaseEnvironment);
      expect(response.status, `${init.method} ${path}`).toBe(404);
    }

    const wrongProvider = await app.request(
      `/api/v1/ai/transcription-providers/atp_other/models/${model.id}`,
      { method: "DELETE" },
      databaseEnvironment,
    );
    expect(wrongProvider.status).toBe(404);
    expect(await wrongProvider.json()).toMatchObject({ error: { message: "Speech model not found." } });

    const removeModel = await app.request(
      `/api/v1/ai/transcription-providers/${providerId}/models/${model.id}`,
      { method: "DELETE" },
      databaseEnvironment,
    );
    expect(removeModel.status).toBe(200);
    expect((await removeModel.json()).providers[0].models.map((entry) => entry.modelId)).toEqual(["whisper-large"]);

    const removeProvider = await app.request(
      `/api/v1/ai/transcription-providers/${providerId}`,
      { method: "DELETE" },
      databaseEnvironment,
    );
    expect(removeProvider.status).toBe(200);
    expect((await removeProvider.json()).providers).toEqual([]);

    expect(auditActionsOf(sqlite)).toEqual([
      "workspace.ai_transcription_provider.create",
      "workspace.ai_transcription_model.create",
      "workspace.ai_transcription_model.create",
      "workspace.ai_transcription_default.update",
      "workspace.ai_transcription_default.update",
      "workspace.ai_transcription_model.delete",
      "workspace.ai_transcription_provider.delete",
    ]);
    sqlite.close();
  });

  test("updates a speech provider and keeps the stored key unless a new one is sent", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const created = await createTranscriptionProvider(app, databaseEnvironment, { initialModelId: "whisper-1" });
    const providerId = created.providers[0].id;
    const credentialPath = `/api/v1/ai/transcription-providers/${providerId}/direct-credential`;

    const renamed = await app.request(
      `/api/v1/ai/transcription-providers/${providerId}`,
      jsonRequest("PUT", { ...transcriptionSettings, apiKey: undefined, displayName: "Renamed", isEnabled: false }),
      databaseEnvironment,
    );
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).providers[0]).toMatchObject({ displayName: "Renamed", isEnabled: false });
    expect(await (await app.request(credentialPath, { method: "POST" }, databaseEnvironment)).json())
      .toEqual({ apiKey: "speech-secret" });

    // A model of a disabled service cannot become the default.
    const disabledDefault = await app.request(
      "/api/v1/ai/transcription-default-model",
      jsonRequest("PUT", { modelConfigId: created.providers[0].models[0].id }),
      databaseEnvironment,
    );
    expect(disabledDefault.status).toBe(400);

    const rekeyed = await app.request(
      `/api/v1/ai/transcription-providers/${providerId}`,
      jsonRequest("PUT", { ...transcriptionSettings, apiKey: "rotated-secret" }),
      databaseEnvironment,
    );
    expect(rekeyed.status).toBe(200);
    expect(await (await app.request(credentialPath, { method: "POST" }, databaseEnvironment)).json())
      .toEqual({ apiKey: "rotated-secret" });
    const stored = sqlite.query("SELECT api_key_encrypted FROM ai_transcription_providers WHERE id = ?").get(providerId);
    expect(stored.api_key_encrypted).not.toContain("rotated-secret");

    const metadata = sqlite.query(
      "SELECT metadata_json FROM audit_events WHERE action = 'workspace.ai_transcription_provider.update' ORDER BY rowid",
    ).all().map((row) => JSON.parse(row.metadata_json).apiKeyUpdated);
    expect(metadata).toEqual([false, true]);

    const missing = await app.request(
      "/api/v1/ai/transcription-providers/atp_missing",
      jsonRequest("PUT", transcriptionSettings),
      databaseEnvironment,
    );
    expect(missing.status).toBe(404);
    sqlite.close();
  });

  test("blocks speech setting changes in demo mode and for API tokens", async () => {
    for (const app of [createApp({ demoMode: true }), createApp({ currentAuth: agentAuth })]) {
      for (const [path, init] of [
        ["/api/v1/ai/transcription-providers", jsonRequest("POST", transcriptionSettings)],
        ["/api/v1/ai/transcription-providers/atp_x", jsonRequest("PUT", transcriptionSettings)],
        ["/api/v1/ai/transcription-providers/atp_x", { method: "DELETE" }],
        ["/api/v1/ai/transcription-providers/atp_x/models", jsonRequest("POST", { modelId: "m" })],
        ["/api/v1/ai/transcription-providers/atp_x/models/atm_x", { method: "DELETE" }],
        ["/api/v1/ai/transcription-default-model", jsonRequest("PUT", { modelConfigId: null })],
      ]) {
        const response = await app.request(path, init, environment);
        expect(response.status, `${init.method} ${path}`).toBe(403);
      }
    }
  });
});

describe("AI model provider settings routes", () => {
  test("blocks provider changes in demo mode and for API tokens", async () => {
    for (const app of [createApp({ demoMode: true }), createApp({ currentAuth: agentAuth })]) {
      for (const [path, init] of [
        ["/api/v1/ai/providers/aip_x", jsonRequest("PUT", validSettings)],
        ["/api/v1/ai/providers/aip_x", { method: "DELETE" }],
        ["/api/v1/ai/providers/aip_x/models", jsonRequest("POST", { modelId: "m" })],
        ["/api/v1/ai/providers/aip_x/models/aim_x", { method: "DELETE" }],
        ["/api/v1/ai/default-model", jsonRequest("PUT", { modelConfigId: null })],
      ]) {
        const response = await app.request(path, init, environment);
        expect(response.status, `${init.method} ${path}`).toBe(403);
      }
    }
  });

  test("keeps the saved API key on update unless a new one is provided", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const created = await createProvider(app, databaseEnvironment);
    const providerId = created.providers[0].id;
    const credentialPath = `/api/v1/ai/providers/${providerId}/direct-credential`;
    const { apiKey: _apiKey, initialModelId: _model, ...fields } = validSettings;

    const renamed = await app.request(
      `/api/v1/ai/providers/${providerId}`,
      jsonRequest("PUT", { ...fields, displayName: "Renamed" }),
      databaseEnvironment,
    );
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).providers[0].displayName).toBe("Renamed");
    const kept = await app.request(credentialPath, jsonRequest("POST", {}), databaseEnvironment);
    expect(await kept.json()).toEqual({
      provider: "openai-compatible",
      baseUrl: "https://models.example.com/v1",
      apiKey: "secret",
      modelId: "",
    });

    await app.request(
      `/api/v1/ai/providers/${providerId}`,
      jsonRequest("PUT", { ...fields, apiKey: "rotated" }),
      databaseEnvironment,
    );
    expect((await (await app.request(credentialPath, jsonRequest("POST", {}), databaseEnvironment)).json()).apiKey)
      .toBe("rotated");

    const missing = await app.request(
      "/api/v1/ai/providers/aip_missing",
      jsonRequest("PUT", fields),
      databaseEnvironment,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { message: "AI provider not found." } });
    sqlite.close();
  });

  test("rejects provider creation without an encryption key", async () => {
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const { EDGE_EVER_AUTH_PASSWORD: _password, ...withoutKey } = databaseEnvironment;
    const response = await createApp().request("/api/v1/ai/providers", jsonRequest("POST", validSettings), withoutKey);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "ai_encryption_key_missing" } });
    sqlite.close();
  });

  test("isolates providers, models and the default model per workspace", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)").run("ws_other", "Other");
    const created = await createProvider(app, databaseEnvironment);
    const provider = created.providers[0];
    const model = provider.models[0];

    const otherApp = createApp({ currentAuth: otherWorkspaceAuth });
    for (const [path, init] of [
      [`/api/v1/ai/providers/${provider.id}`, jsonRequest("PUT", validSettings)],
      [`/api/v1/ai/providers/${provider.id}`, { method: "DELETE" }],
      [`/api/v1/ai/providers/${provider.id}/models`, jsonRequest("POST", { modelId: "x" })],
      [`/api/v1/ai/providers/${provider.id}/models/${model.id}`, { method: "DELETE" }],
      [`/api/v1/ai/providers/${provider.id}/direct-credential`, jsonRequest("POST", {})],
    ]) {
      const response = await otherApp.request(path, init, databaseEnvironment);
      expect(response.status, `${init.method} ${path}`).toBe(404);
    }
    const foreignDefault = await otherApp.request(
      "/api/v1/ai/default-model",
      jsonRequest("PUT", { modelConfigId: model.id }),
      databaseEnvironment,
    );
    expect(foreignDefault.status).toBe(400);
    expect(await foreignDefault.json()).toMatchObject({ error: { code: "ai_default_model_unavailable" } });

    const ownSettings = await (await app.request("/api/v1/ai/settings", {}, databaseEnvironment)).json();
    expect(ownSettings.providers[0].displayName).toBe(validSettings.displayName);
    expect(ownSettings.defaultModelId).toBe(model.id);
    sqlite.close();
  });

  test("adds, selects and removes models and deletes the provider", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const created = await createProvider(app, databaseEnvironment, { initialModelId: undefined });
    const providerId = created.providers[0].id;
    expect(created.defaultModelId).toBeNull();

    const added = await app.request(
      `/api/v1/ai/providers/${providerId}/models`,
      jsonRequest("POST", { modelId: "model-b" }),
      databaseEnvironment,
    );
    expect(added.status).toBe(201);
    const withModel = await added.json();
    const model = withModel.providers[0].models[0];
    expect(model).toMatchObject({ modelId: "model-b", displayName: "model-b" });
    expect(withModel.defaultModelId).toBe(model.id);

    const cleared = await app.request("/api/v1/ai/default-model", jsonRequest("PUT", { modelConfigId: null }), databaseEnvironment);
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).defaultModelId).toBeNull();

    const selected = await app.request("/api/v1/ai/default-model", jsonRequest("PUT", { modelConfigId: model.id }), databaseEnvironment);
    expect(selected.status).toBe(200);
    expect((await selected.json()).defaultModelId).toBe(model.id);

    const unknown = await app.request("/api/v1/ai/default-model", jsonRequest("PUT", { modelConfigId: "aim_missing" }), databaseEnvironment);
    expect(unknown.status).toBe(400);

    const wrongProvider = await app.request(
      `/api/v1/ai/providers/aip_other/models/${model.id}`,
      { method: "DELETE" },
      databaseEnvironment,
    );
    expect(wrongProvider.status).toBe(404);
    expect(await wrongProvider.json()).toMatchObject({ error: { message: "AI model not found." } });

    const removedModel = await app.request(
      `/api/v1/ai/providers/${providerId}/models/${model.id}`,
      { method: "DELETE" },
      databaseEnvironment,
    );
    expect(removedModel.status).toBe(200);
    expect((await removedModel.json()).providers[0].models).toEqual([]);

    const missingProvider = await app.request(
      "/api/v1/ai/providers/aip_missing/models",
      jsonRequest("POST", { modelId: "x" }),
      databaseEnvironment,
    );
    expect(missingProvider.status).toBe(404);

    const removedProvider = await app.request(`/api/v1/ai/providers/${providerId}`, { method: "DELETE" }, databaseEnvironment);
    expect(removedProvider.status).toBe(200);
    expect((await removedProvider.json()).providers).toEqual([]);
    expect((await app.request(`/api/v1/ai/providers/${providerId}`, { method: "DELETE" }, databaseEnvironment)).status).toBe(404);

    expect(auditActionsOf(sqlite)).toEqual([
      "workspace.ai_provider.create",
      "workspace.ai_model.create",
      "workspace.ai_default_model.update",
      "workspace.ai_default_model.update",
      "workspace.ai_model.delete",
      "workspace.ai_provider.delete",
    ]);
    sqlite.close();
  });

  test("does not auto-select a default model for a disabled provider", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const created = await createProvider(app, databaseEnvironment, { initialModelId: undefined, isEnabled: false });
    const providerId = created.providers[0].id;

    const added = await app.request(
      `/api/v1/ai/providers/${providerId}/models`,
      jsonRequest("POST", { modelId: "model-c", displayName: "Model C" }),
      databaseEnvironment,
    );
    const body = await added.json();
    expect(body.providers[0].models[0].displayName).toBe("Model C");
    expect(body.defaultModelId).toBeNull();

    const selected = await app.request(
      "/api/v1/ai/default-model",
      jsonRequest("PUT", { modelConfigId: body.providers[0].models[0].id }),
      databaseEnvironment,
    );
    expect(selected.status).toBe(400);
    sqlite.close();
  });

  test("reports provider errors for malformed direct credential requests", async () => {
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const response = await createApp().request(
      "/api/v1/ai/providers/aip_x/direct-credential",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" },
      databaseEnvironment,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("ai_credential_failed");
    expect(typeof body.error.message).toBe("string");

    const tokenResponse = await createApp({ currentAuth: agentAuth }).request(
      "/api/v1/ai/providers/aip_x/direct-credential",
      jsonRequest("POST", {}),
      databaseEnvironment,
    );
    expect(tokenResponse.status).toBe(403);
    sqlite.close();
  });
});

describe("AI preparation routes without a configured model", () => {
  const prepareRequests = [
    ["/api/v1/ai/direct-target", {}],
    ["/api/v1/ai/tag-suggestions/prepare", jsonRequest("POST", { title: "T", contentMarkdown: "Body", currentTags: [] })],
    [
      "/api/v1/ai/infographic-agent/prepare",
      jsonRequest("POST", { prompt: "List", currentContent: "", candidates: ["list-grid-simple"], history: [] }),
    ],
    ["/api/v1/ai/generate/prepare", jsonRequest("POST", { action: "summarize", title: "T", contentMarkdown: "Body" })],
  ];

  test("report that AI is not configured", async () => {
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    for (const [path, init] of prepareRequests) {
      const response = await createApp().request(path, init, databaseEnvironment);
      expect(response.status, path).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "ai_not_configured" } });
    }
    sqlite.close();
  });

  test("require an interactive user session", async () => {
    for (const [path, init] of prepareRequests) {
      const response = await createApp({ currentAuth: agentAuth }).request(path, init, environment);
      expect(response.status, path).toBe(403);
    }
  });
});

describe("AI generation preparation", () => {
  test("includes only the parameters the action needs", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    await createProvider(app, databaseEnvironment);

    const translate = await app.request(
      "/api/v1/ai/generate/prepare",
      jsonRequest("POST", { action: "translate", title: "Note", contentMarkdown: "Hallo", targetLanguage: "en", tone: "friendly" }),
      databaseEnvironment,
    );
    expect(translate.status).toBe(200);

    const tone = await app.request(
      "/api/v1/ai/generate/prepare",
      jsonRequest("POST", { action: "change-tone", title: "Note", contentMarkdown: "Body" }),
      databaseEnvironment,
    );
    expect(tone.status).toBe(400);
    expect(await tone.json()).toMatchObject({ error: { code: "ai_request_invalid" } });

    const custom = await app.request(
      "/api/v1/ai/generate/prepare",
      jsonRequest("POST", { action: "custom", title: "Note", contentMarkdown: "Body", instruction: "  Keep every date unique-marker.  " }),
      databaseEnvironment,
    );
    expect(custom.status).toBe(200);
    expect(JSON.stringify(await custom.json())).toContain("Keep every date unique-marker.");
    sqlite.close();
  });

  test("uses a saved workspace prompt's instruction", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    await createProvider(app, databaseEnvironment);
    const now = "2026-08-12T01:00:00.000Z";
    sqlite.query(
      `INSERT INTO ai_prompt_templates (
         id, workspace_id, seed_key, action, parameter_kind, result_mode,
         name, description, instruction,
         name_customized, description_customized, instruction_customized,
         created_at, updated_at
       ) VALUES (?, ?, NULL, 'custom', 'none', 'replace', ?, NULL, ?, 1, 1, 1, ?, ?)`,
    ).run("aiprompt_saved", auth.workspaceId, "Saved", "Saved-prompt-marker instruction.", now, now);

    const response = await app.request(
      "/api/v1/ai/generate/prepare",
      jsonRequest("POST", { action: "translate", promptId: "aiprompt_saved", title: "Note", contentMarkdown: "Body" }),
      databaseEnvironment,
    );
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("Saved-prompt-marker instruction.");

    sqlite.query(
      `INSERT INTO ai_prompt_templates (
         id, workspace_id, seed_key, action, parameter_kind, result_mode,
         name, description, instruction,
         name_customized, description_customized, instruction_customized,
         created_at, updated_at
       ) VALUES (?, ?, NULL, 'custom', 'target-language', 'replace', ?, NULL, ?, 1, 1, 1, ?, ?)`,
    ).run("aiprompt_language", auth.workspaceId, "Language", "Translate it.", now, now);
    const missingLanguage = await app.request(
      "/api/v1/ai/generate/prepare",
      jsonRequest("POST", { action: "custom", promptId: "aiprompt_language", title: "Note", contentMarkdown: "Body" }),
      databaseEnvironment,
    );
    expect(missingLanguage.status).toBe(400);
    expect(await missingLanguage.json()).toMatchObject({ error: { code: "ai_target_language_required" } });

    const withLanguage = await app.request(
      "/api/v1/ai/generate/prepare",
      jsonRequest("POST", {
        action: "custom",
        promptId: "aiprompt_language",
        title: "Note",
        contentMarkdown: "Body",
        targetLanguage: "en",
      }),
      databaseEnvironment,
    );
    expect(withLanguage.status).toBe(200);
    sqlite.close();
  });

  test("maps existing tag spellings onto the canonical workspace tags", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    await createProvider(app, databaseEnvironment);
    const response = await app.request(
      "/api/v1/ai/tag-suggestions/prepare",
      jsonRequest("POST", { title: "Note", contentMarkdown: "Body", currentTags: ["draft"], locale: "en-US" }),
      databaseEnvironment,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.currentTags).toEqual(["draft"]);
    expect(body.canonicalTags).toEqual({});
    sqlite.close();
  });
});

describe("video outline preparation", () => {
  test("requires the ai:generate scope for API tokens", async () => {
    const response = await createApp({ currentAuth: { ...agentAuth, scopes: ["read:memos"] } }).request(
      "/api/v1/ai/video-outline/prepare",
      jsonRequest("POST", videoOutlineBody()),
      environment,
    );
    expect(response.status).toBe(403);
  });

  test("returns model credentials with the outline prompt for a configured workspace", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    await createProvider(app, databaseEnvironment);
    const response = await createApp({ currentAuth: agentAuth }).request(
      "/api/v1/ai/video-outline/prepare",
      jsonRequest("POST", videoOutlineBody()),
      databaseEnvironment,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ apiKey: "secret", modelId: "model-a", maxOutputTokens: 1200 });
    expect(body.prompt).toContain("Hello world");
    expect(typeof body.system).toBe("string");
    sqlite.close();
  });
});

describe("AI settings storage failures", () => {
  test("rejects duplicate model ids without changing the stored models", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const provider = (await createProvider(app, databaseEnvironment)).providers[0];
    const duplicate = await app.request(
      `/api/v1/ai/providers/${provider.id}/models`,
      jsonRequest("POST", { modelId: "model-a" }),
      databaseEnvironment,
    );
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({ error: { code: "ai_model_create_failed" } });

    const speech = (await createTranscriptionProvider(app, databaseEnvironment, { initialModelId: "whisper-1" })).providers[0];
    const duplicateSpeech = await app.request(
      `/api/v1/ai/transcription-providers/${speech.id}/models`,
      jsonRequest("POST", { modelId: "whisper-1" }),
      databaseEnvironment,
    );
    expect(duplicateSpeech.status).toBe(400);
    expect(await duplicateSpeech.json()).toMatchObject({ error: { code: "ai_transcription_model_create_failed" } });

    expect(sqlite.query("SELECT COUNT(*) AS count FROM ai_models").get().count).toBe(1);
    expect(sqlite.query("SELECT COUNT(*) AS count FROM ai_transcription_models").get().count).toBe(1);
    expect(auditActionsOf(sqlite).filter((action) => action.endsWith("model.create"))).toEqual([]);
    sqlite.close();
  });

  test("refuses to rotate keys when the encryption key is no longer configured", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const provider = (await createProvider(app, databaseEnvironment)).providers[0];
    const speech = (await createTranscriptionProvider(app, databaseEnvironment)).providers[0];
    const { EDGE_EVER_AUTH_PASSWORD: _password, ...withoutKey } = databaseEnvironment;
    const { initialModelId: _model, ...providerFields } = validSettings;

    const providerUpdate = await app.request(
      `/api/v1/ai/providers/${provider.id}`,
      jsonRequest("PUT", { ...providerFields, apiKey: "rotated" }),
      withoutKey,
    );
    expect(providerUpdate.status).toBe(400);
    expect(await providerUpdate.json()).toMatchObject({ error: { code: "ai_encryption_key_missing" } });

    const speechUpdate = await app.request(
      `/api/v1/ai/transcription-providers/${speech.id}`,
      jsonRequest("PUT", { ...transcriptionSettings, apiKey: "rotated" }),
      withoutKey,
    );
    expect(speechUpdate.status).toBe(400);
    expect(await speechUpdate.json()).toMatchObject({ error: { code: "ai_encryption_key_missing" } });
    sqlite.close();
  });

  test("reports an undecryptable speech credential instead of returning it", async () => {
    const app = createApp();
    const { sqlite, environment: databaseEnvironment } = createDatabaseEnvironment();
    const speech = (await createTranscriptionProvider(app, databaseEnvironment)).providers[0];
    sqlite.query("UPDATE ai_transcription_providers SET api_key_encrypted = ? WHERE id = ?").run("corrupted", speech.id);

    const response = await app.request(
      `/api/v1/ai/transcription-providers/${speech.id}/direct-credential`,
      { method: "POST" },
      databaseEnvironment,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "ai_credentials_unavailable" } });
    sqlite.close();
  });
});
