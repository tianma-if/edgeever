import { describe, expect, test } from "bun:test";
import {
  buildMobileAiStreamBridgePayload,
  getMobileAiSourceRange,
  parseMobileSelectionAiRequest,
  resolveMobileAiSelectionTriggerPosition,
} from "./mobile-ai-selection";

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

  test("places the contextual AI trigger below the selection and inside horizontal edges", () => {
    expect(resolveMobileAiSelectionTriggerPosition({
      selectionStart: { top: 180, bottom: 204, left: 24, right: 120 },
      selectionEnd: { top: 204, bottom: 228, left: 390, right: 390 },
      shell: { top: 100, bottom: 800, left: 0, right: 420 },
      visibleBounds: { top: 140, bottom: 760 },
    })).toEqual({ left: 334, top: 140 });
  });

  test("moves the contextual AI trigger above a selection near the visible bottom", () => {
    expect(resolveMobileAiSelectionTriggerPosition({
      selectionStart: { top: 690, bottom: 714, left: 40, right: 160 },
      selectionEnd: { top: 714, bottom: 738, left: 220, right: 220 },
      shell: { top: 100, bottom: 800, left: 0, right: 420 },
      visibleBounds: { top: 140, bottom: 760 },
    })).toEqual({ left: 183, top: 540 });
  });
});
