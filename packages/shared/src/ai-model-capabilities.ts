import { AI_GENERATION_MAX_OUTPUT_TOKENS } from "./ai-generation";
import type { AiProvider } from "./types";

/**
 * Where a model's limits came from. Each source maps provider fields to one of two shapes:
 * - a shared context window (input + output must fit together), or
 * - independent input and output limits.
 * Anthropic, DeepSeek and OpenRouter document a shared window; Gemini and LiteLLM report
 * independent limits.
 */
export const AI_MODEL_CAPABILITY_SOURCES = [
  "anthropic-models",
  "gemini-models",
  "openrouter-models",
  "deepseek-models",
  "litellm-model-info",
  "provider-error",
  "none",
] as const;

export type AiModelCapabilitySource = (typeof AI_MODEL_CAPABILITY_SOURCES)[number];

export type AiModelCapabilityLimits = {
  /** Largest accepted `max_tokens` / `maxOutputTokens` for one response. */
  maxOutputTokens: number | null;
  /** Independent input limit; it never reduces the output budget. */
  maxInputTokens: number | null;
  /** Shared window that input and output must fit into together. */
  contextWindowTokens: number | null;
  source: AiModelCapabilitySource;
};

export type AiModelCapabilities = AiModelCapabilityLimits & { detectedAt: string };

/** Limits are re-detected after this long, or when the model or endpoint changes. */
export const AI_MODEL_CAPABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const AI_MODEL_CAPABILITY_MAX_TOKENS = 100_000_000;

export const isAiModelCapabilityStale = (capabilities: AiModelCapabilities | null | undefined, now = Date.now()) => {
  if (!capabilities) return true;
  const detectedAt = Date.parse(capabilities.detectedAt);
  return !Number.isFinite(detectedAt) || now - detectedAt > AI_MODEL_CAPABILITY_TTL_MS;
};

export const hasAiModelCapabilityLimits = (limits: AiModelCapabilityLimits | null | undefined) =>
  Boolean(limits && (limits.maxOutputTokens || limits.maxInputTokens || limits.contextWindowTokens));

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const positiveTokens = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= AI_MODEL_CAPABILITY_MAX_TOKENS ? value : null;

const listOf = (body: Record<string, unknown> | null, key: string) =>
  Array.isArray(body?.[key]) ? (body[key] as unknown[]).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : [];

const none: AiModelCapabilityLimits = { maxOutputTokens: null, maxInputTokens: null, contextWindowTokens: null, source: "none" };

/** Anthropic `GET /v1/models/{id}` or `GET /v1/models`: `max_tokens` and the shared `max_input_tokens` window. */
const parseAnthropic = (body: Record<string, unknown> | null, modelId: string): AiModelCapabilityLimits | null => {
  const model = body && "max_tokens" in body ? body : listOf(body, "data").find((item) => item.id === modelId);
  if (!model) return null;
  const limits: AiModelCapabilityLimits = {
    maxOutputTokens: positiveTokens(model.max_tokens),
    maxInputTokens: null,
    contextWindowTokens: positiveTokens(model.max_input_tokens),
    source: "anthropic-models",
  };
  return hasAiModelCapabilityLimits(limits) ? limits : null;
};

