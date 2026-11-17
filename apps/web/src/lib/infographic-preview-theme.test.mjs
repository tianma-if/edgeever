import { describe, expect, test } from "bun:test";
import { parseSyntax } from "@antv/infographic";
import { INFOGRAPHIC_SAMPLES } from "./infographic-samples";
import { infographicPreviewSyntax, infographicUsesDarkSheet } from "./infographic-preview-theme";

describe("infographic preview appearance", () => {
  test("adapts every default sample without changing artwork data or the saved syntax", () => {
    for (const sample of INFOGRAPHIC_SAMPLES) {
      for (const syntax of [sample.syntaxZh, sample.syntaxEn]) {
        const original = parseSyntax(syntax);
        const preview = infographicPreviewSyntax(syntax, true);
        const adapted = parseSyntax(preview);
        expect(adapted.errors).toEqual([]);
        expect(adapted.options).toEqual({ ...original.options, theme: "dark" });
        expect(infographicUsesDarkSheet(preview)).toBe(true);
        expect(infographicPreviewSyntax(preview, true)).toBe(preview);
        expect(infographicPreviewSyntax(syntax, false)).toBe(syntax);
        expect(original.options.theme).toBeUndefined();
      }
    }
  });

  test("preserves explicit light, dark, and custom artwork themes", () => {
    for (const theme of ["theme light", "theme dark", "theme\n  colorBg #f5e8d0\n  colorPrimary #a15522"]) {
      const syntax = `infographic sequence-steps-simple\n${theme}\ndata\n  sequences\n    - label Example`;
      expect(infographicPreviewSyntax(syntax, true)).toBe(syntax);
      expect(infographicPreviewSyntax(syntax, false)).toBe(syntax);
      expect(parseSyntax(syntax).errors).toEqual([]);
      expect(infographicUsesDarkSheet(syntax)).toBe(theme === "theme dark");
    }
    expect(infographicPreviewSyntax("", true)).toBe("");
    expect(infographicPreviewSyntax("  \n", true)).toBe("  \n");
  });
});
