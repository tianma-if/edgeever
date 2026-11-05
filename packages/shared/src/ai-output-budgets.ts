import { AI_GENERATION_MAX_OUTPUT_TOKENS } from "./ai-generation";

/** Default output budgets used when a model leaves its own budget empty. */
export const AI_TAG_SUGGESTION_MAX_OUTPUT_TOKENS = 300;
export const AI_COMPANION_MAX_OUTPUT_TOKENS = 2048;

export const AI_MODEL_OUTPUT_BUDGET_FIELDS = [
  "generationMaxOutputTokens",
  "tagSuggestionMaxOutputTokens",
  "companionMaxOutputTokens",
] as const;

export type AiModelOutputBudgetField = (typeof AI_MODEL_OUTPUT_BUDGET_FIELDS)[number];

/** `null` means "use the EdgeEver default for this scenario". */
export type AiModelOutputBudgets = Record<AiModelOutputBudgetField, number | null>;

export const AI_MODEL_OUTPUT_BUDGET_DEFAULTS: Record<AiModelOutputBudgetField, number> = {
  generationMaxOutputTokens: AI_GENERATION_MAX_OUTPUT_TOKENS,
  tagSuggestionMaxOutputTokens: AI_TAG_SUGGESTION_MAX_OUTPUT_TOKENS,
  companionMaxOutputTokens: AI_COMPANION_MAX_OUTPUT_TOKENS,
};

/**
 * Accepted input range. These bounds only reject obvious mistakes; they do not
 * describe what a given model or gateway actually supports.
 */
export const AI_MODEL_OUTPUT_BUDGET_LIMITS: Record<AiModelOutputBudgetField, { min: number; max: number }> = {
  generationMaxOutputTokens: { min: 256, max: 131_072 },
  tagSuggestionMaxOutputTokens: { min: 64, max: 8_192 },
  companionMaxOutputTokens: { min: 256, max: 131_072 },
};

export const EMPTY_AI_MODEL_OUTPUT_BUDGETS: AiModelOutputBudgets = {
  generationMaxOutputTokens: null,
  tagSuggestionMaxOutputTokens: null,
  companionMaxOutputTokens: null,
};

/** Resolve one scenario budget, falling back to the default for empty or invalid stored values. */
export const resolveAiModelOutputBudget = (
  budgets: Partial<AiModelOutputBudgets> | null | undefined,
  field: AiModelOutputBudgetField,
) => {
  const configured = budgets?.[field];
  const { min, max } = AI_MODEL_OUTPUT_BUDGET_LIMITS[field];
  return typeof configured === "number" && Number.isInteger(configured) && configured >= min && configured <= max
    ? configured
    : AI_MODEL_OUTPUT_BUDGET_DEFAULTS[field];
};
