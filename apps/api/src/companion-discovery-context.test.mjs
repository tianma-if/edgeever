import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { discoveryContext, discoveryInputHash } from "./companion-discovery-context.ts";
import { generateCompanionDiscovery } from "./companion-discovery-runtime.ts";

const candidates = Array.from({ length: 6 }, (_, i) => ({ id: `memo_00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  title: `Idea ${i}`, contentMarkdown: `原文 ${i}: n1 is quoted data.\nKeep **formatting** and links.`, updatedAt: "2026-09-03T01:02:03.000Z", plainText: false }));
const input = { candidates, anchorId: candidates[0].id, locale: "en-US" };

test("short IDs shrink discovery input without truncating or rewriting note content", () => {
  const context = discoveryContext(input);
  const prompt = JSON.parse(context.prompt);
  const original = JSON.stringify({ anchorId: input.anchorId, notes: candidates });
  expect(context.prompt.length).toBeLessThan(original.length - 200);
  expect(prompt.anchorId).toBe("n1");
  expect(prompt.notes.map(note => note.id)).toEqual(["n1", "n2", "n3", "n4", "n5", "n6"]);
  prompt.notes.forEach((note, index) => expect({ ...note, id: candidates[index].id }).toEqual(candidates[index]));
});

test("only exact supplied aliases can resolve to real note IDs", () => {
  const context = discoveryContext(input);
  const output = { suggestion: { kind: "append", title: "Title", body: "Keep n1 quoted in prose", sourceIds: ["n1", "n2"], targetId: "n2" } };
  expect(context.decode(output)).toEqual({ suggestion: { ...output.suggestion, sourceIds: [candidates[0].id, candidates[1].id], targetId: candidates[1].id } });
  expect(output.suggestion.sourceIds).toEqual(["n1", "n2"]);
  for (const source of ["n0", "n7", "n01", "__proto__", candidates[0].id]) {
    expect(() => context.decode({ suggestion: { ...output.suggestion, sourceIds: [source, "n2"] } })).toThrow("Unknown discovery source");
    expect(() => context.decode({ suggestion: { ...output.suggestion, targetId: source } })).toThrow("Unknown discovery source");
  }
  expect(context.decode({ suggestion: null })).toEqual({ suggestion: null });
  expect(() => discoveryContext({ ...input, anchorId: "missing" })).toThrow();
  expect(() => discoveryContext({ ...input, candidates: [candidates[0], candidates[0]] })).toThrow();
});

test("analysis fingerprint includes content, real IDs, context and model configuration", async () => {
  const request = { ...input, settingsVersion: 1, contextRevision: 0, modelConfiguration: { default_model_id: "model-a" } };
  const hash = await discoveryInputHash(request);
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(await discoveryInputHash({ ...request })).toBe(hash);
  for (const patch of [{ locale: "zh-CN" }, { settingsVersion: 2 }, { contextRevision: 1 }, { anchorId: candidates[1].id },
    { modelConfiguration: { default_model_id: "model-b" } },
    ...["title", "contentMarkdown", "updatedAt"].map(key => ({ candidates: candidates.map((note, i) => i ? note : { ...note, [key]: `${note[key]} changed` }) })),
    { candidates: candidates.map((note, i) => i ? note : { ...note, plainText: true }) },
    { candidates: candidates.map((note, i) => i ? { ...note, id: "another-real-note" + i } : note) },
  ]) expect(await discoveryInputHash({ ...request, ...patch })).not.toBe(hash);
});

test("actual SDK uses compact input and translates its output before leaving the runtime", async () => {
  const model = new MockLanguageModelV4({ doGenerate: {
    content: [{ type: "text", text: JSON.stringify({ suggestion: { kind: "merge", title: "Combined idea", body: "One idea across fragments", sourceIds: ["n1", "n2"], targetId: null } }) }],
    finishReason: { unified: "stop" }, usage: { inputTokens: { total: 12 }, outputTokens: { total: 8 } }, warnings: [],
  } });
  const result = await generateCompanionDiscovery({ ...input, model, signal: new AbortController().signal });
  expect(result.suggestion.sourceIds).toEqual([candidates[0].id, candidates[1].id]);
  expect(model.doGenerateCalls).toHaveLength(1);
  const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
  for (const note of candidates) expect(prompt).not.toContain(note.id);
  expect(prompt).toContain("untrusted DATA");
});
