import { describe, expect, test } from "bun:test";
import { parseAiTagSuggestionNames } from "./ai-runtime.ts";

describe("AI tag response parsing", () => {
  test("parses the requested suggestions object", () => {
    expect(parseAiTagSuggestionNames('{"suggestions":["React","AI"]}'))
      .toEqual(["React", "AI"]);
  });

  test("accepts common compatible-model JSON variations", () => {
    expect(parseAiTagSuggestionNames('```json\n["React", "AI"]\n```'))
      .toEqual(["React", "AI"]);
    expect(parseAiTagSuggestionNames('Result: {"tags":[{"name":"React"},{"tag":"AI"}]}'))
      .toEqual(["React", "AI"]);
  });

  test("accepts the reasoning-model-safe tag block", () => {
    expect(parseAiTagSuggestionNames(`Analysis omitted.\n<edgeever-tags>\n历史人物\n轻小说\n跨界创作\n</edgeever-tags>`))
      .toEqual(["历史人物", "轻小说", "跨界创作"]);
  });

  test("accepts plain tag lines from compatible models but drops explanatory prose", () => {
    expect(parseAiTagSuggestionNames("以下是建议标签：\n历史人物\n日本轻小说"))
      .toEqual(["历史人物", "日本轻小说"]);
    expect(parseAiTagSuggestionNames("日本轻小说")).toEqual(["日本轻小说"]);
  });

  test("rejects prose instead of treating it as tag data", () => {
    expect(() => parseAiTagSuggestionNames("React, AI"))
      .toThrow("requested tag block");
    expect(() => parseAiTagSuggestionNames('{"answer":"React"}'))
      .toThrow("requested tag block");
  });

  test("caps provider output before route-level normalization", () => {
    expect(parseAiTagSuggestionNames(JSON.stringify({
      suggestions: ["1", "2", "3", "4", "5", "6", "7", "8"],
    }))).toHaveLength(7);
  });
});