/** Gemini `models.get` / `models.list`: independent `inputTokenLimit` and `outputTokenLimit`. */
const parseGemini = (body: Record<string, unknown> | null, modelId: string): AiModelCapabilityLimits | null => {
  const bare = modelId.replace(/^models\//, "");
  const matches = (item: Record<string, unknown>) => item.name === `models/${bare}` || item.name === bare || item.baseModelId === bare;
  const model = body && ("outputTokenLimit" in body || "inputTokenLimit" in body) ? body : listOf(body, "models").find(matches);
  if (!model) return null;
  const limits: AiModelCapabilityLimits = {
    maxOutputTokens: positiveTokens(model.outputTokenLimit),
    maxInputTokens: positiveTokens(model.inputTokenLimit),
    contextWindowTokens: null,
    source: "gemini-models",
  };
  return hasAiModelCapabilityLimits(limits) ? limits : null;
};

/** OpenAI-compatible `GET /models`: OpenRouter and DeepSeek extend the model objects with limits. */
const parseOpenAiCompatibleList = (body: Record<string, unknown> | null, modelId: string): AiModelCapabilityLimits | null => {
  const model = listOf(body, "data").find((item) => item.id === modelId);
  if (!model) return null;
  const topProvider = asRecord(model.top_provider);
  if (topProvider || "context_length" in model) {
    const limits: AiModelCapabilityLimits = {
      maxOutputTokens: positiveTokens(topProvider?.max_completion_tokens),
      maxInputTokens: null,
      contextWindowTokens: positiveTokens(topProvider?.context_length) ?? positiveTokens(model.context_length),
      source: "openrouter-models",
    };
    return hasAiModelCapabilityLimits(limits) ? limits : null;
  }
  if ("max_output_tokens" in model || "context_window" in model) {
    const limits: AiModelCapabilityLimits = {
      maxOutputTokens: positiveTokens(model.max_output_tokens),
      maxInputTokens: null,
      contextWindowTokens: positiveTokens(model.context_window),
      source: "deepseek-models",
    };
    return hasAiModelCapabilityLimits(limits) ? limits : null;
  }
  return null;
};

/** LiteLLM proxy `GET /model/info`: independent `max_input_tokens` and `max_output_tokens`. */
const parseLiteLlmModelInfo = (body: Record<string, unknown> | null, modelId: string): AiModelCapabilityLimits | null => {
  const model = listOf(body, "data").find((item) => item.model_name === modelId);
  const info = asRecord(model?.model_info);
  if (!info) return null;
  const limits: AiModelCapabilityLimits = {
    maxOutputTokens: positiveTokens(info.max_output_tokens),
    maxInputTokens: positiveTokens(info.max_input_tokens),
    contextWindowTokens: null,
    source: "litellm-model-info",
  };
  return hasAiModelCapabilityLimits(limits) ? limits : null;
};

export type AiModelMetadataEndpoint = "model" | "models" | "litellm-model-info";

/** Read limits from one metadata response; `null` when the response has nothing usable. */
export const parseAiModelCapabilityLimits = (input: {
  provider: AiProvider;
  modelId: string;
  endpoint: AiModelMetadataEndpoint;
  body: unknown;
}): AiModelCapabilityLimits | null => {
  const body = asRecord(input.body);
  if (input.provider === "anthropic") return parseAnthropic(body, input.modelId);
  if (input.provider === "google") return parseGemini(body, input.modelId);
  if (input.endpoint === "litellm-model-info") return parseLiteLlmModelInfo(body, input.modelId);
  return parseOpenAiCompatibleList(body, input.modelId);
};

export const AI_MODEL_CAPABILITY_NONE = none;

/**
 * Best-effort: read the accepted output limit from a provider's "too many output tokens" error.
 * None of these messages are formally documented, so an unrecognised message returns `null`.
 */
export const parseAiOutputLimitFromError = (message: string): number | null => {
  const patterns: Array<[RegExp, (value: number) => number]> = [
    // Anthropic: "max_tokens: 128001 > 64000, which is the maximum allowed ..."
    [/max_tokens:\s*\d+\s*>\s*(\d+)/i, (value) => value],
    // OpenAI: "This model supports at most 4096 completion tokens"
    [/supports at most\s+(\d+)\s+completion tokens/i, (value) => value],
    // Gemini: "... supported range is from 1 (inclusive) to 65537 (exclusive)"
    [/supported range is from\s+\d+\s+\(inclusive\)\s+to\s+(\d+)\s+\(exclusive\)/i, (value) => value - 1],
    // Generic: "max_tokens must be less than or equal to 8192" / "<= 8192"
    [/max(?:imum)?[_ ](?:completion[_ ]|output[_ ])?tokens?[^0-9]{0,40}(?:<=|less than or equal to|at most)\s*(\d+)/i, (value) => value],
  ];
  for (const [pattern, adjust] of patterns) {
    const match = pattern.exec(message);
    const value = match ? positiveTokens(adjust(Number(match[1]))) : null;
    if (value) return value;
  }
  return null;
};

const TRUNCATED_FINISH_REASONS = new Set([
  "length", // OpenAI-compatible, DeepSeek, OpenRouter
  "max_tokens", // Anthropic
  "model_context_window_exceeded", // Anthropic (window reached)
  "MAX_TOKENS", // Gemini
  "max_output_tokens", // OpenAI Responses
]);

/** True when the provider stopped because it ran out of output or context space. */
export const isAiTruncatedFinishReason = (reason: string | null | undefined) =>
  Boolean(reason && TRUNCATED_FINISH_REASONS.has(reason));

const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g;

/** Conservative token estimate without a tokenizer: 1 per CJK character, ~3 characters per token otherwise, +10%. */
export const estimateAiTokens = (text: string) => {
  if (!text) return 0;
  const cjk = text.match(CJK_PATTERN)?.length ?? 0;
  // Round first so float noise (e.g. 110.00000000000001) does not add a token.
  return Math.ceil(Math.round((cjk + (text.length - cjk) / 3) * 1.1 * 1000) / 1000);
};

/** Tasks whose output is about as long as the source; their budget scales with the input. */
const SOURCE_SIZED_ACTIONS = new Set([
  "translate",
  "rewrite-proofread",
  "fix-spelling-grammar",
  "improve-writing",
  "simplify-language",
  "change-tone",
  "make-shorter",
]);

export type AiOutputBudgetMode = "manual" | "auto" | "auto-unbounded" | "fallback";

export type AiOutputBudgetPlan = {
  /** `null` means "do not send a limit"; only produced for clients that support it. */
  maxOutputTokens: number | null;
  mode: AiOutputBudgetMode;
  /** The provider's output limit for this request after the context window, when known. */
  outputLimit: number | null;
  inputTokens: number;
  /** Whether the estimated input fits the model's input limit or window; `null` when unknown. */
  inputFits: boolean | null;
};

const CONTEXT_SAFETY_MIN_TOKENS = 1024;
const REASONING_HEADROOM_TOKENS = 4096;

/**
 * Plan the output budget for one body-generation request.
 * - A manual budget always wins.
 * - With known limits, use what the task needs, capped by the output limit and, only for a
 *   shared window, by the space left after the input. The cap is never raised above that space;
 *   when nothing is left, `inputFits` is `false` and the request must not be sent.
 * - Without limits, clients that can omit the limit send none; others keep the old default.
 */
export const planAiGenerationOutputBudget = (input: {
  provider: AiProvider;
  action: string;
  manualMaxOutputTokens: number | null | undefined;
  capabilities: AiModelCapabilityLimits | null | undefined;
  inputText: string;
  sourceText: string;
  allowUnbounded: boolean;
}): AiOutputBudgetPlan => {
  const inputTokens = estimateAiTokens(input.inputText);
  const caps = input.capabilities && input.capabilities.source !== "none" ? input.capabilities : null;
  const windowRoom = caps?.contextWindowTokens
    ? caps.contextWindowTokens - inputTokens - Math.max(CONTEXT_SAFETY_MIN_TOKENS, Math.ceil(caps.contextWindowTokens * 0.02))
    : null;
  const fitsInputLimit = caps?.maxInputTokens ? inputTokens <= caps.maxInputTokens : null;
  const fitsWindow = windowRoom !== null ? windowRoom > 0 : null;
  const inputFits = fitsInputLimit === false || fitsWindow === false
    ? false
    : fitsInputLimit ?? fitsWindow;
  const limits = [caps?.maxOutputTokens ?? null, windowRoom].filter((value): value is number => value !== null);
  const outputLimit = limits.length ? Math.max(0, Math.min(...limits)) : null;

  if (typeof input.manualMaxOutputTokens === "number") {
    return { maxOutputTokens: input.manualMaxOutputTokens, mode: "manual", outputLimit, inputTokens, inputFits };
  }
  if (outputLimit !== null) {
    if (!SOURCE_SIZED_ACTIONS.has(input.action)) {
      return { maxOutputTokens: outputLimit, mode: "auto", outputLimit, inputTokens, inputFits };
    }
    // Source-sized tasks: about the source length (with room for expansion and reasoning),
    // never below the previous fixed default.
    const need = Math.max(
      AI_GENERATION_MAX_OUTPUT_TOKENS,
      Math.ceil(estimateAiTokens(input.sourceText) * 2.5) + REASONING_HEADROOM_TOKENS,
    );
    return { maxOutputTokens: Math.min(outputLimit, need), mode: "auto", outputLimit, inputTokens, inputFits };
  }
  // Anthropic requires max_tokens, so it always gets a number.
  if (input.allowUnbounded && input.provider !== "anthropic") {
    return { maxOutputTokens: null, mode: "auto-unbounded", outputLimit: null, inputTokens, inputFits };
  }
  return { maxOutputTokens: AI_GENERATION_MAX_OUTPUT_TOKENS, mode: "fallback", outputLimit: null, inputTokens, inputFits };
};
