import { AiAttachmentSchema, CompanionDiscoveryCompleteSchema, CompanionDiscoverySettingsInputSchema, CompanionIdSchema, CompanionMemoryImportSchema, CompanionMemoryInputSchema, CompanionMemoryUpdateSchema,
  CompanionToolExecuteSchema, CompanionTurnCheckpointSchema, CompanionTurnCompleteSchema,
  CompanionTurnInputSchema, CompanionTurnResumeSchema, companionTurnLocale, type CompanionSource, type CompanionToolCall } from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppContext, AppEnv, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { COMPANION_REQUEST_MAX_BYTES, EMPTY_AI_MODEL_OUTPUT_BUDGETS, resolveAiModelOutputBudget } from "@edgeever/shared";
import { loadDefaultAiModelCredentials, resolveDefaultAiModel } from "./ai-service";
import { apiError, forbidden, httpExceptionError, notFound } from "./http-errors";
import { requireUser, getWorkspaceId } from "./request-auth";
import { beginCompanionTurn, checkpointCompanionTurn, clearCompanionHistory, companionRevision,
  forgetCompanionMemory, getCompanionTurn, listCompanionMemories, listCompanionTurns, mapCompanionTurn,
  resumeCompanionTurn, saveCompanionMemory, importCompanionMemories, turnAnswers, turnInputFromRow, type CompanionScope, } from "./companion-service";
import { parseJsonArray, parseJsonObject } from "./companion-tool-receipts";
import { prepareCompanionTurn, type CompanionRunState } from "./companion-prepare";
import { assertCompanionAttachmentsSupported, bindCompanionTurnAttachments, storeCompanionAttachment } from "./companion-attachments";
import { executeCompanionTurnTool, parseCompanionAgentSession } from "./companion-agent-tools";
import { applyCompanionAction, dismissCompanionAction, listCompanionActions } from "./companion-actions";
import { acknowledgeDiscovery, rememberDiscoveryFeedback, completeDiscoveryGeneration, discoveryPreparePayload, getDiscoverySettings, listDiscoveries, saveDiscoverySettings, startDiscoveryCheck } from "./companion-discovery";

