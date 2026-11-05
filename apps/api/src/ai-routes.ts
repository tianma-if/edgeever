const OLD_AI_GENERATION_PATHS = ["/api/v1/ai/generate", "/api/v1/ai/infographic-agent", "/api/v1/ai/providers/:providerConfigId/discover-models", "/api/v1/ai/providers/:providerConfigId/test", "/api/v1/ai/tag-suggestions", "/api/v1/ai/video-outline"];
import {
  AiDefaultModelUpdateSchema,
  AiGenerateSchema,
  AiTranscriptionDefaultModelUpdateSchema,
  AiTranscriptionModelCreateSchema,
  AiTranscriptionProviderCreateSchema,
  AiTranscriptionProviderUpdateSchema,
  InfographicAgentRequestSchema,
  AiModelConfigCreateSchema,
  AiModelConfigUpdateSchema,
  AiModelCapabilitiesReportSchema,
  AiProviderConfigCreateSchema,
  AiProviderConfigUpdateSchema,
  AiProviderConnectionTestSchema,
  AiTagSuggestionsRequestSchema,
  buildAiTagSuggestionRequest,
  getDefaultAiTagSuggestionPrompt,
  isAiModelCapabilityStale,
  planAiGenerationOutputBudget,
  resolveAiModelOutputBudget,
  promptNeedsTargetLanguage,
  promptNeedsTone,
  type AiAction,
  type AiAttachmentInput,
  type AiTargetLanguage,
  type AiTone,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Context, Hono } from "hono";
import type { AppContext, AppEnv, Bindings } from "./api-context";
import { AppError } from "./app-error";
import { auditStatement } from "./audit";
import { getAiPromptTemplate, resolveWorkspaceActionInstruction } from "./ai-prompt-service";
import {
  decryptAiCredential,
  getAiModelConfig,
  getAiProviderConfig,
  mapAiModelConfig,
  getAiSettings,
  getDefaultAiModelId,
  getDefaultAiDirectTarget,
  loadDefaultAiModelCredentials,
  normalizeAiBaseUrl,
  resolveDefaultAiModel,
  prepareAiGeneration,
  aiTextAttachmentContents,
  aiTranscriptionDefaultStatement,
  getAiTranscriptionModel,
  getAiTranscriptionProvider,
  getAiTranscriptionSettings,
  getDefaultAiTranscriptionModelId,
  resolvePrimaryAiCredentialEncryptionKey,
} from "./ai-service";
import { createId, isoNow } from "./entity-utils";
import { apiError, forbidden, notFound } from "./http-errors";
import { getWorkspaceId, requireScopes, requireUser } from "./request-auth";
import {
  VIDEO_OUTLINE_MAX_CHARS,
  VIDEO_OUTLINE_SYSTEM_PROMPT,
  VideoOutlineRequestSchema,
  buildVideoOutlineUserPrompt,
  videoOutlineInputChars,
} from "./video-outline";
import { encryptSecret } from "./secret-encryption";
import { listTagSummaries } from "./tag-service";
import { prepareNoteResourceTranscription } from "./resource-transcription";
import { registerAiProviderRelay } from "./ai-provider-relay";

type AiRouteDependencies = {
  isDemoMode: (environment: Bindings) => boolean;
  testConnection?: (config: { provider: string; baseUrl: string; apiKey: string; modelId: string }) => Promise<{ text: string }>;
  suggestTags?: (input: {
    title: string;
    contentMarkdown: string;
    currentTags: string[];
    existingTags: string[];
    locale?: string;
  }) => Promise<string[]>;
  generateVideoOutline?: (input: {
    system: string;
    prompt: string;
    abortSignal?: AbortSignal;
  }) => Promise<string>;
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
  context.env,
);

const readTranscriptionSettings = (context: AppContext, dependencies: AiRouteDependencies) =>
  getAiTranscriptionSettings(
    context.env.storage.db,
    getWorkspaceId(context),
    encryptionConfigured(context),
    dependencies.isDemoMode(context.env),
    context.env,
  );

