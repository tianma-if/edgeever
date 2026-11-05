import { describe, expect, test } from "bun:test";
import {
  AI_MODEL_OUTPUT_BUDGET_DEFAULTS,
  AiModelConfigCreateSchema,
  AiModelConfigUpdateSchema,
  buildAiTagSuggestionRequest,
  resolveAiModelOutputBudget,
} from "./index.ts";

describe("AI model output budgets", () => {
  test("defaults match the previous hard-coded budgets", () => {
    expect(AI_MODEL_OUTPUT_BUDGET_DEFAULTS).toEqual({
      generationMaxOutputTokens: 4096,
      tagSuggestionMaxOutputTokens: 300,
      companionMaxOutputTokens: 2048,
    });
    const tags = buildAiTagSuggestionRequest({
      instruction: "Suggest", title: "", contentMarkdown: "Body", currentTags: [], existingTags: [],
    });
    expect(tags).toMatchObject({ maxOutputTokens: 300, temperature: 0 });
    expect(buildAiTagSuggestionRequest({
      instruction: "Suggest", title: "", contentMarkdown: "Body", currentTags: [], existingTags: [], maxOutputTokens: 900,
    }).maxOutputTokens).toBe(900);
  });

  test("empty or invalid stored values fall back to the scenario default", () => {
    expect(resolveAiModelOutputBudget(null, "generationMaxOutputTokens")).toBe(4096);
    expect(resolveAiModelOutputBudget({ generationMaxOutputTokens: null }, "generationMaxOutputTokens")).toBe(4096);
    expect(resolveAiModelOutputBudget({ generationMaxOutputTokens: 16000 }, "generationMaxOutputTokens")).toBe(16000);
    expect(resolveAiModelOutputBudget({ tagSuggestionMaxOutputTokens: 10 }, "tagSuggestionMaxOutputTokens")).toBe(300);
    expect(resolveAiModelOutputBudget({ companionMaxOutputTokens: 1.5 }, "companionMaxOutputTokens")).toBe(2048);
  });

  test("update schema distinguishes omitted fields from null", () => {
    expect(AiModelConfigUpdateSchema.parse({ generationMaxOutputTokens: null })).toEqual({ generationMaxOutputTokens: null });
    expect(AiModelConfigUpdateSchema.parse({ companionMaxOutputTokens: 8192 })).toEqual({ companionMaxOutputTokens: 8192 });
    expect(AiModelConfigUpdateSchema.safeParse({}).success).toBe(false);
    expect(AiModelConfigUpdateSchema.safeParse({ displayName: "x" }).success).toBe(false);
    expect(AiModelConfigUpdateSchema.safeParse({ generationMaxOutputTokens: 131_073 }).success).toBe(false);
    expect(AiModelConfigCreateSchema.parse({ modelId: "m" })).toEqual({ modelId: "m" });
  });
});