const scopeFor = (c: AppContext): CompanionScope => ({ workspaceId: getWorkspaceId(c), ownerId: c.get("auth").actorId! });
const fail = (c: AppContext, error: unknown) => {
  if (error instanceof AppError) return apiError(c, error.code, error.message, error.status);
  const requestError = httpExceptionError(c, error);
  if (requestError) return requestError;
  console.error("companion_failed", error instanceof Error ? error.name : "unknown");
  return apiError(c, "companion_failed", "The companion is unavailable. Please retry later.", 503);
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? value as Record<string, unknown> : null;

export const companionGenerationFailure = (error: unknown): { code: string } => {
  if (error instanceof AppError) return { code: error.code };
  const record = asRecord(error);
  const status = typeof record?.statusCode === "number" ? record.statusCode
    : typeof record?.status === "number" ? record.status : undefined;
  if (status === 401 || status === 403) return { code: "ai_credentials_rejected" };
  if (status === 402) return { code: "ai_provider_payment_required" };
  if (status === 429) return { code: "ai_provider_rate_limited" };
  if (status === 400) return { code: "ai_provider_request_rejected" };
  return { code: "companion_generation_failed" };
};

export const registerCompanionRoutes = (parent: Hono<AppEnv>, dependencies: {
  isDemoMode: (env: Bindings) => boolean;
  loadCredentials?: typeof loadDefaultAiModelCredentials;
  resolveModel?: typeof resolveDefaultAiModel;
}) => {
  const app = new Hono<AppEnv>();
  // Credentials and budget come from one default-model lookup (#652).
  const resolveModel: typeof resolveDefaultAiModel = async (db, workspaceId, env) => {
    if (dependencies.resolveModel) return dependencies.resolveModel(db, workspaceId, env);
    if (dependencies.loadCredentials) {
      return {
        credentials: await dependencies.loadCredentials(db, workspaceId, env),
        outputBudgets: EMPTY_AI_MODEL_OUTPUT_BUDGETS,
        capabilities: null,
        modelConfigId: "",
        providerConfigId: "",
        providerConfigVersion: "",
      };
    }
    return resolveDefaultAiModel(db, workspaceId, env);
  };
  app.onError((error, c) => fail(c, error));
  // Upload bodies exceed the JSON limit used by the rest of the companion API.
  const limitCompanionBody = bodyLimit({ maxSize: COMPANION_REQUEST_MAX_BYTES });
  app.use("/api/v1/companion/*", (c, next) => {
    if (c.req.path.endsWith("/companion/attachments") && c.req.method === "POST") return next();
    return limitCompanionBody(c, next);
  });
  app.use("/api/v1/companion/*", async (c, next) => {
    const denied = requireUser(c);
    if (denied) return denied;
    if (!c.get("auth").actorId || dependencies.isDemoMode(c.env)) return forbidden(c, "Companion preview requires a personal signed-in account outside demo mode.");
    c.header("Cache-Control", "no-store");
    try { await next(); } catch (error) { return fail(c, error); }
  });

  app.get("/api/v1/companion/memories", async c => c.json({ memories: await listCompanionMemories(c.env.storage.db, scopeFor(c)) }));
  app.get("/api/v1/companion/discovery/settings", async c => c.json({ settings: await getDiscoverySettings(c.env.storage.db, scopeFor(c)) }));
  app.put("/api/v1/companion/discovery/settings", zValidator("json", CompanionDiscoverySettingsInputSchema), async c => {
    const input = c.req.valid("json");
    // Validate the same default model used by an actual discovery check.
    // Turning Paw mode off must remain possible when a provider is unavailable.
    const previous = await getDiscoverySettings(c.env.storage.db, scopeFor(c));
    if (input.enabled && !previous.enabled) {
      await (dependencies.loadCredentials ?? loadDefaultAiModelCredentials)(c.env.storage.db, getWorkspaceId(c), c.env);
    }
    return c.json({ settings: await saveDiscoverySettings(c.env.storage.db, scopeFor(c), input) });
  });
  app.get("/api/v1/companion/discovery", async c => c.json({ items: await listDiscoveries(c.env.storage.db, scopeFor(c)) }));
  app.post("/api/v1/companion/discovery/check/prepare", async c => {
    const stop = new AbortController();
    const timeout = setTimeout(() => stop.abort(), 60_000);
    try {
      const locale = companionTurnLocale(c.req.query("locale"));
      const db = c.env.storage.db;
      const scope = scopeFor(c);
      let credentials: Awaited<ReturnType<typeof loadDefaultAiModelCredentials>> | undefined;
      const started = await startDiscoveryCheck(db, scope, {
        locale, signal: AbortSignal.any([stop.signal, c.req.raw.signal]),
        loadModelId: async () => {
          credentials = await (dependencies.loadCredentials ?? loadDefaultAiModelCredentials)(db, scope.workspaceId, c.env);
          return credentials.modelId;
        },
      });
      if (!started || !credentials) return c.json({ quiet: true, items: await listDiscoveries(db, scope) });
      return c.json(discoveryPreparePayload({ turnId: started.turnId, generationInput: started.generationInput, credentials }));
    } finally { clearTimeout(timeout); }
  });
  app.post("/api/v1/companion/discovery/check/complete", zValidator("json", CompanionDiscoveryCompleteSchema), async c => {
    const stop = new AbortController();
    const timeout = setTimeout(() => stop.abort(), 60_000);
    try {
      await completeDiscoveryGeneration(
        c.env.storage.db, scopeFor(c), c.req.valid("json").turnId, c.req.valid("json").output,
        AbortSignal.any([stop.signal, c.req.raw.signal]),
      );
      return c.json({ items: await listDiscoveries(c.env.storage.db, scopeFor(c)) });
    } finally { clearTimeout(timeout); }
  });
  app.post("/api/v1/companion/discovery/:id/feedback", async c => {
    if (!CompanionIdSchema.safeParse(c.req.param("id")).success) return notFound(c, "Discovery not found.");
    await rememberDiscoveryFeedback(c.env.storage.db, scopeFor(c), c.req.param("id"));
    return c.json({ ok: true });
  });
  for (const operation of ["seen", "dismiss"] as const) app.post(`/api/v1/companion/discovery/:id/${operation}`, async c => {
    if (!CompanionIdSchema.safeParse(c.req.param("id")).success) return notFound(c, "Discovery not found.");
    await acknowledgeDiscovery(c.env.storage.db, scopeFor(c), c.req.param("id"), operation === "dismiss");
    return c.json({ ok: true });
  });
  app.get("/api/v1/companion/actions", async c => c.json({ actions: await listCompanionActions(c.env.storage.db, scopeFor(c)) }));
  // Not exposed as model tools. The client submits only the persisted proposal
  // ID; source notes, tags and ordering cannot be replaced at confirmation time.
  app.post("/api/v1/companion/actions/:id/apply", async c => {
    if (!CompanionIdSchema.safeParse(c.req.param("id")).success) return notFound(c, "Suggestion not found.");
    return c.json({ action: await applyCompanionAction(c.env.storage.db, scopeFor(c), c.req.param("id"), c) });
  });
  app.post("/api/v1/companion/actions/:id/dismiss", async c => {
    if (!CompanionIdSchema.safeParse(c.req.param("id")).success) return notFound(c, "Suggestion not found.");
    return c.json({ action: await dismissCompanionAction(c.env.storage.db, scopeFor(c), c.req.param("id")) });
  });
  app.post("/api/v1/companion/memories", zValidator("json", CompanionMemoryInputSchema), async c => {
    return c.json({ memory: await saveCompanionMemory(c.env.storage.db, scopeFor(c), c.req.valid("json")) }, 201);
  });
  app.patch("/api/v1/companion/memories/:id", zValidator("json", CompanionMemoryUpdateSchema), async c => {
    const input = c.req.valid("json");
    return c.json({ memory: await saveCompanionMemory(c.env.storage.db, scopeFor(c), { content: input.content }, { id: c.req.param("id"), version: input.version }) });
  });
  app.delete("/api/v1/companion/memories/:id", async c => {
    const version = Number(c.req.query("version"));
    if (!Number.isSafeInteger(version) || version < 1) return apiError(c, "invalid_version", "A memory version is required.", 400);
    await forgetCompanionMemory(c.env.storage.db, scopeFor(c), c.req.param("id"), version);
    return c.json({ ok: true });
  });
  app.get("/api/v1/companion/turns", async c => {
    const thread = c.req.query("threadId");
    if (thread && !CompanionIdSchema.safeParse(thread).success) return apiError(c, "invalid_thread", "Invalid conversation ID.", 400);
    return c.json({ turns: (await listCompanionTurns(c.env.storage.db, scopeFor(c), thread)).map(mapCompanionTurn) });
  });
  app.get("/api/v1/companion/turns/:id", async c => {
    await listCompanionTurns(c.env.storage.db, scopeFor(c));
    const row = await getCompanionTurn(c.env.storage.db, scopeFor(c), c.req.param("id"));
    return row ? c.json({ turn: mapCompanionTurn(row) }) : notFound(c, "Conversation not found.");
  });
  app.delete("/api/v1/companion/history", async c => {
    await clearCompanionHistory(c.env.storage.db, scopeFor(c));
    return c.json({ ok: true });
  });
  app.post("/api/v1/companion/turns/:id/cancel", async c => {
    await c.env.storage.db.prepare("UPDATE companion_turns SET status = 'cancelled' WHERE workspace_id = ? AND owner_id = ? AND id = ? AND status = 'running'")
      .bind(getWorkspaceId(c), c.get("auth").actorId, c.req.param("id")).run();
    return c.json({ ok: true });
  });
  app.post("/api/v1/companion/turns/:id/resume/prepare", zValidator("json", CompanionTurnResumeSchema), async c => {
    if (!CompanionIdSchema.safeParse(c.req.param("id")).success) return notFound(c, "Conversation not found.");
    const db = c.env.storage.db;
    const scope = scopeFor(c);
    const answers = c.req.valid("json").answers;
    const previous = await getCompanionTurn(db, scope, c.req.param("id"));
    if (!previous) return notFound(c, "Conversation not found.");
    if (parseJsonArray(previous.questions_json).length && !answers?.length) {
      return apiError(c, "companion_answers_required", "Answer the questions before continuing.", 400);
    }
    const { credentials, outputBudgets } = await resolveModel(db, scope.workspaceId, c.env);
    const row = await resumeCompanionTurn(db, scope, previous.id, answers);
    const input = turnInputFromRow(row);
    return c.json(await prepareCompanionTurn({
      db, scope, input, row, credentials,
      maxOutputTokens: resolveAiModelOutputBudget(outputBudgets, "companionMaxOutputTokens"),
      resume: { response: row.response, answers: answers ?? turnAnswers(row) },
    }));
  });
  app.post("/api/v1/companion/turns/:id/tools", zValidator("json", CompanionToolExecuteSchema), async c => {
    if (!CompanionIdSchema.safeParse(c.req.param("id")).success) return notFound(c, "Conversation not found.");
    const db = c.env.storage.db;
    const scope = scopeFor(c);
    const row = await getCompanionTurn(db, scope, c.req.param("id"));
    if (!row) return notFound(c, "Conversation not found.");
    if (row.status !== "running") return apiError(c, "companion_resume_unavailable", "This request cannot be continued.", 409);
    if (await companionRevision(db, scope) !== row.memory_revision) {
      throw new AppError("companion_context_changed", "Context changed.", 409);
    }
    const body = c.req.valid("json");
    const sources: CompanionSource[] = parseJsonArray(row.sources_json);
    const run: CompanionRunState = {
      tools: parseJsonArray(row.tools_json),
      todos: parseJsonArray(row.todos_json),
      questions: parseJsonArray(row.questions_json),
      pause: { ask: false },
    };
    const session = parseCompanionAgentSession(parseJsonObject(row.agent_session_json, {}));
    const input = turnInputFromRow(row);
    const response = body.response ?? row.response;
    const process = body.process ?? row.process_text ?? "";
    const result = await executeCompanionTurnTool({
      db, scope, context: c, input, signal: c.req.raw.signal,
      assertActive: async () => {
        const current = await getCompanionTurn(db, scope, row.id);
        if (!current || current.status !== "running" || await companionRevision(db, scope) !== row.memory_revision) {
          throw new AppError("companion_context_changed", "Context changed.", 409);
        }
      },
      sources, run, session, name: body.name, toolInput: body.input,
    });
    await checkpointCompanionTurn(db, scope, row, response, sources, "running", undefined, {
      tools: run.tools, todos: run.todos, questions: run.questions, process, session,
    });
    return c.json({ result, tools: run.tools, todos: run.todos, questions: run.questions, pause: run.pause.ask });
  });
  app.post("/api/v1/companion/turns/:id/checkpoint", zValidator("json", CompanionTurnCheckpointSchema), async c => {
    if (!CompanionIdSchema.safeParse(c.req.param("id")).success) return notFound(c, "Conversation not found.");
    const db = c.env.storage.db;
    const scope = scopeFor(c);
    const row = await getCompanionTurn(db, scope, c.req.param("id"));
    if (!row) return notFound(c, "Conversation not found.");
    if (row.status !== "running") return apiError(c, "companion_resume_unavailable", "This request cannot be continued.", 409);
    const body = c.req.valid("json");
    await checkpointCompanionTurn(db, scope, row, body.response, parseJsonArray(row.sources_json), "running", undefined, {
      process: body.process,
    });
    return c.json({ ok: true });
  });
  app.post("/api/v1/companion/turns/:id/complete", zValidator("json", CompanionTurnCompleteSchema), async c => {
    if (!CompanionIdSchema.safeParse(c.req.param("id")).success) return notFound(c, "Conversation not found.");
    const db = c.env.storage.db;
    const scope = scopeFor(c);
    const row = await getCompanionTurn(db, scope, c.req.param("id"));
    if (!row) return notFound(c, "Conversation not found.");
    if (row.status !== "running") return apiError(c, "companion_resume_unavailable", "This request cannot be continued.", 409);
    const body = c.req.valid("json");
    const tools = parseJsonArray<CompanionToolCall>(row.tools_json);
    const todos = parseJsonArray(row.todos_json);
    const questions = parseJsonArray(row.questions_json);
    if (body.status === "completed" && !body.response.trim() && !tools.some(tool => tool.status === "done") && !todos.length && !questions.length) {
      throw new AppError("companion_generation_failed", "No text returned.", 502);
    }
    await checkpointCompanionTurn(
      db, scope, row, body.response, parseJsonArray(row.sources_json), body.status,
      { inputTokens: body.inputTokens, outputTokens: body.outputTokens },
      { process: body.process },
    );
    const completed = await getCompanionTurn(db, scope, row.id);
    return c.json({ turn: completed ? mapCompanionTurn(completed) : mapCompanionTurn({ ...row, response: body.response, status: body.status }) });
  });
  // Separate export is explicit in the preview UI: the note ZIP does not yet
  // contain companion data. Do not silently imply lossless full-app backup.
  app.get("/api/v1/companion/export", async c => {
    const scope = scopeFor(c);
    const rows = await c.env.storage.db.prepare("SELECT * FROM companion_turns WHERE workspace_id = ? AND owner_id = ? ORDER BY created_at")
      .bind(scope.workspaceId, scope.ownerId).all<import("./companion-service").TurnRow>();
    const settings = await getDiscoverySettings(c.env.storage.db, scope);
    return c.json({ version: 2, controls: { useMemory: settings.useMemory === true, learningEnabled: settings.learningEnabled === true }, exportedAt: new Date().toISOString(),
      memories: await listCompanionMemories(c.env.storage.db, scope), turns: rows.results.map(mapCompanionTurn),
      actions: await listCompanionActions(c.env.storage.db, scope, 1500),
      discoverySettings: await getDiscoverySettings(c.env.storage.db, scope),
      discoveries: (await c.env.storage.db.prepare("SELECT * FROM companion_discoveries WHERE workspace_id = ? AND owner_id = ? ORDER BY created_at")
        .bind(scope.workspaceId, scope.ownerId).all()).results });
  });
  app.post("/api/v1/companion/import-memories", zValidator("json", CompanionMemoryImportSchema), async c => {
    const scope = scopeFor(c);
    return c.json({ memories: await importCompanionMemories(c.env.storage.db, scope, c.req.valid("json").memories, c.req.valid("json").controls) });
  });

  const cancelTurn = async (db: AppContext["env"]["storage"]["db"], scope: CompanionScope, id: string) => {
    await db.prepare("UPDATE companion_turns SET status = 'cancelled' WHERE id = ? AND workspace_id = ? AND owner_id = ?")
      .bind(id, scope.workspaceId, scope.ownerId).run();
  };
  const bindTurnAttachments = async (db: AppContext["env"]["storage"]["db"], scope: CompanionScope, turnId: string, ids?: string[]) => {
    try {
      await bindCompanionTurnAttachments(db, scope, turnId, ids);
    } catch (error) {
      await cancelTurn(db, scope, turnId);
      throw error;
    }
  };
  app.post("/api/v1/companion/attachments", bodyLimit({ maxSize: 7 * 1024 * 1024 }), zValidator("json", AiAttachmentSchema), async c => {
    return c.json(await storeCompanionAttachment(c.env.storage.db, scopeFor(c), c.req.valid("json")));
  });
  app.post("/api/v1/companion/turns/prepare", zValidator("json", CompanionTurnInputSchema), async c => {
    const input = c.req.valid("json");
    const db = c.env.storage.db;
    const scope = scopeFor(c);
    const duplicate = await getCompanionTurn(db, scope, input.id);
    if (duplicate) return apiError(c, "companion_request_exists", "This request already exists. Recover it by its ID; it will not be billed again.", 409);
    const { credentials, outputBudgets } = await resolveModel(db, scope.workspaceId, c.env);
    if (input.attachmentIds?.length) {
      await assertCompanionAttachmentsSupported(db, scope, credentials.provider, input.attachmentIds);
    }
    await listCompanionMemories(db, scope);
    const expectedRevision = await companionRevision(db, scope);
    const settings = await getDiscoverySettings(db, scope);
    input.useMemory = input.useMemory && settings.useMemory === true;
    const row = await beginCompanionTurn(db, scope, input, credentials.modelId);
    if (row.memory_revision !== expectedRevision) {
      await cancelTurn(db, scope, row.id);
      throw new AppError("companion_context_changed", "Memory settings changed. Retry with current settings.", 409);
    }
    await bindTurnAttachments(db, scope, row.id, input.attachmentIds);
    return c.json(await prepareCompanionTurn({
      db, scope, input, row, credentials,
      maxOutputTokens: resolveAiModelOutputBudget(outputBudgets, "companionMaxOutputTokens"),
    }));
  });
  for (const path of ["/api/v1/companion/discovery/check", "/api/v1/companion/discovery/check/proxy", "/api/v1/companion/turns", "/api/v1/companion/turns/:id/proxy", "/api/v1/companion/turns/:id/resume"]) app.post(path, c => apiError(c, "ai_client_required", "Update the client to call the model directly.", 410));
  parent.route("/", app);
};
