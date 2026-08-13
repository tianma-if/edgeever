import { describe, expect, test } from "bun:test";
import { isAiStreamingEnabled } from "../apps/api/src/ai-service";

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
