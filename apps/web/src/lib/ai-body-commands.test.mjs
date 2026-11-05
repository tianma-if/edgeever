import { describe, expect, test } from "bun:test";
import { guessAiSourceLanguage, parseAiTargetLanguage, resolveAiBodyCommand, suggestAiTargetLanguages } from "./ai-body-commands.ts";
import { hashAiDraftSource } from "./ai-body-draft-store.ts";

describe("sidebar body commands (#652 PR B)", () => {
  test("/translate picks a named language, else leaves it to the user; the rest is the instruction", () => {
    expect(resolveAiBodyCommand("translate", "ja")).toEqual({ action: "translate", targetLanguage: "ja" });
    expect(resolveAiBodyCommand("translate", "英文 保留术语")).toEqual({ action: "translate", targetLanguage: "en", instruction: "保留术语" });
    // Without a language the sidebar asks which one, as the Agent did.
    expect(resolveAiBodyCommand("translate", "")).toEqual({ action: "translate" });
    expect(resolveAiBodyCommand("translate", "formally")).toEqual({ action: "translate", instruction: "formally" });
  });

  test("/improve becomes improve-writing; /summarize stays with the Agent", () => {
    expect(resolveAiBodyCommand("improve", "")).toEqual({ action: "improve-writing" });
    expect(resolveAiBodyCommand("improve", "more formal")).toEqual({ action: "improve-writing", instruction: "more formal" });
    expect(resolveAiBodyCommand("summarize", "")).toBeNull();
  });

  test("languages are recognised by code or common name", () => {
    expect(parseAiTargetLanguage("zh-CN")).toBe("zh-CN");
    expect(parseAiTargetLanguage("Polski")).toBe("pl");
    expect(parseAiTargetLanguage("日本語")).toBe("ja");
    expect(parseAiTargetLanguage("klingon")).toBeNull();
  });

  test("three language choices leave out the language the source is written in", () => {
    expect(guessAiSourceLanguage("这是一段中文笔记。")).toBe("zh-CN");
    expect(guessAiSourceLanguage("これは日本語のメモです。")).toBe("ja");
    expect(guessAiSourceLanguage("이것은 한국어 메모입니다")).toBe("ko");
    expect(guessAiSourceLanguage("An English note.")).toBe("en");
    expect(suggestAiTargetLanguages("这是一段中文笔记。", "zh-CN", "en")).toEqual(["en", "ja", "ko"]);
    expect(suggestAiTargetLanguages("An English note.", "zh-CN", "en")).toEqual(["zh-CN", "ja", "ko"]);
    expect(suggestAiTargetLanguages("An English note.", "en-US", "zh-CN")).toEqual(["zh-CN", "ja", "ko"]);
    expect(suggestAiTargetLanguages("Notatka po polsku.", "pl", "en")).toHaveLength(3);
  });

  test("the source hash notices any change", () => {
    expect(hashAiDraftSource("abc")).toBe(hashAiDraftSource("abc"));
    expect(hashAiDraftSource("abc")).not.toBe(hashAiDraftSource("abd"));
    expect(hashAiDraftSource("a".repeat(10_000))).not.toBe(hashAiDraftSource(`${"a".repeat(9_999)}b`));
  });
});

describe("signing out (#652 PR B review)", () => {
  test("cancels every draft being generated in this window", async () => {
    const { cancelAiBodyDraftRuns, trackAiBodyDraftRun } = await import("./ai-body-draft-store.ts");
    const first = new AbortController();
    const second = new AbortController();
    const finished = new AbortController();
    trackAiBodyDraftRun(first);
    trackAiBodyDraftRun(second);
    trackAiBodyDraftRun(finished)();
    cancelAiBodyDraftRuns();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(finished.signal.aborted).toBe(false);
  });
});
