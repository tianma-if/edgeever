import {
  AiConnectionTestSchema,
  AiGenerateSchema,
  AiModelSettingsUpdateSchema,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppContext, AppEnv, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { auditStatement } from "./audit";
import {
  getAiModelConfig,
  decryptAiCredential,
  loadActiveAiModel,
  mapAiModelSettings,
  normalizeAiBaseUrl,
  resolvePrimaryAiCredentialEncryptionKey,
  streamAiGeneration,
  testAiModel,
} from "./ai-service";
import { isoNow } from "./entity-utils";
import { apiError, forbidden } from "./http-errors";
import { getWorkspaceId, requireUser } from "./request-auth";
import { encryptSecret } from "./secret-encryption";

type AiRouteDependencies = {
  isDemoMode: (environment: Bindings) => boolean;
};

const getSubmittedApiKey = async (context: AppContext, submittedApiKey: string | undefined) => {
  if (submittedApiKey) return submittedApiKey;
  const row = await getAiModelConfig(context.env.storage.db, getWorkspaceId(context));
  if (!row?.api_key_encrypted) {
    throw new AppError("ai_api_key_required", "API Key is required.", 400);
  }
  return decryptAiCredential(row.api_key_encrypted, context.env);
};

const providerErrorMessage = (error: unknown) => {
  if (error instanceof AppError) return error.message;
  if (!(error instanceof Error)) return "The AI provider request failed.";
  return error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 1000);
};

export const registerAiRoutes = (app: Hono<AppEnv>, dependencies: AiRouteDependencies) => {
  app.get("/api/v1/ai/settings", async (context) => {
    const denied = requireUser(context);
    if (denied) return denied;
    const row = await getAiModelConfig(context.env.storage.db, getWorkspaceId(context));
    return context.json({
      settings: row
        ? mapAiModelSettings(row, Boolean(resolvePrimaryAiCredentialEncryptionKey(context.env)))
        : null,
      encryptionConfigured: Boolean(resolvePrimaryAiCredentialEncryptionKey(context.env)),
    });
  });

  app.post(
    "/api/v1/ai/settings/test",
    zValidator("json", AiConnectionTestSchema),
    async (context) => {
      const denied = requireUser(context);
      if (denied) return denied;
      const input = context.req.valid("json");
      try {
        const result = await testAiModel({
          provider: input.provider,
          baseUrl: input.baseUrl,
          apiKey: await getSubmittedApiKey(context, input.apiKey),
          modelId: input.modelId,
        });
        return context.json({ ok: true, response: result.text.trim() });
      } catch (error) {
        return apiError(context, "ai_connection_failed", providerErrorMessage(error), 400);
      }
    },
  );

  app.put(
    "/api/v1/ai/settings",
    zValidator("json", AiModelSettingsUpdateSchema),
    async (context) => {
      const denied = requireUser(context);
      if (denied) return denied;
      if (dependencies.isDemoMode(context.env)) {
        return forbidden(context, "AI settings cannot be changed in demo mode.");
      }
      const encryptionKey = resolvePrimaryAiCredentialEncryptionKey(context.env);
      if (!encryptionKey) {
        return apiError(
          context,
          "ai_encryption_key_missing",
          "AI credential encryption requires instance authentication or an optional EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY.",
          400,
        );
      }
      const input = context.req.valid("json");
      const apiKey = await getSubmittedApiKey(context, input.apiKey);
      const workspaceId = getWorkspaceId(context);
      const now = isoNow();
      const configId = `ai_${workspaceId}`;
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `INSERT INTO ai_model_configs (
             id, workspace_id, provider, display_name, base_url, api_key_encrypted,
             model_id, is_enabled, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             provider = excluded.provider, display_name = excluded.display_name,
             base_url = excluded.base_url, api_key_encrypted = excluded.api_key_encrypted,
             model_id = excluded.model_id, is_enabled = excluded.is_enabled,
             updated_at = excluded.updated_at`,
        ).bind(
          configId,
          workspaceId,
          input.provider,
          input.displayName,
          normalizeAiBaseUrl(input.baseUrl),
          await encryptSecret(apiKey, encryptionKey),
          input.modelId,
          input.isEnabled ? 1 : 0,
          now,
          now,
        ),
        auditStatement(
          context.env.storage.db,
          "user",
          context.get("auth").actorId,
          "workspace.ai_model.update",
          "ai_model_config",
          configId,
          { provider: input.provider, modelId: input.modelId, isEnabled: input.isEnabled },
        ),
      ]);
      const row = await getAiModelConfig(context.env.storage.db, workspaceId);
      return context.json({
        settings: row ? mapAiModelSettings(row, true) : null,
        encryptionConfigured: true,
      });
    },
  );

  app.post(
    "/api/v1/ai/generate",
    zValidator("json", AiGenerateSchema),
    async (context) => {
      const denied = requireUser(context);
      if (denied) return denied;
      try {
        const input = context.req.valid("json");
        const model = await loadActiveAiModel(
          context.env.storage.db,
          getWorkspaceId(context),
          context.env,
        );
        const result = streamAiGeneration({ ...input, model, abortSignal: context.req.raw.signal });
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            send({ type: "start" });
            try {
              for await (const text of result.textStream) {
                send({ type: "text-delta", text });
              }
              const [usage, finishReason] = await Promise.all([result.usage, result.finishReason]);
              send({
                type: "finish",
                finishReason,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
              });
            } catch (error) {
              send({ type: "error", code: "ai_generation_failed", message: providerErrorMessage(error) });
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      } catch (error) {
        if (error instanceof AppError) return apiError(context, error.code, error.message, error.status);
        return apiError(context, "ai_generation_failed", providerErrorMessage(error), 400);
      }
    },
  );
};