const invalidTranscriptionSettings = (
  result: { success: boolean },
  context: Context,
) => {
  if (result.success) return;
  return apiError(
    context,
    "ai_transcription_request_invalid",
    "The speech transcription settings are invalid.",
    400,
  );
};

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

const withAiError = (context: AppContext, error: unknown, fallbackCode: string) => {
  if (error instanceof AppError) {
    return apiError(context, error.code, error.message, error.status);
  }
  return apiError(context, fallbackCode, providerErrorMessage(error), 400);
};

const resolveAiGenerateFields = async (context: AppContext, input: {
  action: AiAction;
  promptId?: string;
  locale?: string;
  instruction?: string;
  targetLanguage?: AiTargetLanguage;
  tone?: AiTone;
  contentMarkdown: string;
  attachments?: AiAttachmentInput[];
}) => {
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

  const instruction = selectedPrompt?.instruction
    || input.instruction?.trim()
    || await resolveWorkspaceActionInstruction(
      context.env.storage.db,
      workspaceId,
      action,
      input.locale,
    )
    || undefined;

  return {
    action,
    instruction,
    targetLanguage: needsTargetLanguage ? input.targetLanguage : undefined,
    tone: needsTone ? input.tone : undefined,
    contentMarkdown: input.contentMarkdown,
    attachments: input.attachments,
  };
};

