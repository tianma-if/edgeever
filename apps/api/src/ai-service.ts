import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AiAction, AiModelSettings, AiProvider } from "@edgeever/shared";
import { generateText, streamText } from "ai";
import { AppError } from "./app-error";
import { decryptSecret } from "./secret-encryption";
import type { DatabaseAdapter } from "./storage-contract";

export type AiModelConfigRow = {
  id: string;
  workspace_id: string;
  provider: AiProvider;
  display_name: string;
  base_url: string;
  api_key_encrypted: string;
  model_id: string;
  is_enabled: number;
};

const selectConfigSql = `SELECT id, workspace_id, provider, display_name, base_url,
  api_key_encrypted, model_id, is_enabled FROM ai_model_configs`;

export const resolveCredentialEncryptionKey = (value: string | undefined) => {
  const key = value?.trim();
  return key || undefined;
};

export type AiCredentialEnvironment = {
  EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY?: string;
  EDGE_EVER_STORAGE_ENCRYPTION_KEY?: string;
  EDGE_EVER_AUTH_PASSWORD?: string;
  EDGE_EVER_AUTH_PASSWORD_HASH?: string;
};

const uniqueKeys = (values: Array<string | undefined>) => Array.from(new Set(values.filter(Boolean) as string[]));
const deriveAiCredentialKey = (value: string | undefined) => value
  ? `edgeever:ai-credentials:v1:${value}`
  : undefined;

/**
 * Authentication is already required by a normal EdgeEver deployment, so its
 * stable deployment secret is the zero-configuration credential-encryption
 * root. A dedicated key is an optional advanced override. The legacy storage
 * key remains in the decryption ring for AI credentials saved before v1.15.
 */
export const resolveAiCredentialEncryptionKeys = (environment: AiCredentialEnvironment) => uniqueKeys([
  deriveAiCredentialKey(resolveCredentialEncryptionKey(environment.EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY)),
  deriveAiCredentialKey(resolveCredentialEncryptionKey(environment.EDGE_EVER_AUTH_PASSWORD)),
  deriveAiCredentialKey(resolveCredentialEncryptionKey(environment.EDGE_EVER_AUTH_PASSWORD_HASH)),
  resolveCredentialEncryptionKey(environment.EDGE_EVER_STORAGE_ENCRYPTION_KEY),
]);

export const resolvePrimaryAiCredentialEncryptionKey = (environment: AiCredentialEnvironment) =>
  resolveAiCredentialEncryptionKeys(environment)[0];

export const decryptAiCredential = async (
  encryptedValue: string,
  environment: AiCredentialEnvironment,
) => {
  for (const key of resolveAiCredentialEncryptionKeys(environment)) {
    try {
      return await decryptSecret(encryptedValue, key);
    } catch {
      // Try the next key so credentials encrypted by the legacy OSS key remain usable.
    }
  }
  throw new AppError(
    "ai_credentials_unavailable",
    "The saved AI credential cannot be decrypted. Restore the deployment authentication secret or credential encryption key.",
    503,
  );
};

export const getAiModelConfig = (db: DatabaseAdapter, workspaceId: string) =>
  db.prepare(`${selectConfigSql} WHERE workspace_id = ? LIMIT 1`).bind(workspaceId).first<AiModelConfigRow>();

export const mapAiModelSettings = (
  row: AiModelConfigRow,
  encryptionConfigured: boolean,
): AiModelSettings => ({
  provider: row.provider,
  displayName: row.display_name,
  baseUrl: row.base_url,
  modelId: row.model_id,
  isEnabled: Boolean(row.is_enabled),
  hasApiKey: Boolean(row.api_key_encrypted),
  encryptionConfigured,
});

export const normalizeAiBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

export const createAiModel = (config: {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}) => {
  const baseURL = normalizeAiBaseUrl(config.baseUrl);
  switch (config.provider) {
    case "anthropic":
      return createAnthropic({ baseURL, apiKey: config.apiKey })(config.modelId);
    case "google":
      return createGoogle({ baseURL, apiKey: config.apiKey })(config.modelId);
    default:
      return createOpenAICompatible({
        name: "edgeever-openai-compatible",
        baseURL,
        apiKey: config.apiKey,
        includeUsage: true,
      })(config.modelId);
  }
};

export const loadActiveAiModel = async (
  db: DatabaseAdapter,
  workspaceId: string,
  environment: AiCredentialEnvironment,
) => {
  const row = await getAiModelConfig(db, workspaceId);
  if (!row || !row.is_enabled) {
    throw new AppError("ai_not_configured", "Configure and enable an AI model first.", 409);
  }
  if (!resolvePrimaryAiCredentialEncryptionKey(environment)) {
    throw new AppError(
      "ai_encryption_key_missing",
      "AI credential encryption is unavailable because instance authentication is not configured.",
      503,
    );
  }
  return createAiModel({
    provider: row.provider,
    baseUrl: row.base_url,
    apiKey: await decryptAiCredential(row.api_key_encrypted, environment),
    modelId: row.model_id,
  });
};

export const testAiModel = async (config: {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}) => generateText({
  model: createAiModel(config),
  system: "You are responding to an API connectivity check. Follow the user instruction exactly.",
  prompt: "Reply with only: OK",
  maxOutputTokens: 16,
  abortSignal: AbortSignal.timeout(20_000),
});

export const aiActionInstructions: Record<Exclude<AiAction, "translate">, string> = {
  summarize: "Summarize the note clearly and concisely. Preserve its language. Return Markdown only.",
  "extract-key-points": "Extract the note's most important points as a concise Markdown bullet list. Preserve its language and do not add information that is not present in the note.",
  "extract-todos": "Extract explicit or implied actionable tasks from the note as a Markdown task list using '- [ ]'. Preserve its language and do not invent tasks. If there are no actionable tasks, say so briefly in the note's language.",
  "rewrite-proofread": "Rewrite and proofread the complete note. Correct spelling, grammar, punctuation, clarity, and structure without changing its meaning. Preserve its language and Markdown formatting. Return the complete revised note only.",
};

export const streamAiGeneration = (input: {
  model: ReturnType<typeof createAiModel>;
  action: AiAction;
  title: string;
  contentMarkdown: string;
  targetLanguage?: string;
  abortSignal?: AbortSignal;
}) => streamText({
  model: input.model,
  system: input.action === "translate"
    ? "Translate the complete note into the target language specified by the user. Preserve its meaning, Markdown structure, links, and code blocks. Return only the translated note without commentary."
    : aiActionInstructions[input.action],
  prompt: [
    input.action === "translate" ? `Target language:\n${input.targetLanguage}` : undefined,
    `Note title:\n${input.title || "Untitled"}`,
    `Note content:\n${input.contentMarkdown}`,
  ].filter(Boolean).join("\n\n"),
  maxOutputTokens: 4096,
  abortSignal: input.abortSignal,
});
