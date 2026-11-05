import { describe, expect, test } from "bun:test";
import {
  estimateAiTokens,
  isAiModelCapabilityStale,
  isAiTruncatedFinishReason,
  parseAiModelCapabilityLimits,
  parseAiOutputLimitFromError,
  planAiGenerationOutputBudget,
  aiDraftIncompleteReason,
  failAiDraftCompletion,
  startAiDraftCompletion,
  stopAiDraftCompletion,
  trackAiDraftEvent,
} from "./index.ts";

describe("model capability parsing (#652)", () => {
  test("Anthropic reports max_tokens and a shared window", () => {
    const single = { id: "claude-x", type: "model", max_tokens: 64000, max_input_tokens: 200000 };
    expect(parseAiModelCapabilityLimits({ provider: "anthropic", modelId: "claude-x", endpoint: "model", body: single })).toEqual({
      maxOutputTokens: 64000, maxInputTokens: null, contextWindowTokens: 200000, source: "anthropic-models",
    });
    const list = { data: [{ id: "other", max_tokens: 1 }, single] };
    expect(parseAiModelCapabilityLimits({ provider: "anthropic", modelId: "claude-x", endpoint: "models", body: list })?.maxOutputTokens).toBe(64000);
    expect(parseAiModelCapabilityLimits({ provider: "anthropic", modelId: "claude-x", endpoint: "model", body: { id: "claude-x", max_tokens: null, max_input_tokens: null } })).toBeNull();
  });

  test("Gemini reports independent input and output limits", () => {
    const body = { name: "models/gemini-x", inputTokenLimit: 1048576, outputTokenLimit: 65536 };
    expect(parseAiModelCapabilityLimits({ provider: "google", modelId: "gemini-x", endpoint: "model", body })).toEqual({
      maxOutputTokens: 65536, maxInputTokens: 1048576, contextWindowTokens: null, source: "gemini-models",
    });
    expect(parseAiModelCapabilityLimits({ provider: "google", modelId: "models/gemini-x", endpoint: "models", body: { models: [body] } })?.maxOutputTokens).toBe(65536);
  });

  test("OpenRouter, DeepSeek and LiteLLM model metadata", () => {
    const openRouter = { data: [{ id: "openai/gpt-x", context_length: 400000, top_provider: { context_length: 400000, max_completion_tokens: 128000 } }] };
    expect(parseAiModelCapabilityLimits({ provider: "openai-compatible", modelId: "openai/gpt-x", endpoint: "models", body: openRouter })).toEqual({
      maxOutputTokens: 128000, maxInputTokens: null, contextWindowTokens: 400000, source: "openrouter-models",
    });
    const openRouterNoMax = { data: [{ id: "m", context_length: 131072, top_provider: { max_completion_tokens: null } }] };
    expect(parseAiModelCapabilityLimits({ provider: "openai-compatible", modelId: "m", endpoint: "models", body: openRouterNoMax })).toEqual({
      maxOutputTokens: null, maxInputTokens: null, contextWindowTokens: 131072, source: "openrouter-models",
    });
    const deepSeek = { data: [{ id: "deepseek-flash", context_window: 1048576, max_output_tokens: 393216 }] };
    expect(parseAiModelCapabilityLimits({ provider: "openai-compatible", modelId: "deepseek-flash", endpoint: "models", body: deepSeek })).toEqual({
      maxOutputTokens: 393216, maxInputTokens: null, contextWindowTokens: 1048576, source: "deepseek-models",
    });
    const plain = { data: [{ id: "gpt-x", object: "model", owned_by: "openai" }] };
    expect(parseAiModelCapabilityLimits({ provider: "openai-compatible", modelId: "gpt-x", endpoint: "models", body: plain })).toBeNull();
    const liteLlm = { data: [{ model_name: "my-model", model_info: { max_input_tokens: 128000, max_output_tokens: 16384, max_tokens: 16384 } }] };
    expect(parseAiModelCapabilityLimits({ provider: "openai-compatible", modelId: "my-model", endpoint: "litellm-model-info", body: liteLlm })).toEqual({
      maxOutputTokens: 16384, maxInputTokens: 128000, contextWindowTokens: null, source: "litellm-model-info",
    });
  });

  test("limits are read from provider errors only when the message is recognised", () => {
    expect(parseAiOutputLimitFromError("max_tokens: 128001 > 64000, which is the maximum allowed number of output tokens for claude-x")).toBe(64000);
    expect(parseAiOutputLimitFromError("max_tokens is too large: 86000. This model supports at most 4096 completion tokens, whereas you provided 86000")).toBe(4096);
    expect(parseAiOutputLimitFromError("it has a maxOutputTokens value of 828858 but the supported range is from 1 (inclusive) to 65537 (exclusive).")).toBe(65536);
    expect(parseAiOutputLimitFromError("max_tokens must be less than or equal to 8192")).toBe(8192);
    expect(parseAiOutputLimitFromError("Invalid API key")).toBeNull();
  });

  test("truncation finish reasons across providers", () => {
    for (const reason of ["length", "max_tokens", "MAX_TOKENS", "model_context_window_exceeded"]) expect(isAiTruncatedFinishReason(reason)).toBe(true);
    for (const reason of ["stop", "end_turn", "STOP", undefined, null, ""]) expect(isAiTruncatedFinishReason(reason)).toBe(false);
  });

  test("detected limits expire after seven days", () => {
    const now = Date.parse("2026-11-10T00:00:00.000Z");
    expect(isAiModelCapabilityStale(null, now)).toBe(true);
    expect(isAiModelCapabilityStale({ maxOutputTokens: 1, maxInputTokens: null, contextWindowTokens: null, source: "gemini-models", detectedAt: "2026-11-05T00:00:00.000Z" }, now)).toBe(false);
    expect(isAiModelCapabilityStale({ maxOutputTokens: 1, maxInputTokens: null, contextWindowTokens: null, source: "gemini-models", detectedAt: "2026-11-01T00:00:00.000Z" }, now)).toBe(true);
  });
});