export const registerAiRoutes = (app: Hono<AppEnv>, dependencies: AiRouteDependencies) => {
  registerAiProviderRelay(app);
  app.get("/api/v1/ai/settings", async (context) => {
    const denied = requireUser(context);
    if (denied) return denied;
    return context.json(await readSettings(context, dependencies));
  });

  app.get("/api/v1/ai/transcription-settings", async (context) => {
    const denied = requireUser(context);
    if (denied) return denied;
    return context.json(await readTranscriptionSettings(context, dependencies));
  });

  app.post("/api/v1/memos/:memoId/resources/:resourceId/transcription-target", async (context) => {
    const denied = requireUser(context);
    if (denied) return denied;
    if (dependencies.isDemoMode(context.env)) {
      return forbidden(context, "Speech transcription is unavailable in demo mode.");
    }
    try {
      const target = await prepareNoteResourceTranscription(
        context.env,
        getWorkspaceId(context),
        context.req.param("memoId"),
        context.req.param("resourceId"),
      );
      context.header("Cache-Control", "no-store");
      return context.json(target);
    } catch (error) {
      return withAiError(context, error, "ai_transcription_failed");
    }
  });

  app.post("/api/v1/ai/transcription-providers/:providerId/direct-credential", async (context) => {
    const denied = requireUser(context);
    if (denied) return denied;
    if (dependencies.isDemoMode(context.env)) {
      return forbidden(context, "Speech transcription is unavailable in demo mode.");
    }
    try {
      const provider = await getAiTranscriptionProvider(
        context.env.storage.db,
        getWorkspaceId(context),
        context.req.param("providerId"),
      );
      if (!provider) return notFound(context, "Speech service not found.");
      const apiKey = await decryptAiCredential(provider.api_key_encrypted, context.env);
      context.header("Cache-Control", "no-store");
      return context.json({ apiKey });
    } catch (error) {
      return withAiError(context, error, "ai_transcription_failed");
    }
  });

  app.post(
    "/api/v1/ai/transcription-providers",
    zValidator("json", AiTranscriptionProviderCreateSchema, invalidTranscriptionSettings),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      try {
        const input = context.req.valid("json");
        const workspaceId = getWorkspaceId(context);
        const providerId = createId("atp");
        const modelConfigId = input.initialModelId ? createId("atm") : null;
        const now = isoNow();
        const statements = [
          context.env.storage.db.prepare(
            `INSERT INTO ai_transcription_providers (
               id, workspace_id, provider, display_name, base_url, api_key_encrypted,
               is_enabled, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            providerId,
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
            `INSERT INTO ai_transcription_models (
               id, provider_id, model_id, display_name, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          ).bind(
            modelConfigId,
            providerId,
            input.initialModelId,
            input.initialModelId.slice(0, 80),
            now,
            now,
          ));
          if (input.isEnabled && !(await getDefaultAiTranscriptionModelId(context.env.storage.db, workspaceId))) {
            statements.push(aiTranscriptionDefaultStatement(
              context.env.storage.db,
              workspaceId,
              modelConfigId,
              now,
            ));
          }
        }
        statements.push(auditStatement(
          context.env.storage.db,
          "user",
          context.get("auth").actorId,
          "workspace.ai_transcription_provider.create",
          "ai_transcription_provider",
          providerId,
          { isEnabled: input.isEnabled, provider: input.provider, modelId: input.initialModelId ?? null },
        ));
        await context.env.storage.db.batch(statements);
        return context.json(await readTranscriptionSettings(context, dependencies), 201);
      } catch (error) {
        return withAiError(context, error, "ai_transcription_provider_create_failed");
      }
    },
  );

  app.put(
    "/api/v1/ai/transcription-providers/:providerId",
    zValidator("json", AiTranscriptionProviderUpdateSchema, invalidTranscriptionSettings),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      try {
        const input = context.req.valid("json");
        const providerId = context.req.param("providerId");
        const workspaceId = getWorkspaceId(context);
        const existing = await getAiTranscriptionProvider(context.env.storage.db, workspaceId, providerId);
        if (!existing) return notFound(context, "Speech service not found.");
        const now = isoNow();
        const apiKeyEncrypted = input.apiKey
          ? await encryptSecret(input.apiKey, requireEncryptionKey(context))
          : existing.api_key_encrypted;
        await context.env.storage.db.batch([
          context.env.storage.db.prepare(
            `UPDATE ai_transcription_providers SET
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
            providerId,
            workspaceId,
          ),
          auditStatement(
            context.env.storage.db,
            "user",
            context.get("auth").actorId,
            "workspace.ai_transcription_provider.update",
            "ai_transcription_provider",
            providerId,
            { isEnabled: input.isEnabled, provider: input.provider, apiKeyUpdated: Boolean(input.apiKey) },
          ),
        ]);
        return context.json(await readTranscriptionSettings(context, dependencies));
      } catch (error) {
        return withAiError(context, error, "ai_transcription_provider_update_failed");
      }
    },
  );

  app.delete("/api/v1/ai/transcription-providers/:providerId", async (context) => {
    const denied = denyMutation(context, dependencies);
    if (denied) return denied;
    const providerId = context.req.param("providerId");
    const workspaceId = getWorkspaceId(context);
    const existing = await getAiTranscriptionProvider(context.env.storage.db, workspaceId, providerId);
    if (!existing) return notFound(context, "Speech service not found.");
    await context.env.storage.db.batch([
      context.env.storage.db.prepare(
        `DELETE FROM ai_transcription_providers WHERE id = ? AND workspace_id = ?`,
      ).bind(providerId, workspaceId),
      auditStatement(
        context.env.storage.db,
        "user",
        context.get("auth").actorId,
        "workspace.ai_transcription_provider.delete",
        "ai_transcription_provider",
        providerId,
        {},
      ),
    ]);
    return context.json(await readTranscriptionSettings(context, dependencies));
  });

  app.post(
    "/api/v1/ai/transcription-providers/:providerId/models",
    zValidator("json", AiTranscriptionModelCreateSchema, invalidTranscriptionSettings),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      const providerId = context.req.param("providerId");
      const workspaceId = getWorkspaceId(context);
      const provider = await getAiTranscriptionProvider(context.env.storage.db, workspaceId, providerId);
      if (!provider) return notFound(context, "Speech service not found.");
      const input = context.req.valid("json");
      const modelConfigId = createId("atm");
      const now = isoNow();
      const statements = [
        context.env.storage.db.prepare(
          `INSERT INTO ai_transcription_models (
             id, provider_id, model_id, display_name, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          modelConfigId,
          providerId,
          input.modelId,
          input.displayName ?? input.modelId.slice(0, 80),
          now,
          now,
        ),
      ];
      if (provider.is_enabled && !(await getDefaultAiTranscriptionModelId(context.env.storage.db, workspaceId))) {
        statements.push(aiTranscriptionDefaultStatement(
          context.env.storage.db,
          workspaceId,
          modelConfigId,
          now,
        ));
      }
      statements.push(auditStatement(
        context.env.storage.db,
        "user",
        context.get("auth").actorId,
        "workspace.ai_transcription_model.create",
        "ai_transcription_model",
        modelConfigId,
        { providerId, modelId: input.modelId },
      ));
      try {
        await context.env.storage.db.batch(statements);
        return context.json(await readTranscriptionSettings(context, dependencies), 201);
      } catch (error) {
        return withAiError(context, error, "ai_transcription_model_create_failed");
      }
    },
  );

  app.delete(
    "/api/v1/ai/transcription-providers/:providerId/models/:modelConfigId",
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      const workspaceId = getWorkspaceId(context);
      const providerId = context.req.param("providerId");
      const modelConfigId = context.req.param("modelConfigId");
      const model = await getAiTranscriptionModel(context.env.storage.db, workspaceId, modelConfigId);
      if (!model || model.provider_id !== providerId) {
        return notFound(context, "Speech model not found.");
      }
      await context.env.storage.db.batch([
        context.env.storage.db.prepare(
          `DELETE FROM ai_transcription_models WHERE id = ? AND provider_id = ?`,
        ).bind(modelConfigId, providerId),
        auditStatement(
          context.env.storage.db,
          "user",
          context.get("auth").actorId,
          "workspace.ai_transcription_model.delete",
          "ai_transcription_model",
          modelConfigId,
          { providerId, modelId: model.model_id },
        ),
      ]);
      return context.json(await readTranscriptionSettings(context, dependencies));
    },
  );

  app.put(
    "/api/v1/ai/transcription-default-model",
    zValidator("json", AiTranscriptionDefaultModelUpdateSchema, invalidTranscriptionSettings),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      const input = context.req.valid("json");
      const workspaceId = getWorkspaceId(context);
      if (input.modelConfigId) {
        const model = await context.env.storage.db.prepare(
          `SELECT models.id
           FROM ai_transcription_models AS models
           JOIN ai_transcription_providers AS providers ON providers.id = models.provider_id
           WHERE models.id = ? AND providers.workspace_id = ? AND providers.is_enabled = 1
           LIMIT 1`,
        ).bind(input.modelConfigId, workspaceId).first<{ id: string }>();
        if (!model) {
          return apiError(
            context,
            "ai_transcription_default_unavailable",
            "The selected speech model belongs to a disabled or missing service.",
            400,
          );
        }
      }
      const now = isoNow();
      await context.env.storage.db.batch([
        aiTranscriptionDefaultStatement(context.env.storage.db, workspaceId, input.modelConfigId, now),
        auditStatement(
          context.env.storage.db,
          "user",
          context.get("auth").actorId,
          "workspace.ai_transcription_default.update",
          "workspace",
          workspaceId,
          { modelConfigId: input.modelConfigId },
        ),
      ]);
      return context.json(await readTranscriptionSettings(context, dependencies));
    },
  );

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
        // Detected limits describe one endpoint; a different service or URL must detect again.
        const endpointChanged = existing.provider !== input.provider
          || normalizeAiBaseUrl(existing.base_url) !== normalizeAiBaseUrl(input.baseUrl);
        await context.env.storage.db.batch([
          ...(endpointChanged ? [context.env.storage.db.prepare(
            `UPDATE ai_models SET detected_max_output_tokens = NULL, detected_max_input_tokens = NULL,
               detected_context_window_tokens = NULL, detected_capability_source = NULL, detected_at = NULL
             WHERE provider_config_id = ?`,
          ).bind(providerConfigId)] : []),
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
             id, provider_config_id, model_id, display_name,
             generation_max_output_tokens, tag_suggestion_max_output_tokens, companion_max_output_tokens,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          modelConfigId,
          providerConfigId,
          input.modelId,
          input.displayName ?? input.modelId,
          input.generationMaxOutputTokens ?? null,
          input.tagSuggestionMaxOutputTokens ?? null,
          input.companionMaxOutputTokens ?? null,
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

  app.patch(
    "/api/v1/ai/providers/:providerConfigId/models/:modelConfigId",
    zValidator("json", AiModelConfigUpdateSchema, (result, context) => {
      if (result.success) return;
      return apiError(context, "ai_model_update_invalid", "The AI model settings are invalid.", 400);
    }),
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
      const input = context.req.valid("json");
      // Only fields present in the request change; omitted fields keep their stored value.
      const columns = [
        ["generation_max_output_tokens", input.generationMaxOutputTokens],
        ["tag_suggestion_max_output_tokens", input.tagSuggestionMaxOutputTokens],
        ["companion_max_output_tokens", input.companionMaxOutputTokens],
      ] as const;
      const changed = columns.filter(([, value]) => value !== undefined);
      const now = isoNow();
      try {
        await context.env.storage.db.batch([
          context.env.storage.db.prepare(
            `UPDATE ai_models
             SET ${changed.map(([column]) => `${column} = ?`).join(", ")}, updated_at = ?
             WHERE id = ? AND provider_config_id IN (
               SELECT id FROM ai_provider_configs WHERE id = ? AND workspace_id = ?
             )`,
          ).bind(...changed.map(([, value]) => value ?? null), now, modelConfigId, providerConfigId, workspaceId),
          auditStatement(
            context.env.storage.db,
            "user",
            context.get("auth").actorId,
            "workspace.ai_model.update",
            "ai_model",
            modelConfigId,
            { providerConfigId, modelId: model.model_id, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) },
          ),
        ]);
        return context.json(await readSettings(context, dependencies));
      } catch (error) {
        return withAiError(context, error, "ai_model_update_failed");
      }
    },
  );

  app.put(
    "/api/v1/ai/providers/:providerConfigId/models/:modelConfigId/capabilities",
    zValidator("json", AiModelCapabilitiesReportSchema, (result, context) => {
      if (result.success) return;
      return apiError(context, "ai_model_capabilities_invalid", "The detected model limits are invalid.", 400);
    }),
    async (context) => {
      const denied = denyMutation(context, dependencies);
      if (denied) return denied;
      const workspaceId = getWorkspaceId(context);
      const providerConfigId = context.req.param("providerConfigId");
      const modelConfigId = context.req.param("modelConfigId");
      const [model, provider] = await Promise.all([
        getAiModelConfig(context.env.storage.db, workspaceId, modelConfigId),
        getAiProviderConfig(context.env.storage.db, workspaceId, providerConfigId),
      ]);
      if (!model || !provider || model.provider_config_id !== providerConfigId) {
        return notFound(context, "AI model not found.");
      }
      const input = context.req.valid("json");
      const changed = () => apiError(context, "ai_model_changed", "The model or service changed while its limits were being detected.", 409);
      if (input.source === "provider-error" && !input.maxOutputTokens) {
        return apiError(context, "ai_model_capabilities_invalid", "The detected model limits are invalid.", 400);
      }
      // Only accept limits read from the model and provider configuration that are saved now. The
      // write re-checks them in the same statement, so a configuration change that lands between
      // this read and the write (and clears the detected limits) is never overwritten by a late report.
      if (
        model.model_id !== input.modelId
        || provider.provider !== input.provider
        || normalizeAiBaseUrl(provider.base_url) !== normalizeAiBaseUrl(input.baseUrl)
        || provider.updated_at !== input.configVersion
      ) {
        return changed();
      }
      const detectedAt = isoNow();
      const db = context.env.storage.db;
      const unchangedConfig = `id = ? AND provider_config_id = ? AND model_id = ? AND EXISTS (
             SELECT 1 FROM ai_provider_configs
             WHERE id = ? AND workspace_id = ? AND provider = ? AND base_url = ? AND updated_at = ?
           )`;
      const unchangedBindings = [
        modelConfigId, providerConfigId, input.modelId,
        providerConfigId, workspaceId, input.provider, provider.base_url, input.configVersion,
      ];
      const result = input.source === "provider-error"
        // A provider error only reveals the output limit; keep any window detected earlier.
        ? await db.prepare(
          `UPDATE ai_models SET detected_max_output_tokens = ?,
             detected_capability_source = CASE
               WHEN detected_capability_source IS NULL OR detected_capability_source = 'none' THEN 'provider-error'
               ELSE detected_capability_source END,
             detected_at = ?
           WHERE ${unchangedConfig}`,
        ).bind(input.maxOutputTokens, detectedAt, ...unchangedBindings).run()
        : await db.prepare(
          `UPDATE ai_models SET detected_max_output_tokens = ?, detected_max_input_tokens = ?,
             detected_context_window_tokens = ?, detected_capability_source = ?, detected_at = ?
           WHERE ${unchangedConfig}`,
        ).bind(
          input.maxOutputTokens,
          input.maxInputTokens,
          input.contextWindowTokens,
          input.source,
          detectedAt,
          ...unchangedBindings,
        ).run();
      if (Number(result.meta.changes) !== 1) return changed();
      const saved = await getAiModelConfig(db, workspaceId, modelConfigId);
      return context.json({ detectedCapabilities: saved ? mapAiModelConfig(saved).detectedCapabilities : null });
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

  app.post(
    "/api/v1/ai/tag-suggestions/prepare",
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
        const { credentials, outputBudgets } = await resolveDefaultAiModel(
          context.env.storage.db,
          workspaceId,
          context.env,
        );
        const fields = buildAiTagSuggestionRequest({
          ...input,
          existingTags,
          instruction: getDefaultAiTagSuggestionPrompt(input.locale),
          maxOutputTokens: resolveAiModelOutputBudget(outputBudgets, "tagSuggestionMaxOutputTokens"),
        });
        return context.json({
          ...credentials,
          ...fields,
          currentTags: input.currentTags,
          canonicalTags: Object.fromEntries(allCanonicalTags),
        });
      } catch (error) {
        return withAiError(context, error, "ai_tag_suggestions_failed");
      }
    },
  );

  app.get(
    "/api/v1/ai/direct-target",
    async (context) => {
      const denied = requireUser(context);
      if (denied) return denied;
      try {
        return context.json(await getDefaultAiDirectTarget(
          context.env.storage.db,
          getWorkspaceId(context),
          context.env,
        ));
      } catch (error) {
        return withAiError(context, error, "ai_generation_failed");
      }
    },
  );

  app.post(
    "/api/v1/ai/generate/prepare",
    validateAiGeneration,
    async (context) => {
      const denied = requireUser(context);
      if (denied) return denied;
      try {
        const input = context.req.valid("json");
        const fields = await resolveAiGenerateFields(context, input);
        const model = await resolveDefaultAiModel(
          context.env.storage.db,
          getWorkspaceId(context),
          context.env,
        );
        const prepared = prepareAiGeneration({ ...fields, credentials: model.credentials });
        // Credentials, manual budget and detected limits all come from the same default-model row.
        const plan = planAiGenerationOutputBudget({
          provider: model.credentials.provider,
          action: fields.action,
          manualMaxOutputTokens: model.outputBudgets.generationMaxOutputTokens,
          capabilities: model.capabilities,
          inputText: [prepared.system, prepared.prompt, ...aiTextAttachmentContents(fields.attachments)].join("\n\n"),
          sourceText: fields.contentMarkdown,
          allowUnbounded: input.allowUnboundedOutput === true,
        });
        if (plan.mode === "auto" && plan.inputFits === false) {
          // The note does not fit the model's input limit or leaves no room in its window, so the
          // provider would reject the request; say so instead of sending it. A manual budget skips
          // this estimate-based check.
          return apiError(
            context,
            "ai_input_too_long",
            "This note is too long for the selected model's context window. Shorten the note or choose a model with a larger window.",
            413,
          );
        }
        return context.json({
          ...prepared,
          maxOutputTokens: plan.maxOutputTokens,
          outputBudget: { mode: plan.mode, outputLimit: plan.outputLimit, inputFits: plan.inputFits },
          // Always say where to report, so a limit learned from a provider error can correct a
          // cached value; only ask the client to read the provider when the cache is missing or stale.
          capabilityTarget: {
            providerConfigId: model.providerConfigId,
            modelConfigId: model.modelConfigId,
            configVersion: model.providerConfigVersion,
          },
          detectCapabilities: isAiModelCapabilityStale(model.capabilities),
        });
      } catch (error) {
        return withAiError(context, error, "ai_generation_failed");
      }
    },
  );


  app.post("/api/v1/ai/providers/:providerConfigId/direct-credential", async context => {
    const denied = requireUser(context); if (denied) return denied;
    try {
      const raw = await context.req.json();
      const input = AiProviderConnectionTestSchema.partial().parse(raw);
      const row = await getAiProviderConfig(context.env.storage.db, getWorkspaceId(context), context.req.param("providerConfigId"));
      if (!row) return notFound(context, "AI provider not found.");
      return context.json({ provider: input.provider ?? row.provider,
        baseUrl: input.baseUrl ? normalizeAiBaseUrl(input.baseUrl) : row.base_url,
        apiKey: input.apiKey ?? await decryptAiCredential(row.api_key_encrypted, context.env), modelId: input.modelId ?? "",
        // Lets a client report detected limits against the configuration it read them for (#652).
        configVersion: row.updated_at });
    } catch (error) { return withAiError(context, error, "ai_credential_failed"); }
  });
  app.post("/api/v1/ai/infographic-agent/prepare", zValidator("json", InfographicAgentRequestSchema), async context => {
    const denied = requireUser(context); if (denied) return denied;
    try { return context.json(await loadDefaultAiModelCredentials(context.env.storage.db, getWorkspaceId(context), context.env)); }
    catch (error) { return withAiError(context, error, "ai_generation_failed"); }
  });
  app.post("/api/v1/ai/video-outline/prepare", zValidator("json", VideoOutlineRequestSchema), async context => {
    const denied = requireScopes(context, "ai:generate"); if (denied) return denied;
    const input = context.req.valid("json");
    if (videoOutlineInputChars(input) > VIDEO_OUTLINE_MAX_CHARS) return apiError(context, "video_outline_too_long", "This transcript is too long to summarize.", 413);
    try { return context.json({ ...await loadDefaultAiModelCredentials(context.env.storage.db, getWorkspaceId(context), context.env),
      system: VIDEO_OUTLINE_SYSTEM_PROMPT, prompt: buildVideoOutlineUserPrompt(input), maxOutputTokens: 1200 }); }
    catch (error) { return withAiError(context, error, "ai_generation_failed"); }
  });
  for (const path of OLD_AI_GENERATION_PATHS) app.post(path, context => {
    const denied = requireScopes(context, "ai:generate"); if (denied) return denied;
    return apiError(context, "ai_client_required", "Update the client to use prepared AI requests.", 410);
  });
};
