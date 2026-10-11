import katex from "katex";
import type { MathFormulaKind } from "./math-formula";

export const hasMathPlaceholders = (latex: string) => /\\placeholder\b/.test(latex);

export const renderMathPreview = (latex: string, kind: MathFormulaKind) => {
  if (!latex.trim()) return "";
  try {
    return katex.renderToString(latex.trim(), {
      displayMode: kind === "block",
      throwOnError: true,
      strict: "warn",
      trust: false,
      // MathLive emits this command for slots still being edited. It is only
      // supported in the preview; unfinished formulas must not be saved.
      macros: { "\\placeholder": "\\boxed{\\phantom{x#1}}" },
    });
  } catch {
    return "";
  }
};
