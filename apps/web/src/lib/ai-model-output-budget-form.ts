import {
  AI_MODEL_OUTPUT_BUDGET_FIELDS,
  AI_MODEL_OUTPUT_BUDGET_LIMITS,
  type AiModelConfig,
  type AiModelConfigUpdateInput,
  type AiModelOutputBudgetField,
  type AiModelOutputBudgets,
} from "@edgeever/shared";

export type AiModelOutputBudgetDrafts = Record<AiModelOutputBudgetField, string>;

/** Servers older than #652 omit the budget fields, and cannot accept updates. */
export const supportsAiModelOutputBudgets = (model: AiModelConfig) =>
  AI_MODEL_OUTPUT_BUDGET_FIELDS.every((field) => model[field] !== undefined);

export const hasCustomAiModelOutputBudgets = (model: AiModelConfig) =>
  AI_MODEL_OUTPUT_BUDGET_FIELDS.some((field) => typeof model[field] === "number");

/** The saved values when the dialog opened; edits are judged against this, not later refreshes. */
export const aiModelOutputBudgetSnapshot = (model: AiModelConfig): AiModelOutputBudgets => ({
  generationMaxOutputTokens: model.generationMaxOutputTokens ?? null,
  tagSuggestionMaxOutputTokens: model.tagSuggestionMaxOutputTokens ?? null,
  companionMaxOutputTokens: model.companionMaxOutputTokens ?? null,
});

export const aiModelOutputBudgetDrafts = (snapshot: AiModelOutputBudgets): AiModelOutputBudgetDrafts => ({
  generationMaxOutputTokens: snapshot.generationMaxOutputTokens?.toString() ?? "",
  tagSuggestionMaxOutputTokens: snapshot.tagSuggestionMaxOutputTokens?.toString() ?? "",
  companionMaxOutputTokens: snapshot.companionMaxOutputTokens?.toString() ?? "",
});

/** Empty input means "use the default" (`null`); anything else must be an in-range integer. */
export const parseAiModelOutputBudgetDraft = (
  field: AiModelOutputBudgetField,
  draft: string,
): number | null | "invalid" => {
  const trimmed = draft.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const value = Number(trimmed);
  const { min, max } = AI_MODEL_OUTPUT_BUDGET_LIMITS[field];
  return value >= min && value <= max ? value : "invalid";
};

/**
 * Only fields the user actually edited since the dialog opened are sent, so a value
 * another device saved meanwhile is never overwritten by an untouched field.
 */
export const aiModelOutputBudgetChanges = (
  opening: AiModelOutputBudgets,
  drafts: AiModelOutputBudgetDrafts,
) => {
  const changes: AiModelConfigUpdateInput = {};
  const invalid: AiModelOutputBudgetField[] = [];
  for (const field of AI_MODEL_OUTPUT_BUDGET_FIELDS) {
    const next = parseAiModelOutputBudgetDraft(field, drafts[field]);
    if (next === "invalid") invalid.push(field);
    else if (next !== opening[field]) changes[field] = next;
  }
  return { changes, invalid };
};
