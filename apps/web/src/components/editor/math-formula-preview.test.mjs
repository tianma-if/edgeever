import { expect, test } from "bun:test";
import { hasMathPlaceholders, renderMathPreview } from "./math-formula-preview.ts";

test("MathLive's unfinished square and root render without becoming valid saved formulas", () => {
  for (const latex of ["e=\\placeholder{}^2", "x^{\\placeholder{}}", "\\sqrt{\\placeholder{}}"] ) {
    expect(hasMathPlaceholders(latex)).toBe(true);
    expect(renderMathPreview(latex, "inline")).toContain('class="katex"');
  }
});

test("completed slots render normally and unknown commands still fail", () => {
  expect(hasMathPlaceholders("e=x^2")).toBe(false);
  expect(renderMathPreview("e=x^2", "inline")).toContain('class="katex"');
  expect(renderMathPreview("\\notARealCommand{}", "inline")).toBe("");
});
