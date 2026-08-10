import { describe, expect, test } from "bun:test";
import {
  buildAiAssistantRequest,
  canReplaceAiSource,
  getDefaultAiAction,
  getDefaultTargetLanguage,
} from "./ai-assistant.ts";

describe("AI assistant interaction model", () => {
  test("chooses a useful default from the current scope and locale", () => {
    expect(getDefaultAiAction(true)).toBe("improve-writing");
    expect(getDefaultAiAction(false)).toBe("summarize");
    expect(getDefaultTargetLanguage("zh-CN")).toBe("en");
    expect(getDefaultTargetLanguage("en-US")).toBe("zh-CN");
  });

  test("sends semantic writing actions while keeping prompts on the server", () => {
    expect(buildAiAssistantRequest({
      action: "make-shorter",
      contentMarkdown: "Long draft",
      customInstruction: "",
      targetLanguage: "en",
      title: "Draft",
      tone: "professional",
    })).toMatchObject({
      action: "make-shorter",
      contentMarkdown: "Long draft",
    });
    expect(buildAiAssistantRequest({
      action: "make-shorter",
      contentMarkdown: "Long draft",
      customInstruction: "",
      targetLanguage: "en",
      title: "Draft",
      tone: "professional",
    })).not.toHaveProperty("instruction");
  });

  test("keeps extractive output additive while allowing rewritten content to replace its source", () => {
    expect(canReplaceAiSource("summarize")).toBe(false);
    expect(canReplaceAiSource("continue-writing")).toBe(false);
    expect(canReplaceAiSource("translate")).toBe(true);
    expect(canReplaceAiSource("custom")).toBe(true);
  });
});
