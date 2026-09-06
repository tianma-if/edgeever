import { CompanionDiscoverySettingsInputSchema, CompanionIdSchema, CompanionMemoryImportSchema, CompanionMemoryInputSchema, CompanionMemoryUpdateSchema,
  CompanionTurnInputSchema, type CompanionEvent, type CompanionSource } from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppContext, AppEnv, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { loadDefaultAiModel } from "./ai-service";
import { apiError, forbidden, notFound } from "./http-errors";
import { requireUser, getWorkspaceId } from "./request-auth";
import { beginCompanionTurn, checkpointCompanionTurn, clearCompanionHistory, companionRevision,
  forgetCompanionMemory, getCompanionTurn, listCompanionMemories, listCompanionTurns, mapCompanionTurn,
  saveCompanionMemory, importCompanionMemories, type CompanionScope } from "./companion-service";
import type { streamCompanion } from "./companion-runtime";
import { applyCompanionAction, dismissCompanionAction, listCompanionActions } from "./companion-actions";
import { acknowledgeDiscovery, rememberDiscoveryFeedback, checkDiscoveries, getDiscoverySettings, listDiscoveries, saveDiscoverySettings } from "./companion-discovery";

const scopeFor = (c: AppContext): CompanionScope => ({ workspaceId: getWorkspaceId(c), ownerId: c.get("auth").actorId! });
const fail = (c: AppContext, error: unknown) => error instanceof AppError
  ? apiError(c, error.code, error.message, error.status)
  : apiError(c, "companion_failed", "The companion is unavailable. Please retry later.", 503);

export const registerCompanionRoutes = (parent: Hono<AppEnv>, dependencies: {
  isDemoMode: (env: Bindings) => boolean;
  loadModel?: typeof loadDefaultAiModel;
  stream?: typeof streamCompanion;
}) => {
  const app = new Hono<AppEnv>();
  app.onError((error, c) => fail(c, error));
  app.use("/api/v1/companion/*", bodyLimit({ maxSize: 128 * 1024 }));
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
      await (dependencies.loadModel ?? loadDefaultAiModel)(c.env.storage.db, getWorkspaceId(c), c.env);
    }
    return c.json({ settings: await saveDiscoverySettings(c.env.storage.db, scopeFor(c), input) });
  });
  app.get("/api/v1/companion/discovery", async c => c.json({ items: await listDiscoveries(c.env.storage.db, scopeFor(c)) }));
  app.post("/api/v1/companion/discovery/check", async c => {
    const stop = new AbortController();
    const timeout = setTimeout(() => stop.abort(), 60_000);
    try {
      await checkDiscoveries(c.env.storage.db, scopeFor(c), {
        locale: c.req.query("locale") === "zh-CN" ? "zh-CN" : "en-US",
        signal: AbortSignal.any([stop.signal, c.req.raw.signal]),
        loadModel: () => (dependencies.loadModel ?? loadDefaultAiModel)(c.env.storage.db, getWorkspaceId(c), c.env),
      });
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

  app.post("/api/v1/companion/turns", zValidator("json", CompanionTurnInputSchema), async c => {
    const input = c.req.valid("json");
    const db = c.env.storage.db;
    const scope = scopeFor(c);
    const duplicate = await getCompanionTurn(db, scope, input.id);
    if (duplicate) return apiError(c, "companion_request_exists", "This request already exists. Recover it by its ID; it will not be billed again.", 409);
    const model = await (dependencies.loadModel ?? loadDefaultAiModel)(db, scope.workspaceId, c.env);
    await listCompanionMemories(db, scope);
    const expectedRevision = await companionRevision(db, scope);
    const settings = await getDiscoverySettings(db, scope);
    input.useMemory = input.useMemory && settings.useMemory === true;
    const row = await beginCompanionTurn(db, scope, input, model.modelId);
    if (row.memory_revision !== expectedRevision) {
      await db.prepare("UPDATE companion_turns SET status = 'cancelled' WHERE id = ? AND workspace_id = ? AND owner_id = ?").bind(row.id, scope.workspaceId, scope.ownerId).run();
      throw new AppError("companion_context_changed", "Memory settings changed. Retry with current settings.", 409);
    }
    const stop = new AbortController();
    const timeout = setTimeout(() => stop.abort(), 60_000);
    const signal = AbortSignal.any([stop.signal, c.req.raw.signal]);
    const assertActive = async () => {
      signal.throwIfAborted();
      const current = await getCompanionTurn(db, scope, row.id);
      if (!current || current.status !== "running" || await companionRevision(db, scope) !== row.memory_revision) {
        stop.abort();
        throw new AppError("companion_context_changed", "Context changed.", 409);
      }
    };
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let response = "";
        let persisted = 0;
        const sources: CompanionSource[] = [];
        const send = (event: CompanionEvent) => { if (!signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); };
        try {
          send({ type: "start", id: row.id });
          const [memories, history] = await Promise.all([listCompanionMemories(db, scope), listCompanionTurns(db, scope, input.threadId)]);
          const stream = dependencies.stream ?? (await import("./companion-runtime")).streamCompanion;
          await assertActive();
          const result = await stream({ db, scope, input, model, memories, history, revision: row.memory_revision, signal, sources, assertActive, context: c });
          for await (const part of result.fullStream) {
            signal.throwIfAborted();
            if (part.type === "error") throw part.error;
            if (part.type !== "text-delta") continue;
            response += part.text;
            if (response.length > 16000) throw new Error("Response limit exceeded.");
            // Persist before display in bounded chunks, so refresh recovers the
            // displayed prefix without writing one database row per token.
            if (response.length - persisted >= 300) {
              await checkpointCompanionTurn(db, scope, row, response, sources, "running");
              send({ type: "text-delta", text: response.slice(persisted) });
              persisted = response.length;
            }
          }
          await assertActive();
          if (!response.trim()) throw new Error("No text returned.");
          const usage = await result.totalUsage;
          await checkpointCompanionTurn(db, scope, row, response, sources, "completed", usage);
          send({ type: "text-delta", text: response.slice(persisted) });
          const completed = await getCompanionTurn(db, scope, row.id);
          if (completed) send({ type: "done", turn: mapCompanionTurn(completed) });
        } catch (error) {
          await checkpointCompanionTurn(db, scope, row, response, sources, signal.aborted ? "cancelled" : "failed").catch(() => {});
          send({ type: "error", code: error instanceof AppError ? error.code : "companion_generation_failed" });
        } finally {
          stop.abort();
          clearTimeout(timeout);
          try { controller.close(); } catch { /* The client may have disconnected. */ }
        }
      },
      cancel() { stop.abort(); clearTimeout(timeout); },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  });
  parent.route("/", app);
};