describe("output budget planning (#652)", () => {
  const plan = (overrides) => planAiGenerationOutputBudget({
    provider: "openai-compatible",
    action: "continue-writing",
    manualMaxOutputTokens: null,
    capabilities: null,
    inputText: "short",
    sourceText: "short",
    allowUnbounded: true,
    ...overrides,
  });

  test("a manual budget always wins", () => {
    expect(plan({ manualMaxOutputTokens: 9000, capabilities: { maxOutputTokens: 64000, maxInputTokens: null, contextWindowTokens: null, source: "anthropic-models" } }))
      .toMatchObject({ maxOutputTokens: 9000, mode: "manual" });
  });

  test("Gemini: a long input within the input limit does not reduce the output budget", () => {
    const longInput = "a".repeat(600_000); // ~220k estimated tokens, well under a 1M input limit
    const result = plan({
      provider: "google",
      capabilities: { maxOutputTokens: 65536, maxInputTokens: 1_048_576, contextWindowTokens: null, source: "gemini-models" },
      inputText: longInput,
      sourceText: longInput,
    });
    expect(result).toMatchObject({ maxOutputTokens: 65536, mode: "auto", outputLimit: 65536, inputFits: true });
    expect(result.inputTokens).toBeGreaterThan(200_000);
  });

  test("a shared window subtracts the input (Anthropic / DeepSeek / OpenRouter)", () => {
    const input = "a".repeat(450_000); // ~165k tokens
    const result = plan({
      provider: "anthropic",
      capabilities: { maxOutputTokens: 64000, maxInputTokens: null, contextWindowTokens: 200_000, source: "anthropic-models" },
      inputText: input,
      sourceText: input,
    });
    expect(result.mode).toBe("auto");
    expect(result.maxOutputTokens).toBeLessThan(64000);
    expect(result.maxOutputTokens).toBe(200_000 - result.inputTokens - 4000);
    expect(result.inputFits).toBe(true);
  });

  test("a nearly full shared window caps the budget at the room left, never above it", () => {
    const caps = { maxOutputTokens: 64000, maxInputTokens: null, contextWindowTokens: 100_000, source: "anthropic-models" };
    const input = "字".repeat(88_818); // 97,700 estimated tokens: 100,000 - 97,700 - 2,000 safety = 300 left
    for (const action of ["continue-writing", "translate"]) {
      const result = plan({ provider: "anthropic", action, capabilities: caps, inputText: input, sourceText: input });
      expect(result.inputTokens).toBe(97_700);
      expect(result).toMatchObject({ mode: "auto", outputLimit: 300, maxOutputTokens: 300, inputFits: true });
    }
  });

  test("an exhausted window or input limit reports that the input does not fit", () => {
    const window = { maxOutputTokens: 64000, maxInputTokens: null, contextWindowTokens: 100_000, source: "anthropic-models" };
    const tooLong = "字".repeat(100_000); // 110,000 estimated tokens
    const exhausted = plan({ provider: "anthropic", capabilities: window, inputText: tooLong, sourceText: tooLong });
    expect(exhausted).toMatchObject({ mode: "auto", inputFits: false, outputLimit: 0 });
    expect(exhausted.maxOutputTokens).toBeLessThanOrEqual(0);
    // An independent input limit (Gemini) is checked too, and a known window still applies.
    const inputLimit = { maxOutputTokens: 65536, maxInputTokens: 100_000, contextWindowTokens: null, source: "gemini-models" };
    expect(plan({ provider: "google", capabilities: inputLimit, inputText: tooLong, sourceText: tooLong }).inputFits).toBe(false);
    const both = { maxOutputTokens: 65536, maxInputTokens: 1_000_000, contextWindowTokens: 100_000, source: "litellm-model-info" };
    expect(plan({ capabilities: both, inputText: tooLong, sourceText: tooLong }).inputFits).toBe(false);
  });

  test("open-ended tasks may use the whole output limit; source-sized tasks use what they need", () => {
    const caps = { maxOutputTokens: 32768, maxInputTokens: null, contextWindowTokens: null, source: "litellm-model-info" };
    expect(plan({ capabilities: caps, action: "continue-writing" }).maxOutputTokens).toBe(32768);
    expect(plan({ capabilities: caps, action: "custom" }).maxOutputTokens).toBe(32768);
    // A short note keeps at least the previous default.
    const short = plan({ capabilities: caps, action: "translate" }).maxOutputTokens;
    expect(short).toBeGreaterThanOrEqual(4096);
    expect(short).toBeLessThan(4200);
    // A long note can use more than 4096 and up to the limit.
    const longNote = "字".repeat(9000); // ~9.9k tokens
    const translated = plan({ capabilities: caps, action: "translate", inputText: longNote, sourceText: longNote }).maxOutputTokens;
    expect(translated).toBeGreaterThan(8192);
    expect(translated).toBeLessThanOrEqual(32768);
  });

  test("without limits, capable clients send no limit and others keep the old default", () => {
    expect(plan({})).toMatchObject({ maxOutputTokens: null, mode: "auto-unbounded" });
    expect(plan({ provider: "google" })).toMatchObject({ maxOutputTokens: null, mode: "auto-unbounded" });
    expect(plan({ allowUnbounded: false })).toMatchObject({ maxOutputTokens: 4096, mode: "fallback" });
    // Anthropic requires max_tokens.
    expect(plan({ provider: "anthropic" })).toMatchObject({ maxOutputTokens: 4096, mode: "fallback" });
    // A detection that found nothing counts as unknown.
    expect(plan({ capabilities: { maxOutputTokens: null, maxInputTokens: null, contextWindowTokens: null, source: "none" } }).mode).toBe("auto-unbounded");
  });

  test("token estimates count CJK characters individually", () => {
    expect(estimateAiTokens("")).toBe(0);
    expect(estimateAiTokens("中文测试")).toBe(5);
    expect(estimateAiTokens("a".repeat(300))).toBe(110);
  });
});

describe("draft completion (#652)", () => {
  const run = (events, end) => {
    let state = startAiDraftCompletion();
    for (const event of events) state = trackAiDraftEvent(state, event);
    if (end === "fail") state = failAiDraftCompletion(state);
    if (end === "stop") state = stopAiDraftCompletion(state);
    return aiDraftIncompleteReason(state);
  };
  const text = { type: "text-delta", text: "Partial" };

  test("only a clean finish lets a draft replace the original", () => {
    expect(run([{ type: "start" }, text])).toBe("interrupted");
    expect(run([{ type: "start" }, text, { type: "finish", truncated: false }])).toBeNull();
    expect(run([text, { type: "finish", truncated: true }])).toBe("truncated");
    expect(run([text], "stop")).toBe("stopped");
  });

  test("text followed by a dropped connection or a stream error stays incomplete", () => {
    expect(run([{ type: "start" }, text], "fail")).toBe("interrupted");
    expect(run([text, { type: "error", code: "ai_generation_failed", message: "x" }])).toBe("interrupted");
    // A later finish does not clear an earlier error.
    expect(run([text, { type: "error" }, { type: "finish", truncated: false }])).toBe("interrupted");
  });
});
