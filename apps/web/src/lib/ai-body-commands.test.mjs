import { describe, expect, test } from "bun:test";
import { parseAiTargetLanguage, resolveAiBodyCommand } from "./ai-body-commands.ts";
import { hashAiDraftSource } from "./ai-body-draft-store.ts";

describe("sidebar body commands (#652 PR B)", () => {
  test("/translate picks a named language, else the UI language's default; the rest is the instruction", () => {
    expect(resolveAiBodyCommand("translate", "ja", "en-US")).toEqual({ action: "translate", targetLanguage: "ja" });
    expect(resolveAiBodyCommand("translate", "英文 保留术语", "zh-CN")).toEqual({ action: "translate", targetLanguage: "en", instruction: "保留术语" });
    expect(resolveAiBodyCommand("translate", "", "zh-CN").targetLanguage).toBeTruthy();
    expect(resolveAiBodyCommand("translate", "formally", "en-US")).toMatchObject({ action: "translate", instruction: "formally" });
  });

  test("/improve becomes improve-writing; /summarize stays with the Agent", () => {
    expect(resolveAiBodyCommand("improve", "", "en-US")).toEqual({ action: "improve-writing" });
    expect(resolveAiBodyCommand("improve", "more formal", "en-US")).toEqual({ action: "improve-writing", instruction: "more formal" });
    expect(resolveAiBodyCommand("summarize", "", "en-US")).toBeNull();
  });

  test("languages are recognised by code or common name", () => {
    expect(parseAiTargetLanguage("zh-CN")).toBe("zh-CN");
    expect(parseAiTargetLanguage("Polski")).toBe("pl");
    expect(parseAiTargetLanguage("日本語")).toBe("ja");
    expect(parseAiTargetLanguage("klingon")).toBeNull();
  });

  test("the source hash notices any change", () => {
    expect(hashAiDraftSource("abc")).toBe(hashAiDraftSource("abc"));
    expect(hashAiDraftSource("abc")).not.toBe(hashAiDraftSource("abd"));
    expect(hashAiDraftSource("a".repeat(10_000))).not.toBe(hashAiDraftSource(`${"a".repeat(9_999)}b`));
  });
});
