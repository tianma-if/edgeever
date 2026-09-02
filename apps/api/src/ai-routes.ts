import {
  AiDefaultModelUpdateSchema,
  AiGenerateSchema,
  AiModelConfigCreateSchema,
  AiProviderConfigCreateSchema,
  AiProviderConfigUpdateSchema,
  AiProviderConnectionTestSchema,
  AiTagSuggestionPromptUpdateSchema,
  AiTagSuggestionsRequestSchema,
  MAX_AI_TAG_SUGGESTIONS,
  normalizeTags,
  promptNeedsTargetLanguage,
  promptNeedsTone,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { AppContext, AppEnv, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { auditStatement } from "./audit";
import { getAiPromptTemplate, resolveWorkspaceActionInstruction } from "./ai-prompt-service";
import {
  createAiGenerationResultBoundary,
  createAiGenerationStreamNormalizer,
  decryptAiCredential,
  discoverAiModels,
  getAiModelConfig,
  getAiProviderConfig,
  getAiSettings,
  getAiTagSuggestionPrompt,
  getDefaultAiModelId,
  generateAiGeneration,
  generateAiTagSuggestions,
  loadDefaultAiModel,
  normalizeAiGenerationText,
  normalizeAiBaseUrl,
  resolvePrimaryAiCredentialEncryptionKey,
  streamAiGeneration,
  testAiModel,
} from "./ai-service";
import { createId, isoNow } from "./entity-utils";
import { apiError, forbidden, notFound } from "./http-errors";
import { getWorkspaceId, requireUser } from "./request-auth";
import { encryptSecret } from "./secret-encryption";
import { listTagSummaries } from "./tag-service";

type AiRouteDependencies = {
  isDemoMode: (environment: Bindings) => boolean;
  testConnection?: (config: Parameters<typeof testAiModel>[0]) => Promise<{ text: string }>;
  suggestTags?: (input: {
    title: string;
    contentMarkdown: string;
    currentTags: string[];
    existingTags: string[];
    locale?: string;
  }) => Promise<string[]>;
};

const providerErrorMessage = (error: unknown) => {
  if (error instanceof AppError) return error.message;
  if (!(error instanceof Error)) return "The AI provider request failed.";
  return error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 1000);
};

const validateAiGeneration = zValidator("json", AiGenerateSchema, (result, context) => {
  if (result.success) return;
  const sourceRequired = result.error.issues.some(
    (issue) => issue.path[0] === "contentMarkdown" && issue.message === "Note content is required.",
  );
  return apiError(
    context,
    sourceRequired ? "ai_source_required" : "ai_request_invalid",
    sourceRequired
      ? "Note content is required for this AI action."
      : "The AI request is invalid.",
    400,
  );
});

const encryptionConfigured = (context: AppContext) =>
  Boolean(resolvePrimaryAiCredentialEncryptionKey(context.env));

const readSettings = (context: AppContext, dependencies: AiRouteDependencies) => getAiSettings(
  context.env.storage.db,
  getWorkspaceId(context),
  encryptionConfigured(context),
  dependencies.isDemoMode(context.env),
  context.req.query("locale"),
);

const denyMutation = (context: AppContext, dependencies: AiRouteDependencies) => {
  const denied = requireUser(context);
  if (denied) return denied;
  if (dependencies.isDemoMode(context.env)) {
    return forbidden(context, "AI settings cannot be changed in demo mode.");
  }
  return null;
};

const requireEncryptionKey = (context: AppContext) => {
  const key = resolvePrimaryAiCredentialEncryptionKey(context.env);
  if (!key) {
    throw new AppError(
      "ai_encryption_key_missing",
      "AI credential encryption requires instance authentication or an optional EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY.",
      400,
    );
  }
  return key;
};

const getSavedProviderApiKey = async (context: AppContext, providerConfigId: string) => {
  const row = await getAiProviderConfig(
    context.env.storage.db,
    getWorkspaceId(context),
    providerConfigId,
  );
  if (!row) throw new AppError("ai_provider_not_found", "AI provider not found.", 404);
  return {
    row,
    apiKey: await decryptAiCredential(row.api_key_encrypted, context.env),
  };
};

const withAiError = (context: AppContext, error: unknown, fallbackCode: string) => {
  if (error instanceof AppError) {
    return apiError(context, error.code, error.message, error.status);
  }
  return apiError(context, fallbackCode, providerErrorMessage(error), 400);
};

export const registerAiRoutes = (app: Hono<AppEnv>, dependencies: AiRouteDependencies) => {
  app.get("/api/v1/ai/settings", async (context) => {
    const denied = requireUser(context);
    if (denied) return denied;
    return context.json(await readSettings(context, dependencies));
  });

  app.post(
    "/api/v1/ai/providers",
    zValidator("json", AiProviderConfigCreateSchema),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      try {
        const input = context.req.valid("json");
        const workspaceId = getWorkspaceId(context);
        const providerConfigId = createId("aip");
        const modelConfigId = input.initialModelId ? createId("aim") : null;
        const now = isoNow();
        const statements = [
          context.env.storage.db.prepare(
            `INSERT INTO ai_provider_configs (
               id, workspace_id, provider, display_name, base_url, api_key_encrypted,
               is_enabled, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            providerConfigId,
            workspaceId,
            input.provider,
            input.displayName,
            normalizeAiBaseUrl(input.baseUrl),
            await encryptSecret(input.apiKey, requireEncryptionKey(context)),
            input.isEnabled ? 1 : 0,
            now,
            now,
          ),
        ];
        if (modelConfigId && input.initialModelId) {
          statements.push(context.env.storage.db.prepare(
            `INSERT INTO ai_models (
               id, provider_config_id, model_id, display_name, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          ).bind(
            modelConfigId,
            providerConfigId,
            input.initialModelId,
            input.initialModelId,
            now,
            now,
          ));
          if (input.isEnabled && !(await getDefaultAiModelId(context.env.storage.db, workspaceId))) {
            statements.push(context.env.storage.db.prepare(
              `INSERT INTO ai_workspace_settings (
                 workspace_id, default_model_id, created_at, updated_at
               ) VALUES (?, ?, ?, ?)
               ON CONFLICT(workspace_id) DO UPDATE SET
                 default_model_id = excluded.default_model_id,
                 updated_at = excluded.updated_at`,
            ).bind(workspaceId, modelConfigId, now, now));
          }
        }
        statements.push(auditStatement(
          context.env.storage.db,
          "user",
          context.get("auth").actorId,
          "workspace.ai_provider.create",
          "ai_provider_config",
          providerConfigId,
          { provider: input.provider, initialModelId: input.initialModelId ?? null },
        ));
        await context.env.storage.db.batch(statements);
        return context.json(await readSettings(context, dependencies), 201);
      } catch (error) {
        return withAiError(context, error, "ai_provider_create_failed");
      }
    },
  );

  app.put(
    "/api/v1/ai/providers/:providerConfigId",
    zValidator("json", AiProviderConfigUpdateSchema),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      try {
        const input = context.req.valid("json");
        const providerConfigId = context.req.param("providerConfigId");
        const workspaceId = getWorkspaceId(context);
        const existing = await getAiProviderConfig(
          context.env.storage.db,
          workspaceId,
          providerConfigId,
        );
        if (!existing) return notFound(context, "AI provider not found.");
        const now = isoNow();
        const apiKeyEncrypted = input.apiKey
          ? await encryptSecret(input.apiKey, requireEncryptionKey(context))
          : existing.api_key_encrypted;
        await context.env.storage.db.batch([
          context.env.storage.db.prepare(
            `UPDATE ai_provider_configs SET
               provider = ?, display_name = ?, base_url = ?, api_key_encrypted = ?,
               is_enabled = ?, updated_at = ?
             WHERE id = ? AND workspace_id = ?`,
          ).bind(
            input.provider,
            input.displayName,
            normalizeAiBaseUrl(input.baseUrl),
            apiKeyEncrypted,
            input.isEnabled ? 1 : 0,
            now,
            providerConfigId,
            workspaceId,
          ),
          auditStatement(
            context.env.storage.db,
            "user",
            context.get("auth").actorId,
            "workspace.ai_provider.update",
            "ai_provider_config",
            providerConfigId,
            { provider: input.provider, isEnabled: input.isEnabled },
          ),
        ]);
        return context.json(await readSettings(context, dependencies));
      } catch (error) {
        return withAiError(context, error, "ai_provider_update_failed");
      }
    },
  );

  app.delete("/api/v1/ai/providers/:providerConfigId", async (context) => {
    const denied = denyMutation(context, dependencies);
    if (denied) return denied;
    const providerConfigId = context.req.param("providerConfigId");
    const workspaceId = getWorkspaceId(context);
    const existing = await getAiProviderConfig(
      context.env.storage.db,
      workspaceId,
      providerConfigId,
    );
    if (!existing) return notFound(context, "AI provider not found.");
    await context.env.storage.db.batch([
      context.env.storage.db.prepare(
        `DELETE FROM ai_provider_configs WHERE id = ? AND workspace_id = ?`,
      ).bind(providerConfigId, workspaceId),
      auditStatement(
        context.env.storage.db,
        "user",
        context.get("auth").actorId,
        "workspace.ai_provider.delete",
        "ai_provider_config",
        providerConfigId,
        { provider: existing.provider },
      ),
    ]);
    return context.json(await readSettings(context, dependencies));
  });

  app.post(
    "/api/v1/ai/providers/:providerConfigId/test",
    zValidator("json", AiProviderConnectionTestSchema),
    async (context) => {
      const denied = requireUser(context);
      if (denied) return denied;
      try {
        const input = context.req.valid("json");
        const row = await getAiProviderConfig(
          context.env.storage.db,
          getWorkspaceId(context),
          context.req.param("providerConfigId"),
        );
        if (!row) throw new AppError("ai_provider_not_found", "AI provider not found.", 404);
        const apiKey = input.apiKey ?? await decryptAiCredential(row.api_key_encrypted, context.env);
        const result = await (dependencies.testConnection ?? testAiModel)({
          provider: input.provider ?? row.provider,
          baseUrl: input.baseUrl ? normalizeAiBaseUrl(input.baseUrl) : row.base_url,
          apiKey,
          modelId: input.modelId,
        });
        return context.json({ ok: true, response: result.text.trim() });
      } catch (error) {
        return withAiError(context, error, "ai_connection_failed");
      }
    },
  );

  app.post("/api/v1/ai/providers/:providerConfigId/discover-models", async (context) => {
    const denied = requireUser(context);
    if (denied) return denied;
    try {
      const { row, apiKey } = await getSavedProviderApiKey(
        context,
        context.req.param("providerConfigId"),
      );
      return context.json({
        models: await discoverAiModels({
          provider: row.provider,
          baseUrl: row.base_url,
          apiKey,
        }),
      });
    } catch (error) {
      return withAiError(context, error, "ai_model_discovery_failed");
    }
  });

  app.post(
    "/api/v1/ai/providers/:providerConfigId/models",
    zValidator("json", AiModelConfigCreateSchema),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      const providerConfigId = context.req.param("providerConfigId");
      const workspaceId = getWorkspaceId(context);
      const provider = await getAiProviderConfig(
        context.env.storage.db,
        workspaceId,
        providerConfigId,
      );
      if (!provider) return notFound(context, "AI provider not found.");
      const input = context.req.valid("json");
      const modelConfigId = createId("aim");
      const now = isoNow();
      const statements = [
        context.env.storage.db.prepare(
          `INSERT INTO ai_models (
             id, provider_config_id, model_id, display_name, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          modelConfigId,
          providerConfigId,
          input.modelId,
          input.displayName ?? input.modelId,
          now,
          now,
        ),
      ];
      if (provider.is_enabled && !(await getDefaultAiModelId(context.env.storage.db, workspaceId))) {
        statements.push(context.env.storage.db.prepare(
          `INSERT INTO ai_workspace_settings (
             workspace_id, default_model_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             default_model_id = excluded.default_model_id,
             updated_at = excluded.updated_at`,
        ).bind(workspaceId, modelConfigId, now, now));
      }
      statements.push(auditStatement(
        context.env.storage.db,
        "user",
        context.get("auth").actorId,
        "workspace.ai_model.create",
        "ai_model",
        modelConfigId,
        { providerConfigId, modelId: input.modelId },
      ));
      try {
        await context.env.storage.db.batch(statements);
        return context.json(await readSettings(context, dependencies), 201);
      } catch (error) {
        return withAiError(context, error, "ai_model_create_failed");
      }
    },
  );

  app.delete(
    "/api/v1/ai/providers/:providerConfigId/models/:modelConfigId",
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      const workspaceId = getWorkspaceId(context);
      const providerConfigId = context.req.param("providerConfigId");
      const modelConfigId = context.req.param("modelConfigId");
      const model = await getAiModelConfig(context.env.storage.db, workspaceId, modelConfigId);
      if (!model || model.provider_config_id !== providerConfigId) {
        return notFound(context, "AI model not found.");
      }
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `DELETE FROM ai_models WHERE id = ? AND provider_config_id = ?`,
        ).bind(modelConfigId, providerConfigId),
        auditStatement(
          context.env.storage.db,
          "user",
          context.get("auth").actorId,
          "workspace.ai_model.delete",
          "ai_model",
          modelConfigId,
          { providerConfigId, modelId: model.model_id },
        ),
      ]);
      return context.json(await readSettings(context, dependencies));
    },
  );

  app.put(
    "/api/v1/ai/default-model",
    zValidator("json", AiDefaultModelUpdateSchema),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      const input = context.req.valid("json");
      const workspaceId = getWorkspaceId(context);
      if (input.modelConfigId) {
        const model = await context.env.storage.db.prepare(
          `SELECT models.id
           FROM ai_models AS models
           JOIN ai_provider_configs AS providers ON providers.id = models.provider_config_id
           WHERE models.id = ? AND providers.workspace_id = ? AND providers.is_enabled = 1
           LIMIT 1`,
        ).bind(input.modelConfigId, workspaceId).first<{ id: string }>();
        if (!model) {
          return apiError(
            context,
            "ai_default_model_unavailable",
            "The selected AI model belongs to a disabled or unavailable provider.",
            400,
          );
        }
      }
      const now = isoNow();
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `INSERT INTO ai_workspace_settings (
             workspace_id, default_model_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             default_model_id = excluded.default_model_id,
             updated_at = excluded.updated_at`,
        ).bind(workspaceId, input.modelConfigId, now, now),
        auditStatement(
          context.env.storage.db,
          "user",
          context.get("auth").actorId,
          "workspace.ai_default_model.update",
          "workspace",
          workspaceId,
          { modelConfigId: input.modelConfigId },
        ),
      ]);
      return context.json(await readSettings(context, dependencies));
    },
  );

  app.put(
    "/api/v1/ai/tag-suggestion-prompt",
    zValidator("json", AiTagSuggestionPromptUpdateSchema),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      const input = context.req.valid("json");
      const workspaceId = getWorkspaceId(context);
      const now = isoNow();
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `INSERT INTO ai_workspace_settings (
             workspace_id, tag_suggestion_prompt, created_at, updated_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             tag_suggestion_prompt = excluded.tag_suggestion_prompt,
             updated_at = excluded.updated_at`,
        ).bind(workspaceId, input.prompt, now, now),
        auditStatement(
          context.env.storage.db,
          "user",
          context.get("auth").actorId,
          "workspace.ai_tag_suggestion_prompt.update",
          "workspace",
          workspaceId,
          { customized: input.prompt !== null },
        ),
      ]);
      return context.json(await readSettings(context, dependencies));
    },
  );

  app.post(
    "/api/v1/ai/tag-suggestions",
    zValidator("json", AiTagSuggestionsRequestSchema),
    async (context) => {
      const denied = requireUser(context);
      if (denied) return denied;
      try {
        const input = context.req.valid("json");
        const workspaceId = getWorkspaceId(context);
        const tagSummaries = await listTagSummaries(context.env.storage.db, workspaceId);
        const allCanonicalTags = new Map(
          tagSummaries.map((tag) => [tag.name.toLocaleLowerCase(), tag.name]),
        );
        const popularTags = [...tagSummaries]
          .sort((left, right) => right.memoCount - left.memoCount || left.name.localeCompare(right.name))
          .slice(0, 200)
          .map((tag) => tag.name);
        const existingTags = Array.from(new Set([
          ...input.currentTags.map((tag) => allCanonicalTags.get(tag.toLocaleLowerCase()) ?? tag),
          ...popularTags,
        ]));
        const rawSuggestions = dependencies.suggestTags
          ? await dependencies.suggestTags({ ...input, existingTags })
          : await generateAiTagSuggestions({
            ...input,
            existingTags,
            instruction: await getAiTagSuggestionPrompt(context.env.storage.db, workspaceId, input.locale),
            model: await loadDefaultAiModel(context.env.storage.db, workspaceId, context.env),
            abortSignal: context.req.raw.signal,
          });
        const currentTagKeys = new Set(input.currentTags.map((tag) => tag.toLocaleLowerCase()));
        const suggestionNames = normalizeTags(
          normalizeTags(rawSuggestions)
            .filter((name) => !currentTagKeys.has(name.toLocaleLowerCase()))
            .map((name) => allCanonicalTags.get(name.toLocaleLowerCase()) ?? name),
        ).slice(0, MAX_AI_TAG_SUGGESTIONS);
        const suggestions = suggestionNames
          .map((name) => {
            const canonicalName = allCanonicalTags.get(name.toLocaleLowerCase());
            return { name: canonicalName ?? name, existing: Boolean(canonicalName) };
          });
        return context.json({ suggestions });
      } catch (error) {
        return withAiError(context, error, "ai_tag_suggestions_failed");
      }
    },
  );

  app.post(
    "/api/v1/ai/generate",
    validateAiGeneration,
    async (context) => {
      const denied = requireUser(context);
      if (denied) return denied;
      try {
        const input = context.req.valid("json");
        const workspaceId = getWorkspaceId(context);
        const selectedPrompt = input.promptId
          ? await getAiPromptTemplate(
            context.env.storage.db,
            workspaceId,
            input.promptId,
            input.locale,
          )
          : null;
        if (input.promptId && !selectedPrompt) {
          throw new AppError("ai_prompt_not_found", "The selected prompt no longer exists.", 404);
        }

        const action = selectedPrompt?.action ?? input.action;
        const needsTargetLanguage = selectedPrompt
          ? promptNeedsTargetLanguage(selectedPrompt.parameterKind)
          : action === "translate";
        const needsTone = selectedPrompt
          ? promptNeedsTone(selectedPrompt.parameterKind)
          : action === "change-tone";
        if (needsTargetLanguage && !input.targetLanguage) {
          throw new AppError("ai_target_language_required", "Choose a target language for this prompt.", 400);
        }
        if (needsTone && !input.tone) {
          throw new AppError("ai_tone_required", "Choose a tone for this prompt.", 400);
        }

        const resolvedInstruction = selectedPrompt?.instruction
          || input.instruction?.trim()
          || await resolveWorkspaceActionInstruction(
            context.env.storage.db,
            workspaceId,
            action,
            input.locale,
          )
          || undefined;
        const model = await loadDefaultAiModel(
          context.env.storage.db,
          workspaceId,
          context.env,
        );
        const resultBoundary = createAiGenerationResultBoundary();
        const generationInput = {
          ...input,
          action,
          instruction: resolvedInstruction,
          targetLanguage: needsTargetLanguage ? input.targetLanguage : undefined,
          tone: needsTone ? input.tone : undefined,
          model,
          resultBoundary,
          abortSignal: context.req.raw.signal,
        };
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            send({ type: "start" });
            try {
              if (input.stream) {
                const result = await streamAiGeneration(generationInput);
                const normalizer = createAiGenerationStreamNormalizer(resultBoundary);
                let hasContent = false;
                for await (const part of result.stream) {
                  if (part.type === "error") throw part.error;
                  if (part.type !== "text-delta") continue;
                  const text = normalizer.push(part.text);
                  if (!text) continue;
                  hasContent ||= Boolean(text.trim());
                  send({ type: "text-delta", text });
                }
                const trailingText = normalizer.finish();
                if (trailingText) {
                  hasContent ||= Boolean(trailingText.trim());
                  send({ type: "text-delta", text: trailingText });
                }
                if (!hasContent) throw new Error("The AI did not return a note result.");
                const [usage, finishReason] = await Promise.all([result.usage, result.finishReason]);
                send({
                  type: "finish",
                  finishReason,
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                });
                return;
              }

              const result = await generateAiGeneration(generationInput);
              const contentMarkdown = normalizeAiGenerationText(result.text, resultBoundary);
              if (!contentMarkdown) throw new Error("The AI did not return a note result.");
              send({ type: "text-delta", text: contentMarkdown });
              send({
                type: "finish",
                finishReason: result.finishReason,
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
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
        return withAiError(context, error, "ai_generation_failed");
      }
    },
  );
};
