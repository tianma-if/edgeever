import { describe, expect, test } from "bun:test";
import {
  aiModelOutputBudgetChanges,
  aiModelOutputBudgetDrafts,
  aiModelOutputBudgetSnapshot,
} from "./ai-model-output-budget-form.ts";

const model = (overrides = {}) => ({
  id: "aim_1",
  providerConfigId: "aip_1",
  modelId: "m",
  displayName: "m",
  generationMaxOutputTokens: null,
  tagSuggestionMaxOutputTokens: null,
  companionMaxOutputTokens: null,
  ...overrides,
});

describe("model output budget form (#652)", () => {
  test("a refresh while the dialog is open never turns untouched fields into edits", () => {
    const opening = aiModelOutputBudgetSnapshot(model());
    const drafts = { ...aiModelOutputBudgetDrafts(opening), generationMaxOutputTokens: "16000" };
    // Another device saved tags = 800 meanwhile; the refreshed model is not the baseline.
    const refreshed = model({ tagSuggestionMaxOutputTokens: 800 });
    expect(refreshed.tagSuggestionMaxOutputTokens).toBe(800);
    expect(aiModelOutputBudgetChanges(opening, drafts)).toEqual({
      changes: { generationMaxOutputTokens: 16000 },
      invalid: [],
    });
  });

  test("clearing a field the user saw as set sends null; untouched empty fields are omitted", () => {
    const opening = aiModelOutputBudgetSnapshot(model({ generationMaxOutputTokens: 16000, companionMaxOutputTokens: 9000 }));
    const drafts = { ...aiModelOutputBudgetDrafts(opening), generationMaxOutputTokens: "" };
    expect(aiModelOutputBudgetChanges(opening, drafts).changes).toEqual({ generationMaxOutputTokens: null });
  });

  test("invalid input is reported and never sent", () => {
    const opening = aiModelOutputBudgetSnapshot(model());
    const drafts = { ...aiModelOutputBudgetDrafts(opening), generationMaxOutputTokens: "100", tagSuggestionMaxOutputTokens: "1.5" };
    expect(aiModelOutputBudgetChanges(opening, drafts)).toEqual({
      changes: {},
      invalid: ["generationMaxOutputTokens", "tagSuggestionMaxOutputTokens"],
    });
  });

  test("models from older servers snapshot as defaults", () => {
    const { generationMaxOutputTokens, tagSuggestionMaxOutputTokens, companionMaxOutputTokens, ...legacy } = model();
    expect(aiModelOutputBudgetSnapshot(legacy)).toEqual({
      generationMaxOutputTokens: null, tagSuggestionMaxOutputTokens: null, companionMaxOutputTokens: null,
    });
  });
});
