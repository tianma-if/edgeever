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
import { encryptSecret } from "./secret-encryption.ts";

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
    const result = this.db.query(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: result.changes } };
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
      configVersion: expect.any(String),
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
      configVersion: expect.any(String),
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

describe("model output budgets (#652)", () => {
  const json = (body, method = "POST") => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const setup = async (app = createApp()) => {
    const database = createDatabaseEnvironment();
    const created = await app.request("/api/v1/ai/providers", json(validSettings), database.environment);
    expect(created.status).toBe(201);
    const provider = (await created.json()).providers[0];
    return { ...database, provider, model: provider.models[0] };
  };
  const prepareGeneration = async (app, env) => {
    const response = await app.request(
      "/api/v1/ai/generate/prepare",
      json({ action: "summarize", title: "Note", contentMarkdown: "Body" }),
      env,
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const prepareTags = async (app, env) => {
    const response = await app.request(
      "/api/v1/ai/tag-suggestions/prepare",
      json({ title: "Note", contentMarkdown: "Body", currentTags: [] }),
      env,
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const patchPath = (provider, model) => `/api/v1/ai/providers/${provider.id}/models/${model.id}`;

  test("existing models keep the built-in defaults", async () => {
    const app = createApp();
    const { sqlite, environment: env, model } = await setup(app);
    expect(model).toMatchObject({
      generationMaxOutputTokens: null,
      tagSuggestionMaxOutputTokens: null,
      companionMaxOutputTokens: null,
    });
    expect((await prepareGeneration(app, env)).maxOutputTokens).toBe(4096);
    const tags = await prepareTags(app, env);
    expect(tags.maxOutputTokens).toBe(300);
    expect(tags.temperature).toBe(0);
    sqlite.close();
  });

  test("PATCH treats omitted fields as unchanged and null as restore-default", async () => {
    const app = createApp();
    const { sqlite, environment: env, provider, model } = await setup(app);

    const first = await app.request(
      patchPath(provider, model),
      json({ generationMaxOutputTokens: 16000, tagSuggestionMaxOutputTokens: 800 }, "PATCH"),
      env,
    );
    expect(first.status).toBe(200);
    expect((await first.json()).providers[0].models[0]).toMatchObject({
      generationMaxOutputTokens: 16000,
      tagSuggestionMaxOutputTokens: 800,
      companionMaxOutputTokens: null,
    });
    expect((await prepareGeneration(app, env)).maxOutputTokens).toBe(16000);
    expect((await prepareTags(app, env)).maxOutputTokens).toBe(800);

    const second = await app.request(
      patchPath(provider, model),
      json({ generationMaxOutputTokens: null }, "PATCH"),
      env,
    );
    expect(second.status).toBe(200);
    expect((await second.json()).providers[0].models[0]).toMatchObject({
      generationMaxOutputTokens: null,
      tagSuggestionMaxOutputTokens: 800,
    });
    expect((await prepareGeneration(app, env)).maxOutputTokens).toBe(4096);
    expect((await prepareTags(app, env)).maxOutputTokens).toBe(800);

    const audits = sqlite.query(
      "SELECT action, entity_id, metadata_json FROM audit_events WHERE action = 'workspace.ai_model.update' ORDER BY rowid",
    ).all();
    expect(audits.map((row) => row.entity_id)).toEqual([model.id, model.id]);
    expect(JSON.parse(audits[1].metadata_json)).toEqual({
      providerConfigId: provider.id,
      modelId: "model-a",
      generationMaxOutputTokens: null,
    });
    sqlite.close();
  });

  test("PATCH rejects empty, unknown, non-integer and out-of-range input", async () => {
    const app = createApp();
    const { sqlite, environment: env, provider, model } = await setup(app);
    for (const body of [
      {},
      { maxOutputTokens: 1000 },
      { generationMaxOutputTokens: 1000.5 },
      { generationMaxOutputTokens: "1000" },
      { generationMaxOutputTokens: 255 },
      { generationMaxOutputTokens: 131_073 },
      { tagSuggestionMaxOutputTokens: 63 },
      { tagSuggestionMaxOutputTokens: 8193 },
      { companionMaxOutputTokens: 0 },
    ]) {
      const response = await app.request(patchPath(provider, model), json(body, "PATCH"), env);
      expect({ body, status: response.status }).toEqual({ body, status: 400 });
    }
    const stored = sqlite.query("SELECT generation_max_output_tokens, tag_suggestion_max_output_tokens, companion_max_output_tokens FROM ai_models").get();
    expect(stored).toEqual({ generation_max_output_tokens: null, tag_suggestion_max_output_tokens: null, companion_max_output_tokens: null });
    sqlite.close();
  });

  test("PATCH is workspace-scoped, user-only and blocked in demo mode", async () => {
    const app = createApp();
    const { sqlite, environment: env, provider, model } = await setup(app);
    sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)").run("ws_other", "Other workspace");
    const body = json({ generationMaxOutputTokens: 9000 }, "PATCH");

    const otherWorkspace = createApp({ currentAuth: { ...auth, actorId: "usr_other", workspaceId: "ws_other" } });
    expect((await otherWorkspace.request(patchPath(provider, model), body, env)).status).toBe(404);
    expect((await app.request(`/api/v1/ai/providers/other/models/${model.id}`, body, env)).status).toBe(404);
    expect((await createApp({ demoMode: true }).request(patchPath(provider, model), body, env)).status).toBe(403);
    const token = createApp({ currentAuth: { ...auth, kind: "agent", actorType: "agent", scopes: ["ai:generate"] } });
    expect((await token.request(patchPath(provider, model), body, env)).status).toBe(403);

    expect(sqlite.query("SELECT generation_max_output_tokens AS value FROM ai_models").get()).toEqual({ value: null });
    expect(sqlite.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'workspace.ai_model.update'").get()).toEqual({ count: 0 });
    sqlite.close();
  });

  test("credentials and budget always come from the current default model", async () => {
    const app = createApp();
    const { sqlite, environment: env, provider } = await setup(app);
    const added = await app.request(
      `/api/v1/ai/providers/${provider.id}/models`,
      json({ modelId: "model-b", generationMaxOutputTokens: 20000 }),
      env,
    );
    expect(added.status).toBe(201);
    const modelB = (await added.json()).providers[0].models.find((model) => model.modelId === "model-b");
    expect(modelB.generationMaxOutputTokens).toBe(20000);

    expect(await prepareGeneration(app, env)).toMatchObject({ modelId: "model-a", maxOutputTokens: 4096 });
    expect((await app.request("/api/v1/ai/default-model", json({ modelConfigId: modelB.id }, "PUT"), env)).status).toBe(200);
    expect(await prepareGeneration(app, env)).toMatchObject({ modelId: "model-b", maxOutputTokens: 20000 });
    sqlite.close();
  });

  test("other prepare responses keep their existing shape", async () => {
    const app = createApp();
    const { sqlite, environment: env, provider, model } = await setup(app);
    await app.request(patchPath(provider, model), json({ generationMaxOutputTokens: 16000, companionMaxOutputTokens: 9000 }, "PATCH"), env);
    const infographic = await app.request(
      "/api/v1/ai/infographic-agent/prepare",
      json({ prompt: "列表", currentContent: "", candidates: ["list-grid-simple"], history: [] }),
      env,
    );
    expect(infographic.status).toBe(200);
    expect(Object.keys(await infographic.json()).sort()).toEqual(["apiKey", "baseUrl", "modelId", "provider"]);
    const outline = await app.request("/api/v1/ai/video-outline/prepare", json(videoOutlineBody()), env);
    expect(outline.status).toBe(200);
    expect(await outline.json()).toMatchObject({ maxOutputTokens: 1200 });
    sqlite.close();
  });

  test("an upgraded database keeps old rows on defaults and stays readable by the previous server query", async () => {
    const sqlite = new Database(":memory:");
    for (const migration of globSync("migrations/*.sql").sort()) {
      if (migration.endsWith("0091_ai_model_output_budgets.sql")) continue;
      sqlite.exec(readFileSync(migration, "utf8"));
    }
    sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)").run("ws_member", "Member workspace");
    const env = { storage: { db: new SqliteD1Database(sqlite), resources: {} }, EDGE_EVER_AUTH_PASSWORD: "x".repeat(32) };
    // Rows written by the previous release, before the upgrade.
    const now = "2026-11-01T00:00:00.000Z";
    const apiKey = await encryptSecret("secret", `edgeever:ai-credentials:v1:${"x".repeat(32)}`);
    sqlite.query(
      `INSERT INTO ai_provider_configs (id, workspace_id, provider, display_name, base_url, api_key_encrypted, is_enabled, created_at, updated_at)
       VALUES ('aip_old', 'ws_member', 'openai-compatible', 'Old', 'https://models.example.com/v1', ?, 1, ?, ?)`,
    ).run(apiKey, now, now);
    sqlite.query(
      `INSERT INTO ai_models (id, provider_config_id, model_id, display_name, created_at, updated_at)
       VALUES ('aim_old', 'aip_old', 'old-model', 'old-model', ?, ?)`,
    ).run(now, now);
    sqlite.query(
      `INSERT INTO ai_workspace_settings (workspace_id, default_model_id, created_at, updated_at) VALUES ('ws_member', 'aim_old', ?, ?)`,
    ).run(now, now);
    sqlite.exec(readFileSync("migrations/0091_ai_model_output_budgets.sql", "utf8"));

    const app = createApp();
    const settings = await (await app.request("/api/v1/ai/settings", {}, env)).json();
    expect(settings.providers[0].models[0]).toMatchObject({ id: "aim_old", generationMaxOutputTokens: null });
    expect(await prepareGeneration(app, env)).toMatchObject({ modelId: "old-model", apiKey: "secret" });
    expect((await prepareGeneration(app, env)).maxOutputTokens).toBe(4096);
    // The previous release selected explicit columns, so a rollback keeps reading and writing.
    expect((await app.request("/api/v1/ai/providers/aip_old/models/aim_old", json({ generationMaxOutputTokens: 9000 }, "PATCH"), env)).status).toBe(200);
    expect(sqlite.query(`SELECT id, provider_config_id, model_id, display_name, created_at, updated_at FROM ai_models`).all()).toHaveLength(1);
    sqlite.query(
      `INSERT INTO ai_models (id, provider_config_id, model_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("aim_legacy", "aip_old", "legacy-model", "legacy-model", now, now);
    expect(sqlite.query("SELECT generation_max_output_tokens AS value FROM ai_models WHERE id = 'aim_legacy'").get()).toEqual({ value: null });
    sqlite.close();
  });
});

describe("automatic output budget (#652 PR A)", () => {
  const send = (body, method = "POST") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const setup = async (settings = validSettings, app = createApp()) => {
    const database = createDatabaseEnvironment();
    const created = await app.request("/api/v1/ai/providers", send(settings), database.environment);
    expect(created.status).toBe(201);
    const provider = (await created.json()).providers[0];
    return { ...database, app, provider, model: provider.models[0] };
  };
  const capabilitiesPath = (provider, model) => `/api/v1/ai/providers/${provider.id}/models/${model.id}/capabilities`;
  const prepare = async (app, env, body = {}) => {
    const response = await app.request("/api/v1/ai/generate/prepare", send({ action: "continue-writing", title: "Note", contentMarkdown: "Body", ...body }), env);
    expect(response.status).toBe(200);
    return response.json();
  };
  const configVersion = async (env, provider) => (await env.storage.db
    .prepare("SELECT updated_at FROM ai_provider_configs WHERE id = ?").bind(provider.id).first()).updated_at;
  const report = async (app, env, provider, model, body) => app.request(capabilitiesPath(provider, model), send({
    provider: provider.provider, modelId: model.modelId, baseUrl: provider.baseUrl, configVersion: await configVersion(env, provider),
    maxOutputTokens: null, maxInputTokens: null, contextWindowTokens: null, source: "none", ...body,
  }, "PUT"), env);
  const detectedAt = (sqlite) => sqlite.query("SELECT detected_at FROM ai_models").get().detected_at;

  test("without detected limits, new clients send no limit, old clients keep 4096, and both are asked to detect", async () => {
    const { sqlite, app, environment: env, provider, model } = await setup();
    const unbounded = await prepare(app, env, { allowUnboundedOutput: true });
    expect(unbounded).toMatchObject({ maxOutputTokens: null, outputBudget: { mode: "auto-unbounded", outputLimit: null } });
    expect(unbounded.capabilityTarget).toEqual({ providerConfigId: provider.id, modelConfigId: model.id, configVersion: await configVersion(env, provider) });
    expect(unbounded.detectCapabilities).toBe(true);
    const legacy = await prepare(app, env);
    expect(legacy).toMatchObject({ maxOutputTokens: 4096, outputBudget: { mode: "fallback" } });
    sqlite.close();
  });

  test("Anthropic always gets a numeric max_tokens", async () => {
    const { sqlite, app, environment: env } = await setup({ ...validSettings, provider: "anthropic", baseUrl: "https://api.anthropic.example/v1" });
    expect(await prepare(app, env, { allowUnboundedOutput: true })).toMatchObject({ maxOutputTokens: 4096, outputBudget: { mode: "fallback" } });
    sqlite.close();
  });

  test("reported limits are stored, shown in settings and used by prepare", async () => {
    const { sqlite, app, environment: env, provider, model } = await setup({ ...validSettings, provider: "google", baseUrl: "https://gemini.example/v1beta" });
    const saved = await report(app, env, provider, model, { maxOutputTokens: 65536, maxInputTokens: 1_048_576, source: "gemini-models" });
    expect(saved.status).toBe(200);
    expect((await saved.json()).detectedCapabilities).toMatchObject({ maxOutputTokens: 65536, maxInputTokens: 1_048_576, contextWindowTokens: null, source: "gemini-models" });
    const settings = await (await app.request("/api/v1/ai/settings", {}, env)).json();
    expect(settings.providers[0].models[0].detectedCapabilities).toMatchObject({ maxOutputTokens: 65536, source: "gemini-models" });
    // Fresh limits: no detection request, and a long input within the input limit keeps the whole output limit.
    const longNote = "a".repeat(200_000);
    const prepared = await prepare(app, env, { allowUnboundedOutput: true, contentMarkdown: longNote });
    expect(prepared).toMatchObject({ maxOutputTokens: 65536, outputBudget: { mode: "auto", outputLimit: 65536, inputFits: true } });
    expect(prepared.detectCapabilities).toBe(false);
    // The client can still report a corrected limit learned from a provider error.
    expect(prepared.capabilityTarget).toMatchObject({ providerConfigId: provider.id, modelConfigId: model.id });
    // Old clients get the automatic budget too.
    expect((await prepare(app, env, { contentMarkdown: longNote })).maxOutputTokens).toBe(65536);
    sqlite.close();
  });

  test("a shared window leaves room for the input; a manual budget still wins", async () => {
    const { sqlite, app, environment: env, provider, model } = await setup({ ...validSettings, provider: "anthropic", baseUrl: "https://api.anthropic.example/v1" });
    await report(app, env, provider, model, { maxOutputTokens: 64000, contextWindowTokens: 150_000, source: "anthropic-models" });
    const longNote = "a".repeat(290_000); // ~106k tokens of a 150k shared window
    const prepared = await prepare(app, env, { allowUnboundedOutput: true, contentMarkdown: longNote });
    expect(prepared.outputBudget.mode).toBe("auto");
    expect(prepared.maxOutputTokens).toBeLessThan(64000);
    expect(prepared.maxOutputTokens).toBeGreaterThan(1000);
    await app.request(`/api/v1/ai/providers/${provider.id}/models/${model.id}`, send({ generationMaxOutputTokens: 9000 }, "PATCH"), env);
    expect(await prepare(app, env, { allowUnboundedOutput: true, contentMarkdown: longNote })).toMatchObject({ maxOutputTokens: 9000, outputBudget: { mode: "manual" } });
    sqlite.close();
  });

  test("source-sized tasks ask for what they need, open-ended tasks may use the whole limit", async () => {
    const { sqlite, app, environment: env, provider, model } = await setup();
    await report(app, env, provider, model, { maxOutputTokens: 32768, contextWindowTokens: 1_000_000, source: "openrouter-models" });
    expect((await prepare(app, env, { action: "continue-writing" })).maxOutputTokens).toBe(32768);
    const shortTranslate = await prepare(app, env, { action: "translate", targetLanguage: "en" });
    expect(shortTranslate.maxOutputTokens).toBeGreaterThanOrEqual(4096);
    expect(shortTranslate.maxOutputTokens).toBeLessThan(8192);
    const longTranslate = await prepare(app, env, { action: "translate", targetLanguage: "en", contentMarkdown: "字".repeat(9000) });
    expect(longTranslate.maxOutputTokens).toBeGreaterThan(8192);
    expect(longTranslate.maxOutputTokens).toBeLessThanOrEqual(32768);
    sqlite.close();
  });

  test("an empty detection is remembered, and stale limits ask for detection again", async () => {
    const { sqlite, app, environment: env, provider, model } = await setup();
    expect((await report(app, env, provider, model, { source: "none" })).status).toBe(200);
    const afterNone = await prepare(app, env, { allowUnboundedOutput: true });
    expect(afterNone).toMatchObject({ maxOutputTokens: null, outputBudget: { mode: "auto-unbounded" } });
    expect(afterNone.detectCapabilities).toBe(false);
    sqlite.query("UPDATE ai_models SET detected_at = '2026-01-01T00:00:00.000Z'").run();
    expect((await prepare(app, env, { allowUnboundedOutput: true })).detectCapabilities).toBe(true);
    sqlite.close();
  });

  test("a provider error updates only the output limit and keeps the detected window", async () => {
    const { sqlite, app, environment: env, provider, model } = await setup();
    await report(app, env, provider, model, { maxOutputTokens: 128000, contextWindowTokens: 400000, source: "openrouter-models" });
    const updated = await report(app, env, provider, model, { maxOutputTokens: 16384, source: "provider-error" });
    expect((await updated.json()).detectedCapabilities).toMatchObject({ maxOutputTokens: 16384, contextWindowTokens: 400000, source: "openrouter-models" });
    expect((await report(app, env, provider, model, { maxOutputTokens: null, source: "provider-error" })).status).toBe(400);
    sqlite.close();
  });

  test("reports must match the saved model and endpoint, and follow the usual permissions", async () => {
    const { sqlite, app, environment: env, provider, model } = await setup();
    expect((await report(app, env, provider, model, { modelId: "other-model" })).status).toBe(409);
    expect((await report(app, env, provider, model, { baseUrl: "https://elsewhere.example/v1" })).status).toBe(409);
    expect((await report(app, env, provider, model, { maxOutputTokens: -1, source: "openrouter-models" })).status).toBe(400);
    expect((await report(app, env, provider, model, { source: "made-up" })).status).toBe(400);
    sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)").run("ws_other", "Other workspace");
    expect((await report(createApp({ currentAuth: { ...auth, actorId: "usr_other", workspaceId: "ws_other" } }), env, provider, model, {})).status).toBe(404);
    expect((await report(createApp({ demoMode: true }), env, provider, model, {})).status).toBe(403);
    expect((await report(createApp({ currentAuth: { ...auth, kind: "agent", actorType: "agent", scopes: ["ai:generate"] } }), env, provider, model, {})).status).toBe(403);
    expect(sqlite.query("SELECT detected_at FROM ai_models").get()).toEqual({ detected_at: null });
    sqlite.close();
  });

  test("a late report cannot overwrite limits cleared by an endpoint change that lands before its write", async () => {
    const { sqlite, app, environment: env, provider, model } = await setup();
    const version = await configVersion(env, provider);
    // Another request changes the endpoint (and clears detected limits, as the provider route does)
    // after this report has passed its checks but before its write runs.
    const realDb = env.storage.db;
    let interleaved = false;
    const db = Object.create(realDb);
    db.prepare = (sql) => {
      if (!interleaved && /^\s*UPDATE ai_models SET detected_max_output_tokens/.test(sql)) {
        interleaved = true;
        sqlite.query("UPDATE ai_models SET detected_max_output_tokens = NULL, detected_max_input_tokens = NULL, detected_context_window_tokens = NULL, detected_capability_source = NULL, detected_at = NULL WHERE provider_config_id = ?").run(provider.id);
        sqlite.query("UPDATE ai_provider_configs SET base_url = ?, updated_at = ? WHERE id = ?").run("https://new-gateway.example/v1", "2099-01-01T00:00:00.000Z", provider.id);
      }
      return realDb.prepare(sql);
    };
    const racing = { ...env, storage: { ...env.storage, db } };
    for (const body of [
      { maxOutputTokens: 128000, contextWindowTokens: 400000, source: "openrouter-models" },
      { maxOutputTokens: 128000, source: "provider-error" },
    ]) {
      interleaved = false;
      sqlite.query("UPDATE ai_provider_configs SET base_url = ?, updated_at = ? WHERE id = ?").run(provider.baseUrl, version, provider.id);
      const response = await app.request(capabilitiesPath(provider, model), send({
        provider: provider.provider, modelId: model.modelId, baseUrl: provider.baseUrl, configVersion: version,
        maxOutputTokens: null, maxInputTokens: null, contextWindowTokens: null, ...body,
      }, "PUT"), racing);
      expect(interleaved).toBe(true);
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("ai_model_changed");
      expect(detectedAt(sqlite)).toBeNull();
    }
    sqlite.close();
  });

  test("a report read before switching the service type on the same URL is rejected", async () => {
    const { sqlite, app, environment: env, provider, model } = await setup();
    // Keep the saved version distinct from the update below even when both land in one millisecond.
    sqlite.query("UPDATE ai_provider_configs SET updated_at = '2026-01-01T00:00:00.000Z'").run();
    const before = await prepare(app, env, { allowUnboundedOutput: true });
    const switched = await app.request(`/api/v1/ai/providers/${provider.id}`, send({ provider: "anthropic", displayName: provider.displayName, baseUrl: provider.baseUrl, isEnabled: true }, "PUT"), env);
    expect(switched.status).toBe(200);
    const late = (body) => app.request(capabilitiesPath(provider, model), send({
      modelId: model.modelId, baseUrl: provider.baseUrl, configVersion: before.capabilityTarget.configVersion,
      maxOutputTokens: 128000, maxInputTokens: null, contextWindowTokens: null, source: "openrouter-models", ...body,
    }, "PUT"), env);
    // The old service type, and the new type with the old configuration version, are both rejected.
    expect((await late({ provider: "openai-compatible" })).status).toBe(409);
    expect((await late({ provider: "anthropic" })).status).toBe(409);
    expect(detectedAt(sqlite)).toBeNull();
    // The new configuration still asks for detection and accepts a report for itself.
    const after = await prepare(app, env, { allowUnboundedOutput: true });
    expect(after.detectCapabilities).toBe(true);
    expect(after.capabilityTarget.configVersion).not.toBe(before.capabilityTarget.configVersion);
    expect((await late({ provider: "anthropic", configVersion: after.capabilityTarget.configVersion, source: "anthropic-models" })).status).toBe(200);
    sqlite.close();
  });

  test("a note that leaves no room in the window is refused before reaching the provider", async () => {
    const { sqlite, app, environment: env, provider, model } = await setup({ ...validSettings, provider: "anthropic", baseUrl: "https://api.anthropic.example/v1" });
    await report(app, env, provider, model, { maxOutputTokens: 64000, contextWindowTokens: 100_000, source: "anthropic-models" });
    const request = (contentMarkdown) => app.request("/api/v1/ai/generate/prepare", send({ action: "continue-writing", title: "Note", contentMarkdown, allowUnboundedOutput: true }), env);
    const refused = await request("字".repeat(100_000));
    expect(refused.status).toBe(413);
    expect((await refused.json()).error.code).toBe("ai_input_too_long");
    // A note that leaves only a little room gets at most that room.
    const tight = await (await request("字".repeat(88_000))).json();
    expect(tight.outputBudget).toMatchObject({ mode: "auto", inputFits: true });
    expect(tight.maxOutputTokens).toBeGreaterThan(0);
    expect(tight.maxOutputTokens).toBeLessThan(1024);
    expect(tight.maxOutputTokens).toBe(tight.outputBudget.outputLimit);
    sqlite.close();
  });

  test("changing the service type or Base URL clears detected limits; other edits keep them", async () => {
    const { sqlite, app, environment: env, provider, model } = await setup();
    await report(app, env, provider, model, { maxOutputTokens: 32768, source: "openrouter-models" });
    const update = (body) => app.request(`/api/v1/ai/providers/${provider.id}`, send({ provider: "openai-compatible", displayName: "Renamed", baseUrl: provider.baseUrl, isEnabled: true, ...body }, "PUT"), env);
    expect((await update({})).status).toBe(200);
    expect(sqlite.query("SELECT detected_max_output_tokens AS value FROM ai_models").get()).toEqual({ value: 32768 });
    expect((await update({ baseUrl: "https://new-gateway.example/v1" })).status).toBe(200);
    expect(sqlite.query("SELECT detected_max_output_tokens AS value, detected_at FROM ai_models").get()).toEqual({ value: null, detected_at: null });
    sqlite.close();
  });

  test("a 0091 database upgrades with no detected limits and keeps the previous budget behaviour", async () => {
    const sqlite = new Database(":memory:");
    for (const migration of globSync("migrations/*.sql").sort()) {
      if (migration.endsWith("0092_ai_model_detected_capabilities.sql")) continue;
      sqlite.exec(readFileSync(migration, "utf8"));
    }
    sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)").run("ws_member", "Member workspace");
    const now = "2026-11-04T00:00:00.000Z";
    const apiKey = await encryptSecret("secret", `edgeever:ai-credentials:v1:${"x".repeat(32)}`);
    sqlite.query(`INSERT INTO ai_provider_configs (id, workspace_id, provider, display_name, base_url, api_key_encrypted, is_enabled, created_at, updated_at)
      VALUES ('aip_old', 'ws_member', 'openai-compatible', 'Old', 'https://models.example.com/v1', ?, 1, ?, ?)`).run(apiKey, now, now);
    sqlite.query(`INSERT INTO ai_models (id, provider_config_id, model_id, display_name, generation_max_output_tokens, created_at, updated_at)
      VALUES ('aim_old', 'aip_old', 'old-model', 'old-model', 12000, ?, ?)`).run(now, now);
    sqlite.query(`INSERT INTO ai_workspace_settings (workspace_id, default_model_id, created_at, updated_at) VALUES ('ws_member', 'aim_old', ?, ?)`).run(now, now);
    sqlite.exec(readFileSync("migrations/0092_ai_model_detected_capabilities.sql", "utf8"));
    const env = { storage: { db: new SqliteD1Database(sqlite), resources: {} }, EDGE_EVER_AUTH_PASSWORD: "x".repeat(32) };
    const app = createApp();
    const settings = await (await app.request("/api/v1/ai/settings", {}, env)).json();
    expect(settings.providers[0].models[0]).toMatchObject({ id: "aim_old", generationMaxOutputTokens: 12000, detectedCapabilities: null });
    expect(await prepare(app, env)).toMatchObject({ maxOutputTokens: 12000, outputBudget: { mode: "manual" } });
    // The previous release selected explicit columns, so it keeps working after the upgrade.
    expect(sqlite.query("SELECT id, provider_config_id, model_id, display_name, generation_max_output_tokens, tag_suggestion_max_output_tokens, companion_max_output_tokens, created_at, updated_at FROM ai_models").all()).toHaveLength(1);
    sqlite.close();
  });
});
