import { describe, expect, test } from "bun:test";
import {
  COMPANION_PROCESS_MAX_CHARS,
  COMPANION_REQUEST_MAX_BYTES,
  COMPANION_RESPONSE_MAX_CHARS,
  CompanionTurnCompleteSchema,
  fitCompanionTurnBody,
} from "./index.ts";

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

describe("companion request size (#652)", () => {
  test("small bodies are unchanged", () => {
    const body = { response: "你好", process: "思考", status: "completed" };
    expect(fitCompanionTurnBody(body)).toEqual(body);
  });

  test("Chinese reply and process at their character limits fit the request byte limit", () => {
    const body = { response: "答".repeat(COMPANION_RESPONSE_MAX_CHARS), process: `${"旧".repeat(16000)}${"新".repeat(16000)}`, status: "failed" };
    expect(bytes(body)).toBeGreaterThan(COMPANION_REQUEST_MAX_BYTES);
    const fitted = fitCompanionTurnBody(body);
    expect(bytes(fitted)).toBeLessThanOrEqual(COMPANION_REQUEST_MAX_BYTES);
    expect(CompanionTurnCompleteSchema.parse(fitted)).toEqual(fitted);
    // The user-facing reply is kept whole; the oldest process text is dropped first.
    expect(fitted.response).toBe(body.response);
    expect(fitted.process.startsWith("…\n\n")).toBe(true);
    expect(fitted.process.endsWith("新".repeat(16000))).toBe(true);
    expect(fitted.process.length).toBeLessThanOrEqual(COMPANION_PROCESS_MAX_CHARS);
  });

  test("a large tool input empties the process before shortening the reply", () => {
    const body = { name: "update_memo", input: { contentMarkdown: "文".repeat(30000) }, response: "答".repeat(16000), process: "过".repeat(1000) };
    const fitted = fitCompanionTurnBody(body);
    expect(bytes(fitted)).toBeLessThanOrEqual(COMPANION_REQUEST_MAX_BYTES);
    expect(fitted.input).toEqual(body.input);
    expect(fitted.process).toBe("");
    expect(fitted.response.length).toBeLessThan(16000);
    expect(body.response.startsWith(fitted.response)).toBe(true);
  });

  test("clipping never splits a surrogate pair", () => {
    const fitted = fitCompanionTurnBody({ response: "😀".repeat(30000), process: "" }, 1000);
    expect(bytes(fitted)).toBeLessThanOrEqual(1000);
    expect(fitted.response).toMatch(/^(😀)*$/u);
  });
});
