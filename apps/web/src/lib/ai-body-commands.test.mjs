import { describe, expect, test } from "bun:test";
import { parseAiTargetLanguage, resolveAiBodyCommand } from "./ai-body-commands.ts";
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

  test("the source hash notices any change", () => {
    expect(hashAiDraftSource("abc")).toBe(hashAiDraftSource("abc"));
    expect(hashAiDraftSource("abc")).not.toBe(hashAiDraftSource("abd"));
    expect(hashAiDraftSource("a".repeat(10_000))).not.toBe(hashAiDraftSource(`${"a".repeat(9_999)}b`));
  });
});
