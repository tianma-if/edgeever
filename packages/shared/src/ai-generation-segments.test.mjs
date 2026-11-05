import { describe, expect, test } from "bun:test";
import {
  aiSegmentTail,
  isAiSegmentResultPlausible,
  isAiSegmentableAction,
  joinAiContinuation,
  joinAiGenerationSegments,
  joinAiSegmentResult,
  resolveAiSegmentSourceTokens,
  splitAiGenerationSegments,
} from "./ai-generation-segments.ts";
import { estimateAiTokens } from "./ai-model-capabilities.ts";

const section = (index) => [
  `## ${index}. Section ${index}`,
  "",
  `${"Paragraph text for this section. ".repeat(20)}`,
  "",
  "- item one",
  "- item two",
  "",
].join("\n");

describe("splitting long notes into parts (#652)", () => {
  test("parts join back to the exact source", () => {
    const source = `# Title\n\n${Array.from({ length: 12 }, (_, index) => section(index + 1)).join("\n")}\n[ref]: https://example.com\n`;
    const parts = splitAiGenerationSegments(source, 400);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.map((part) => part.markdown).join("")).toBe(source);
    for (const part of parts) expect(estimateAiTokens(part.markdown)).toBeLessThanOrEqual(450);
  });

  test("a heading stays with the content after it and the path follows the outline", () => {
    const source = `# Book\n\n${Array.from({ length: 6 }, (_, index) => section(index + 1)).join("\n")}`;
    const parts = splitAiGenerationSegments(source, 250);
    for (const part of parts) {
      const lines = part.markdown.trimEnd().split("\n");
      expect(/^#{1,6}\s/.test(lines.at(-1))).toBe(false);
    }
    const later = parts.find((part) => part.markdown.startsWith("## 3."));
    expect(later?.headingPath).toEqual(["Book"]);
    const inside = parts.find((part) => !part.markdown.startsWith("#") && part.headingPath.length === 2);
    expect(inside?.headingPath[0]).toBe("Book");
  });

  test("code blocks, tables and math are never cut, and code-only parts are passed through", () => {
    const code = `\`\`\`js\n${"const value = 1;\n".repeat(200)}\`\`\`\n\n`;
    const table = `| a | b |\n|---|---|\n${"| cell | cell |\n".repeat(150)}\n`;
    const math = `$$\n${"x^2 + y^2 = z^2. ".repeat(80)}\n$$\n\n`;
    const source = `Intro paragraph.\n\n${code}${table}${math}Outro paragraph.\n`;
    const parts = splitAiGenerationSegments(source, 200);
    expect(parts.map((part) => part.markdown).join("")).toBe(source);
    expect(parts.some((part) => part.markdown === code && part.passthrough)).toBe(true);
    expect(parts.some((part) => part.markdown.includes(table.trim()))).toBe(true);
    expect(parts.some((part) => part.markdown.includes(math.trim()))).toBe(true);
    expect(parts.filter((part) => part.passthrough).every((part) => part.markdown.startsWith("```"))).toBe(true);
  });

  test("front matter is kept as is", () => {
    const source = `---\ntitle: Test\ntags: [a]\n---\n\n${section(1)}`;
    const [first, ...rest] = splitAiGenerationSegments(source, 1000);
    expect(first).toEqual({ markdown: "---\ntitle: Test\ntags: [a]\n---\n\n", headingPath: [], passthrough: true });
    expect(rest.map((part) => part.markdown).join("")).toBe(section(1));
  });

  test("a block that alone is too long is split between list items, then sentences", () => {
    const list = Array.from({ length: 40 }, (_, index) => `- 列表项 ${index}：${"内容".repeat(20)}`).join("\n");
    const listParts = splitAiGenerationSegments(`${list}\n`, 200);
    expect(listParts.length).toBeGreaterThan(1);
    expect(listParts.map((part) => part.markdown).join("")).toBe(`${list}\n`);
    for (const part of listParts) expect(part.markdown.startsWith("- ")).toBe(true);

    const paragraph = "这是一个很长的句子，用来测试分句。".repeat(60);
    const sentenceParts = splitAiGenerationSegments(paragraph, 100);
    expect(sentenceParts.length).toBeGreaterThan(1);
    expect(sentenceParts.map((part) => part.markdown).join("")).toBe(paragraph);
    for (const part of sentenceParts.slice(0, -1)) expect(part.markdown.trimEnd().endsWith("。")).toBe(true);
  });

  test("results go back in place with the source spacing", () => {
    const parts = [{ markdown: "# A\n\nText one.\n\n" }, { markdown: "Text two.\n" }];
    const joined = joinAiGenerationSegments([
      joinAiSegmentResult(parts[0], "# 甲\n\n文本一。\n"),
      joinAiSegmentResult(parts[1], "文本二。"),
    ]);
    expect(joined).toBe("# 甲\n\n文本一。\n\n文本二。");
    expect(aiSegmentTail("x".repeat(1000)).length).toBe(600);
  });
});

