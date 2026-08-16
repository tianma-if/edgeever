import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import {
  AiPromptTemplateCreateSchema,
  AiPromptTemplateUpdateSchema,
  DEFAULT_AI_PROMPT_SEEDS,
  defaultAiPromptId,
} from "@edgeever/shared";
import { registerAiPromptRoutes } from "./ai-prompt-routes.ts";

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
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)")
    .run("ws_other", "Other workspace");
  return {
    sqlite,
    environment: {
      storage: { db: new SqliteD1Database(sqlite), resources: {} },
    },
  };
};

const createUpgradedDatabaseEnvironment = () => {
  const sqlite = new Database(":memory:");
  const migrations = globSync("migrations/*.sql").sort();
  for (const migration of migrations.filter((path) => path < "migrations/0027")) {
    sqlite.exec(readFileSync(migration, "utf8"));
  }
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)")
    .run("ws_member", "Member workspace");
  for (const migration of migrations.filter((path) => path >= "migrations/0027" && path < "migrations/0029")) {
    sqlite.exec(readFileSync(migration, "utf8"));
  }
  sqlite.query(
    `UPDATE ai_prompt_templates
     SET instruction = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    "Only this instruction was customized before the metadata migration.",
    "2026-08-12T01:00:00.000Z",
    defaultAiPromptId("ws_member", "summarize"),
  );
  sqlite.exec(readFileSync("migrations/0029_ai_prompt_behavior_and_localization.sql", "utf8"));
  return {
    sqlite,
    environment: {
      storage: { db: new SqliteD1Database(sqlite), resources: {} },
    },
  };
};

const createApp = ({ currentAuth = auth, demoMode = false } = {}) => {
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", currentAuth);
    await next();
  });
  registerAiPromptRoutes(app, { isDemoMode: () => demoMode });
  return app;
};

describe("AI prompt template routes", () => {
  test("keeps the starter catalog focused on six common workflows", () => {
    expect(DEFAULT_AI_PROMPT_SEEDS.map((prompt) => [prompt.key, prompt.name])).toEqual([
      ["summarize", "总结"],
      ["translate", "翻译"],
      ["improve-writing", "润色"],
      ["make-shorter", "精炼表达"],
      ["rewrite-proofread", "转为小红书风格"],
      ["simplify-language", "转为推特风格"],
    ]);
  });

  test("retires legacy system prompts even when their old copy was edited", () => {
    const sqlite = new Database(":memory:");
    const migrations = globSync("migrations/*.sql").sort();
    for (const migration of migrations.filter((path) => path < "migrations/0027")) {
      sqlite.exec(readFileSync(migration, "utf8"));
    }
    sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)")
      .run("ws_migration", "Migration workspace");
    for (const migration of migrations.filter(
      (path) => path >= "migrations/0027" && path < "migrations/0032",
    )) {
      sqlite.exec(readFileSync(migration, "utf8"));
    }

    sqlite.query(
      `UPDATE ai_prompt_templates
       SET instruction = ?, instruction_customized = 1
       WHERE workspace_id = ? AND seed_key = ?`,
    ).run("Keep my specialized proofreading prompt.", "ws_migration", "rewrite-proofread");

    sqlite.exec(readFileSync("migrations/0032_limit_default_ai_prompts.sql", "utf8"));

    const rows = sqlite.query(
      `SELECT seed_key, action, name, instruction
       FROM ai_prompt_templates
       WHERE workspace_id = ?
       ORDER BY name`,
    ).all("ws_migration");
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row.seed_key !== null).map((row) => row.seed_key).sort()).toEqual(
      DEFAULT_AI_PROMPT_SEEDS.map((prompt) => prompt.key).sort(),
    );
    expect(rows.find((row) => row.instruction === "Keep my specialized proofreading prompt.")).toBeUndefined();
  });

  test("validates create and update payloads", () => {
    expect(AiPromptTemplateCreateSchema.safeParse({
      name: "Weekly digest",
      instruction: "Summarize progress and risks.",
    })).toMatchObject({
      success: true,
      data: { parameterKind: "none", resultMode: "both" },
    });
    expect(AiPromptTemplateCreateSchema.safeParse({
      name: "",
      instruction: "Body",
    }).success).toBe(false);
    expect(AiPromptTemplateUpdateSchema.safeParse({
      instruction: "Updated instruction",
    }).success).toBe(true);
    expect(AiPromptTemplateUpdateSchema.safeParse({}).success).toBe(false);
  });

  test("supports create list update and delete within a workspace", async () => {
    const { environment } = createDatabaseEnvironment();
    const app = createApp();

    const created = await app.request(
      "/api/v1/ai/prompts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "会议待办",
          description: "提取行动项",
          instruction: "提取明确待办，输出 Markdown 任务列表。",
        }),
      },
      environment,
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.prompt).toMatchObject({
      origin: "custom",
      seedKey: null,
      action: "custom",
      parameterKind: "none",
      resultMode: "both",
      nameCustomized: true,
      descriptionCustomized: true,
      instructionCustomized: true,
      name: "会议待办",
      description: "提取行动项",
      instruction: "提取明确待办，输出 Markdown 任务列表。",
    });
    expect(createdBody.prompt.id).toMatch(/^aiprompt_/);

    const listed = await app.request("/api/v1/ai/prompts", {}, environment);
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.prompts).toHaveLength(1);
    expect(listedBody.prompts[0].id).toBe(createdBody.prompt.id);

    const updated = await app.request(
      `/api/v1/ai/prompts/${createdBody.prompt.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: "只提取有负责人的待办。" }),
      },
      environment,
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      prompt: {
        id: createdBody.prompt.id,
        name: "会议待办",
        instruction: "只提取有负责人的待办。",
      },
    });

    const deleted = await app.request(
      `/api/v1/ai/prompts/${createdBody.prompt.id}`,
      { method: "DELETE" },
      environment,
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });

    const empty = await app.request("/api/v1/ai/prompts", {}, environment);
    expect(await empty.json()).toEqual({ prompts: [] });
  });

  test("does not leak prompts across workspaces", async () => {
    const { environment } = createDatabaseEnvironment();
    const memberApp = createApp();
    const otherApp = createApp({
      currentAuth: { ...auth, workspaceId: "ws_other", actorId: "usr_other" },
    });

    const created = await memberApp.request(
      "/api/v1/ai/prompts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Private", instruction: "Keep this private." }),
      },
      environment,
    );
    const { prompt } = await created.json();

    const listed = await otherApp.request("/api/v1/ai/prompts", {}, environment);
    expect(await listed.json()).toEqual({ prompts: [] });

    const missing = await otherApp.request(
      `/api/v1/ai/prompts/${prompt.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Hijacked" }),
      },
      environment,
    );
    expect(missing.status).toBe(404);
  });

  test("blocks prompt mutations in demo mode", async () => {
    const { environment } = createDatabaseEnvironment();
    const app = createApp({ demoMode: true });
    const response = await app.request(
      "/api/v1/ai/prompts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Demo", instruction: "Should fail." }),
      },
      environment,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  test("restores only missing default prompts without overwriting edits", async () => {
    const { environment } = createDatabaseEnvironment();
    const app = createApp();
    const workspaceId = auth.workspaceId;

    const first = await app.request(
      "/api/v1/ai/prompts/restore-defaults?locale=en-US",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      environment,
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.restoredCount).toBe(DEFAULT_AI_PROMPT_SEEDS.length);
    expect(firstBody.prompts).toHaveLength(DEFAULT_AI_PROMPT_SEEDS.length);
    expect(firstBody.prompts.find((prompt) => prompt.seedKey === "summarize")).toMatchObject({
      origin: "default",
      action: "summarize",
      parameterKind: "none",
      resultMode: "append",
      nameCustomized: false,
      descriptionCustomized: false,
      instructionCustomized: false,
      name: "Summarize",
    });

    const summarizeId = defaultAiPromptId(workspaceId, "summarize");
    await app.request(
      `/api/v1/ai/prompts/${summarizeId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: "用户改过的总结指令" }),
      },
      environment,
    );

    const conciseId = defaultAiPromptId(workspaceId, "make-shorter");
    await app.request(`/api/v1/ai/prompts/${conciseId}`, { method: "DELETE" }, environment);

    const second = await app.request(
      "/api/v1/ai/prompts/restore-defaults",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      environment,
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.restoredCount).toBe(1);
    expect(secondBody.prompts).toHaveLength(DEFAULT_AI_PROMPT_SEEDS.length);

    const summarize = secondBody.prompts.find((prompt) => prompt.id === summarizeId);
    expect(summarize?.instruction).toBe("用户改过的总结指令");

    const third = await app.request(
      "/api/v1/ai/prompts/restore-defaults",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      environment,
    );
    expect(await third.json()).toMatchObject({ restoredCount: 0 });
  });

  test("localizes untouched factory fields while preserving field-level edits after upgrade", async () => {
    const { environment } = createUpgradedDatabaseEnvironment();
    const app = createApp();

    const english = await app.request("/api/v1/ai/prompts?locale=en-US", {}, environment);
    expect(english.status).toBe(200);
    const englishSummary = (await english.json()).prompts.find(
      (prompt) => prompt.seedKey === "summarize",
    );
    expect(englishSummary).toMatchObject({
      origin: "default",
      action: "summarize",
      resultMode: "append",
      name: "Summarize",
      description: "Condense the note into its topic, conclusions, and actionable outcomes",
      instruction: "Only this instruction was customized before the metadata migration.",
      nameCustomized: false,
      descriptionCustomized: false,
      instructionCustomized: true,
    });

    const chinese = await app.request("/api/v1/ai/prompts?locale=zh-CN", {}, environment);
    const chineseSummary = (await chinese.json()).prompts.find(
      (prompt) => prompt.seedKey === "summarize",
    );
    expect(chineseSummary).toMatchObject({
      name: "总结",
      description: "压缩全文，提炼主题、结论与可执行结果",
      instruction: "Only this instruction was customized before the metadata migration.",
    });
  });

  test("restores prompt behavior from backup without overwriting factory identity", async () => {
    const { environment } = createDatabaseEnvironment();
    const app = createApp();
    await app.request(
      "/api/v1/ai/prompts/restore-defaults?locale=en-US",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      environment,
    );

    const now = "2026-08-12T01:00:00.000Z";
    const response = await app.request(
      "/api/v1/restores/json/ai-prompts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompts: [{
            id: defaultAiPromptId(auth.workspaceId, "summarize"),
            origin: "custom",
            seedKey: null,
            action: "custom",
            parameterKind: "tone",
            resultMode: "replace",
            nameCustomized: true,
            descriptionCustomized: true,
            instructionCustomized: true,
            name: "Collision-safe custom prompt",
            description: null,
            instruction: "Rewrite in the requested tone.",
            createdAt: now,
            updatedAt: now,
          }],
        }),
      },
      environment,
    );
    expect(response.status).toBe(200);

    const listed = await app.request("/api/v1/ai/prompts?locale=en-US", {}, environment);
    const prompts = (await listed.json()).prompts;
    expect(prompts).toHaveLength(DEFAULT_AI_PROMPT_SEEDS.length + 1);
    expect(prompts.find((prompt) => prompt.seedKey === "summarize")).toMatchObject({
      origin: "default",
      name: "Summarize",
    });
    expect(prompts.find((prompt) => prompt.name === "Collision-safe custom prompt")).toMatchObject({
      origin: "custom",
      seedKey: null,
      parameterKind: "tone",
      resultMode: "replace",
    });
  });

  test("keeps untouched factory copy localizable when restoring a backup made in another locale", async () => {
    const { environment } = createDatabaseEnvironment();
    const app = createApp();
    const restored = await app.request(
      "/api/v1/ai/prompts/restore-defaults?locale=en-US",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      environment,
    );
    const englishSummary = (await restored.json()).prompts.find(
      (prompt) => prompt.seedKey === "summarize",
    );

    const response = await app.request(
      "/api/v1/restores/json/ai-prompts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompts: [englishSummary] }),
      },
      environment,
    );
    expect(response.status).toBe(200);

    const chinese = await app.request("/api/v1/ai/prompts?locale=zh-CN", {}, environment);
    const chineseSummary = (await chinese.json()).prompts.find(
      (prompt) => prompt.seedKey === "summarize",
    );
    expect(chineseSummary).toMatchObject({
      name: "总结",
      description: "压缩全文，提炼主题、结论与可执行结果",
      nameCustomized: false,
      descriptionCustomized: false,
      instructionCustomized: false,
    });
  });
});
