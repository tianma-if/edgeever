import { describe, expect, test } from "bun:test";
import { enUS } from "./i18n/en-US.ts";
import { ja } from "./i18n/ja.ts";
import { pl } from "./i18n/pl.ts";
import { ru } from "./i18n/ru.ts";
import { zhCN } from "./i18n/zh-CN.ts";
import { CompanionTurnInputSchema, companionTurnLocale, conversationLanguage, translationTargetInstruction } from "./companion.ts";

const locale = (message, recent, fallback) => conversationLanguage(message, recent, fallback);

describe("companion conversation language", () => {
  test("reads Polish typed without diacritics when the interface is Polish", () => {
    expect(locale("Napisz plan na jutro", [], "pl")).toEqual({ locale: "pl", source: "current request" });
    expect(locale("Podsumuj te notatki", [], "pl")).toEqual({ locale: "pl", source: "current request" });
  });

  test("still recognizes English requests with a Polish interface", () => {
    expect(locale("Write a plan for tomorrow", [], "pl")).toEqual({ locale: "en-US", source: "current request" });
    expect(locale("Please summarize this note", [], "pl")).toEqual({ locale: "en-US", source: "current request" });
    expect(locale("Make a plan", [], "pl")).toEqual({ locale: "en-US", source: "current request" });
  });

  test("falls back to recent messages, then the Polish interface, when Latin text is ambiguous", () => {
    expect(locale("Kubernetes", ["Przygotuj listę zadań"], "pl")).toEqual({ locale: "pl", source: "recent conversation" });
    expect(locale("Kubernetes", ["Please write a summary"], "pl")).toEqual({ locale: "en-US", source: "recent conversation" });
    expect(locale("Kubernetes", [], "pl")).toEqual({ locale: "pl", source: "interface" });
  });

  test("uses diacritics and other scripts regardless of the interface", () => {
    expect(locale("Zrób listę zakupów", [], "en-US")).toEqual({ locale: "pl", source: "current request" });
    expect(locale("帮我总结这篇笔记", [], "pl")).toEqual({ locale: "zh-CN", source: "current request" });
    expect(locale("このメモを要約して", [], "pl")).toEqual({ locale: "ja", source: "current request" });
  });

  test("keeps treating Latin text as English for other interfaces", () => {
    expect(locale("Napisz plan na jutro", [], "en-US")).toEqual({ locale: "en-US", source: "current request" });
    expect(locale("Kubernetes", [], "zh-CN")).toEqual({ locale: "en-US", source: "current request" });
    expect(locale("12345", [], "ja")).toEqual({ locale: "ja", source: "interface" });
  });

  test("ignores the wording of localized translation actions", () => {
    expect(locale("Przetłumacz poniższy fragment:\nHello world", ["Napisz plan na jutro"], "en-US"))
      .toEqual({ locale: "en-US", source: "recent conversation" });
    expect(locale("Przetłumacz to, na co patrzę", [], "pl")).toEqual({ locale: "pl", source: "interface" });
  });

  test("recognizes Russian requests and names every interface language", () => {
    expect(locale("Сделай краткое содержание заметки", [], "en-US")).toEqual({ locale: "ru", source: "current request" });
    expect(locale("12345", [], "ru")).toEqual({ locale: "ru", source: "interface" });
    for (const [code, name] of [["zh-CN", "Simplified Chinese"], ["en-US", "English"], ["ja", "Japanese"], ["pl", "Polish"], ["ru", "Russian"]]) {
      expect(translationTargetInstruction({ locale: code, source: "interface" })).toContain(`translate into ${name}`);
    }
  });

  test("maps any UI locale to a companion turn locale", () => {
    expect(companionTurnLocale("ru-RU")).toBe("ru");
    expect(companionTurnLocale("zh-TW")).toBe("zh-TW");
    expect(companionTurnLocale("de-DE")).toBe("de");
    expect(companionTurnLocale("it-IT")).toBe("en-US");
    expect(companionTurnLocale(null)).toBe("en-US");
    expect(CompanionTurnInputSchema.shape.locale.parse("ru")).toBe("ru");
  });

  test("generated translation actions in every interface language are not conversation evidence", () => {
    for (const catalog of [zhCN, enUS, ja, pl, ru]) {
      const { selection, skillPrompts } = catalog.aiAssistant.sidebar;
      const prompts = [
        skillPrompts.translate,
        `${selection.translatePrompt}\n\nHello world`,
        `${selection.translateLanguagePrompt.replace("{{language}}", "English")}\n\nHello world`,
      ];
      for (const prompt of prompts) {
        expect(locale(prompt, ["Please summarize this note"], "en-US")).toEqual({ locale: "en-US", source: "recent conversation" });
      }
    }
    // The case from the review: a Russian UI must keep the earlier English conversation.
    expect(locale("Переведи то, что я сейчас смотрю, и ответь переводом.", ["Please summarize this note"], "en-US"))
      .toEqual({ locale: "en-US", source: "recent conversation" });
  });
});