describe("deciding when to split (#652)", () => {
  const long = "字".repeat(30_000);
  const plan = (overrides) => ({ mode: "auto", maxOutputTokens: 8192, outputLimit: 8192, inputFits: true, ...overrides });

  test("only source-sized tasks are split", () => {
    expect(isAiSegmentableAction("translate")).toBe(true);
    expect(isAiSegmentableAction("continue-writing")).toBe(false);
    expect(resolveAiSegmentSourceTokens({ action: "continue-writing", sourceText: long, plan: plan() })).toBeNull();
  });

  test("splits when the output would pass the limit and not when it fits", () => {
    const size = resolveAiSegmentSourceTokens({ action: "translate", sourceText: long, plan: plan() });
    expect(size).toBeGreaterThan(0);
    expect(size * 2.5).toBeLessThan(8192 * 0.8);
    expect(resolveAiSegmentSourceTokens({ action: "translate", sourceText: "短文。", plan: plan() })).toBeNull();
    expect(resolveAiSegmentSourceTokens({
      action: "translate", sourceText: long, plan: plan({ outputLimit: 393_216, maxOutputTokens: 80_000 }),
    })).toBeNull();
  });

  test("without known limits long sources are split into fixed-size parts", () => {
    expect(resolveAiSegmentSourceTokens({
      action: "improve-writing", sourceText: long, plan: plan({ mode: "auto-unbounded", outputLimit: null, maxOutputTokens: null }),
    })).toBe(2000);
    expect(resolveAiSegmentSourceTokens({
      action: "improve-writing", sourceText: "字".repeat(1500), plan: plan({ mode: "auto-unbounded", outputLimit: null, maxOutputTokens: null }),
    })).toBeNull();
  });

  test("a manual budget and an input that does not fit both lead to parts", () => {
    expect(resolveAiSegmentSourceTokens({
      action: "translate", sourceText: long, plan: plan({ mode: "manual", maxOutputTokens: 4096 }),
    })).toBeGreaterThan(0);
    const size = resolveAiSegmentSourceTokens({
      action: "translate", sourceText: long, plan: plan({ outputLimit: 393_216, inputFits: false }), inputLimitTokens: 16_000,
    });
    expect(size).toBe(4000);
  });

  test("a part that was cut off is split smaller", () => {
    const part = "字".repeat(3000);
    const size = resolveAiSegmentSourceTokens({ action: "translate", sourceText: part, plan: plan(), depth: 1 });
    expect(size).toBeLessThan(estimateAiTokens(part));
  });
});

describe("continuing a cut-off result (#652)", () => {
  test("repeated text at the seam is dropped", () => {
    expect(joinAiContinuation("First paragraph.\n\nSecond paragraph is cut", "Second paragraph is cut off here.\n\nThird."))
      .toBe("First paragraph.\n\nSecond paragraph is cut off here.\n\nThird.");
  });
  test("a continuation without overlap is appended as is", () => {
    expect(joinAiContinuation("第一段。\n\n第二段写到一半", "，后半句。")).toBe("第一段。\n\n第二段写到一半，后半句。");
    expect(joinAiContinuation("Line one.\n", "Line two.")).toBe("Line one.\nLine two.");
  });
});

