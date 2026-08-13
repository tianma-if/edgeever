import { describe, expect, test } from "bun:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import {
  isAiStreamingEnabled,
  runAiGeneration,
} from "../apps/api/src/ai-service";

describe("AI streaming toggle", () => {
  test("only enables streaming for an explicit true value", () => {
    expect(isAiStreamingEnabled("true")).toBe(true);
    expect(isAiStreamingEnabled(" TRUE ")).toBe(true);
    expect(isAiStreamingEnabled("false")).toBe(false);
    expect(isAiStreamingEnabled("1")).toBe(false);
    expect(isAiStreamingEnabled("")).toBe(false);
    expect(isAiStreamingEnabled(undefined)).toBe(false);
  });
});

const RESULT_BOUNDARY = {
  start: "<edgeever-result-test>",
  end: "</edgeever-result-test>",
};

const GENERATED_TEXT = `${RESULT_BOUNDARY.start}\nSummary line.\n${RESULT_BOUNDARY.end}`;

const providerUsage = {
  inputTokens: { total: 11, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 22, text: undefined, reasoning: undefined },
};
const providerFinishReason = { unified: "stop" as const, raw: "stop" };

const generateModel = () => new MockLanguageModelV4({
  doGenerate: async () => ({
    content: [{ type: "text" as const, text: GENERATED_TEXT }],
    finishReason: providerFinishReason,
    usage: providerUsage,
    warnings: [],
  }),
});

const streamModel = () => new MockLanguageModelV4({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id: "1" },
        { type: "text-delta" as const, id: "1", delta: `${RESULT_BOUNDARY.start}\nSummary ` },
        { type: "text-delta" as const, id: "1", delta: `line.\n${RESULT_BOUNDARY.end}` },
        { type: "text-end" as const, id: "1" },
        { type: "finish" as const, finishReason: providerFinishReason, usage: providerUsage },
      ],
    }),
  }),
});

const failingGenerateModel = () => new MockLanguageModelV4({
  doGenerate: async () => {
    throw new Error("provider exploded");
  },
});

const failingStreamModel = () => new MockLanguageModelV4({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "error" as const, error: new Error("provider exploded") },
      ],
    }),
  }),
});

const generationInput = (model: LanguageModel, streaming: boolean) => ({
  model,
  action: "summarize" as const,
  contentMarkdown: "Note body.",
  resultBoundary: RESULT_BOUNDARY,
  streaming,
});

describe("runAiGeneration", () => {
  test("returns the same outcome from both branches", async () => {
    const nonStreaming = await runAiGeneration(generationInput(generateModel(), false));
    const streaming = await runAiGeneration(generationInput(streamModel(), true));

    expect(nonStreaming).toEqual({
      text: GENERATED_TEXT,
      finishReason: "stop",
      inputTokens: 11,
      outputTokens: 22,
    });
    expect(streaming).toEqual(nonStreaming);
  });

  test("propagates provider failures from both branches", async () => {
    expect(runAiGeneration(generationInput(failingGenerateModel(), false)))
      .rejects.toThrow("provider exploded");
    expect(runAiGeneration(generationInput(failingStreamModel(), true)))
      .rejects.toThrow("provider exploded");
  });
});
