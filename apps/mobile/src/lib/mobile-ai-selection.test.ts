import { describe, expect, test } from "bun:test";
import { buildMobileAiStreamBridgePayload, parseMobileSelectionAiRequest } from "./mobile-ai-selection";

describe("mobile AI selection bridge", () => {
  test("accepts semantic selection actions and normalized options", () => {
    expect(parseMobileSelectionAiRequest(JSON.stringify({
      requestId: "request-1",
      action: "change-tone",
      contentMarkdown: "Selected text",
      tone: "friendly",
    }))).toEqual({
      requestId: "request-1",
      action: "change-tone",
      contentMarkdown: "Selected text",
      targetLanguage: undefined,
      tone: "friendly",
      instruction: undefined,
    });
  });

  test("rejects malformed, incomplete, and unsupported requests", () => {
    expect(parseMobileSelectionAiRequest("not json")).toBeNull();
    expect(parseMobileSelectionAiRequest(JSON.stringify({
      requestId: "request-2",
      action: "translate",
      contentMarkdown: "Selected text",
    }))).toBeNull();
    expect(parseMobileSelectionAiRequest(JSON.stringify({
      requestId: "request-3",
      action: "change-tone",
      contentMarkdown: "Selected text",
      tone: "angry",
    }))).toBeNull();
  });

  test("addresses every streamed event to its originating DOM request", () => {
    expect(JSON.parse(buildMobileAiStreamBridgePayload("request-4", {
      type: "text-delta",
      text: "Draft",
    }))).toEqual({
      requestId: "request-4",
      event: { type: "text-delta", text: "Draft" },
    });
  });
});