describe("part boundaries a model reads well (#652 PR B)", () => {
  test("a short code block stays with the text before it instead of opening the next part", () => {
    const code = "```js\nconst notes = all.filter((note) => note.tags.includes(\"review\"));\n```\n\n";
    const source = Array.from({ length: 8 }, (_, index) => `## ${index + 1}. 节\n\n${"正文内容。".repeat(40)}\n\n${code}`).join("");
    const parts = splitAiGenerationSegments(source, 400);
    expect(parts.map((part) => part.markdown).join("")).toBe(source);
    for (const part of parts) expect(part.markdown.startsWith("```")).toBe(false);
  });

  test("parts prefer to start at a heading once they are well filled", () => {
    const source = Array.from({ length: 10 }, (_, index) => `## ${index + 1}. 节\n\n${"第一段。".repeat(30)}\n\n${"第二段。".repeat(30)}\n\n`).join("");
    const parts = splitAiGenerationSegments(source, 500);
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) expect(part.markdown.startsWith("## ")).toBe(true);
  });
});

describe("a part result that is far too short (#652 PR B)", () => {
  test("is not taken as the part's result", () => {
    const source = `## 30. 节\n\n${"这一段需要被完整处理。".repeat(40)}\n\n## 31. 节\n\n${"这一段也需要。".repeat(40)}`;
    expect(isAiSegmentResultPlausible(source, "只返回了一句话。")).toBe(false);
    expect(isAiSegmentResultPlausible(source, source.replaceAll("需要", "要"))).toBe(true);
    // An English translation of Chinese text has fewer estimated tokens but is still plausible.
    expect(isAiSegmentResultPlausible(source, "This paragraph needs to be processed in full. ".repeat(40) + "This one too. ".repeat(40))).toBe(true);
    // Tiny parts are not judged.
    expect(isAiSegmentResultPlausible("短。", "x")).toBe(true);
  });
});

describe("line endings (#652 PR B review)", () => {
  const lf = Array.from({ length: 16 }, (_, index) => `## ${index + 1}. 节\n\n${"正文内容。".repeat(80)}\n\n- 要点\n- 要点\n`).join("\n");

  test("a CRLF note splits like the LF note and joins back to the exact source", () => {
    const crlf = lf.replaceAll("\n", "\r\n");
    const lfParts = splitAiGenerationSegments(lf, 500);
    const crlfParts = splitAiGenerationSegments(crlf, 500);
    expect(lfParts.length).toBe(16);
    expect(crlfParts.length).toBe(lfParts.length);
    expect(crlfParts.map((part) => part.markdown).join("")).toBe(crlf);
    expect(crlfParts.map((part) => part.markdown.replaceAll("\r\n", "\n"))).toEqual(lfParts.map((part) => part.markdown));
    expect(crlfParts.map((part) => part.headingPath)).toEqual(lfParts.map((part) => part.headingPath));
  });

  test("mixed and lone CR line endings still join back exactly", () => {
    const mixed = lf.split("\n").map((line, index) => line + (index % 3 === 0 ? "\r\n" : index % 3 === 1 ? "\n" : "\r")).join("");
    const parts = splitAiGenerationSegments(mixed, 500);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.markdown).join("")).toBe(mixed);
  });

  test("front matter with CRLF is kept as is", () => {
    const source = "---\r\ntitle: x\r\n---\r\n\r\n" + lf.replaceAll("\n", "\r\n");
    const [first] = splitAiGenerationSegments(source, 500);
    expect(first).toEqual({ markdown: "---\r\ntitle: x\r\n---\r\n\r\n", headingPath: [], passthrough: true });
  });
});
