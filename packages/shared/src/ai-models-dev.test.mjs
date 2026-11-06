import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildModelsDevIndex,
  mapModelsDevLimit,
  matchModelsDevLimits,
  planAiGenerationOutputBudget,
} from "./index.ts";

// The catalogue excerpt and the cases are shared fixtures so another client can run the same cases.
const fixture = (name) => JSON.parse(readFileSync(new URL(`../test-fixtures/models-dev/${name}`, import.meta.url), "utf8"));
const catalog = fixture("catalog.json");
const cases = fixture("match-cases.json");

describe("models.dev fallback limits (#652)", () => {
  const index = buildModelsDevIndex(catalog);

  test("builds a lookup and skips listings without usable limits", () => {
    expect(index).not.toBeNull();
    expect(index.providers.get("mistral")).toBeUndefined();
    expect(index.hosts.get("api.deepseek.com")).toEqual(["deepseek"]);
    expect(buildModelsDevIndex(null)).toBeNull();
    expect(buildModelsDevIndex([])).toBeNull();
    expect(buildModelsDevIndex({ broken: { models: { m: { limit: { context: 0, output: 0 } } } } })).toBeNull();
  });

  for (const item of cases) {
    test(item.name, () => {
      const result = matchModelsDevLimits(index, { provider: item.provider, baseUrl: item.baseUrl, modelId: item.modelId });
      expect(result).toEqual(item.expected ? { ...item.expected, source: "models-dev" } : null);
    });
  }

  test("maps limit shapes conservatively", () => {
    expect(mapModelsDevLimit({ context: 400000, input: 272000, output: 128000 }))
      .toEqual({ maxOutputTokens: 128000, maxInputTokens: 272000, contextWindowTokens: null, source: "models-dev" });
    expect(mapModelsDevLimit({ context: 200000, output: 64000 }))
      .toEqual({ maxOutputTokens: 64000, maxInputTokens: null, contextWindowTokens: 200000, source: "models-dev" });
    expect(mapModelsDevLimit({ context: 262144, input: 192000, output: 262144 }))
      .toEqual({ maxOutputTokens: 262144, maxInputTokens: 192000, contextWindowTokens: 262144, source: "models-dev" });
    expect(mapModelsDevLimit({ context: -1, output: 1.5 })).toBeNull();
    expect(mapModelsDevLimit({ context: 1e12, output: 8192 }))
      .toEqual({ maxOutputTokens: 8192, maxInputTokens: null, contextWindowTokens: null, source: "models-dev" });
    expect(mapModelsDevLimit("x")).toBeNull();
  });

  test("independent input limits never reduce the output budget for a long input", () => {
    const capabilities = matchModelsDevLimits(index, { provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", modelId: "gpt-5" });
    const longInput = "a".repeat(600_000); // ~220k estimated tokens: within the 272k input limit
    const plan = planAiGenerationOutputBudget({
      provider: "openai-compatible",
      action: "continue-writing",
      manualMaxOutputTokens: null,
      capabilities,
      inputText: longInput,
      sourceText: longInput,
      allowUnbounded: true,
    });
    expect(plan).toMatchObject({ maxOutputTokens: 128000, mode: "auto", outputLimit: 128000, inputFits: true });
  });
});
