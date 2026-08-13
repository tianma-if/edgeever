import { describe, expect, test } from "bun:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import type { AiStreamEvent } from "@edgeever/shared";
import {
  AI_GENERATION_TIMEOUT_DEFAULT_SECONDS,
  buildAiGenerationFrames,
  isAiStreamingEnabled,
  resolveAiGenerationTimeoutMs,
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

describe("resolveAiGenerationTimeoutMs", () => {
  const defaultMs = AI_GENERATION_TIMEOUT_DEFAULT_SECONDS * 1_000;

  test("defaults to 90s when unset", () => {
    expect(resolveAiGenerationTimeoutMs(undefined)).toBe(defaultMs);
    expect(resolveAiGenerationTimeoutMs("")).toBe(defaultMs);
  });

  test("allows 0 to disable the server-side cap", () => {
    expect(resolveAiGenerationTimeoutMs("0")).toBe(0);
  });

  test("converts a valid seconds value to milliseconds", () => {
    expect(resolveAiGenerationTimeoutMs("600")).toBe(600_000);
  });

  test("tolerates surrounding whitespace", () => {
    expect(resolveAiGenerationTimeoutMs("  600  ")).toBe(600_000);
    expect(resolveAiGenerationTimeoutMs("   ")).toBe(defaultMs);
  });

  test("falls back to the default for invalid input", () => {
    expect(resolveAiGenerationTimeoutMs("abc")).toBe(defaultMs);
    expect(resolveAiGenerationTimeoutMs("-5")).toBe(defaultMs);
    expect(resolveAiGenerationTimeoutMs("1.5")).toBe(defaultMs);
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
    await expect(runAiGeneration(generationInput(failingGenerateModel(), false)))
      .rejects.toThrow("provider exploded");
    await expect(runAiGeneration(generationInput(failingStreamModel(), true)))
      .rejects.toThrow("provider exploded");
  });
});

describe("buildAiGenerationFrames", () => {
  test("strips the result boundary and maps usage onto the finish frame", () => {
    expect(buildAiGenerationFrames(
      { text: GENERATED_TEXT, finishReason: "stop", inputTokens: 11, outputTokens: 22 },
      RESULT_BOUNDARY,
    )).toEqual([
      { type: "text-delta", text: "Summary line." },
      { type: "finish", finishReason: "stop", inputTokens: 11, outputTokens: 22 },
    ]);
  });

  test("rejects an empty result", () => {
    expect(() => buildAiGenerationFrames(
      { text: `${RESULT_BOUNDARY.start}\n\n${RESULT_BOUNDARY.end}` },
      RESULT_BOUNDARY,
    )).toThrow("The AI did not return a note result.");
  });

  test("both branches encode an identical SSE body", async () => {
    const encodeBody = (frames: AiStreamEvent[]) =>
      [{ type: "start" }, ...frames]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");

    const nonStreamingBody = encodeBody(buildAiGenerationFrames(
      await runAiGeneration(generationInput(generateModel(), false)),
      RESULT_BOUNDARY,
    ));
    const streamingBody = encodeBody(buildAiGenerationFrames(
      await runAiGeneration(generationInput(streamModel(), true)),
      RESULT_BOUNDARY,
    ));

    expect(nonStreamingBody).toBe(streamingBody);
    expect(nonStreamingBody).toBe(
      `data: {"type":"start"}\n\n`
      + `data: {"type":"text-delta","text":"Summary line."}\n\n`
      + `data: {"type":"finish","finishReason":"stop","inputTokens":11,"outputTokens":22}\n\n`,
    );
  });
});
