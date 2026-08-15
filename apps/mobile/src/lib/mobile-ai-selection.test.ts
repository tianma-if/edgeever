import { describe, expect, test } from "bun:test";
import { buildMobileAiStreamBridgePayload, getMobileAiSourceRange, parseMobileSelectionAiRequest } from "./mobile-ai-selection";

describe("mobile AI selection bridge", () => {
  test("uses the selected range when text is selected and the whole note otherwise", () => {
    expect(getMobileAiSourceRange({ from: 4, to: 12, empty: false }, 20)).toEqual({
      from: 4,
      to: 12,
      wholeNote: false,
    });
    expect(getMobileAiSourceRange({ from: 8, to: 8, empty: true }, 20)).toEqual({
      from: 0,
      to: 20,
      wholeNote: true,
    });
  });

  test("accepts semantic selection actions and normalized options", () => {
    expect(parseMobileSelectionAiRequest(JSON.stringify({
      requestId: "request-1",
      action: "change-tone",
      promptId: undefined,
      locale: undefined,
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

    expect(parseMobileSelectionAiRequest(JSON.stringify({
      requestId: "request-saved-prompt",
      action: "custom",
      promptId: "aiprompt_saved",
      locale: "en-US",
      contentMarkdown: "Selected text",
    }))).toMatchObject({
      requestId: "request-saved-prompt",
      action: "custom",
      promptId: "aiprompt_saved",
      locale: "en-US",
      contentMarkdown: "Selected text",
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
