import { describe, expect, test } from "bun:test";
import {
  buildAiAssistantRequest,
  canReplaceAiSource,
  getDefaultAiAction,
  getDefaultTargetLanguage,
  parseDefaultAiPromptKey,
} from "./ai-assistant.ts";

describe("AI assistant interaction model", () => {
  test("chooses a useful default from the current scope and locale", () => {
    expect(getDefaultAiAction(true)).toBe("improve-writing");
    expect(getDefaultAiAction(false)).toBe("summarize");
    expect(getDefaultTargetLanguage("zh-CN")).toBe("en");
    expect(getDefaultTargetLanguage("en-US")).toBe("zh-CN");
  });

  test("sends the visible instruction with the semantic action key", () => {
    expect(buildAiAssistantRequest({
      action: "make-shorter",
      contentMarkdown: "Long draft",
      customInstruction: "把内容改写得更简洁。",
      targetLanguage: "en",
      title: "Draft",
      tone: "professional",
    })).toEqual({
      action: "make-shorter",
      title: "Draft",
      contentMarkdown: "Long draft",
      instruction: "把内容改写得更简洁。",
    });
    expect(buildAiAssistantRequest({
      action: "translate",
      contentMarkdown: "Hello",
      customInstruction: "将完整笔记翻译成用户指定的目标语言。",
      targetLanguage: "en",
      title: "Draft",
      tone: "professional",
    })).toMatchObject({
      action: "translate",
      targetLanguage: "en",
      instruction: "将完整笔记翻译成用户指定的目标语言。",
    });
  });

  test("sends saved prompt identity and explicit parameters without duplicating its instruction", () => {
    expect(buildAiAssistantRequest({
      action: "custom",
      contentMarkdown: "Hello",
      customInstruction: "A stale client-side copy that must not be trusted.",
      locale: "en-US",
      parameterKind: "target-language",
      promptId: "aiprompt_translate_for_clients",
      targetLanguage: "zh-CN",
      title: "Draft",
      tone: "professional",
    })).toEqual({
      action: "custom",
      promptId: "aiprompt_translate_for_clients",
      locale: "en-US",
      title: "Draft",
      contentMarkdown: "Hello",
      targetLanguage: "zh-CN",
    });
  });

  test("keeps extractive output additive while allowing rewritten content to replace its source", () => {
    expect(canReplaceAiSource("summarize")).toBe(false);
    expect(canReplaceAiSource("continue-writing")).toBe(false);
    expect(canReplaceAiSource("translate")).toBe(true);
    expect(canReplaceAiSource("custom")).toBe(true);
  });

  test("parses seed keys from deterministic prompt ids", () => {
    expect(parseDefaultAiPromptKey("ws_1_aiprompt_summarize")).toBe("summarize");
    expect(parseDefaultAiPromptKey("aiprompt_abc123")).toBe(null);
  });
});
