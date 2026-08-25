import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { contrastRatio } from "./color-contrast";
import {
  DEFAULT_CUSTOM_DARK_COLORS,
  DEFAULT_CUSTOM_LIGHT_COLORS,
  resolveMermaidTheme,
} from "../components/ThemeProvider";

const BUILT_IN_EDITOR_THEMES = [
  "minimal-emerald",
  "outline-emerald",
  "wechat-green",
  "modern-mint",
  "marxico",
];

const readDarkThemeTokens = (theme) => {
  const css = readFileSync(new URL(`../styles/editor-themes/${theme}.css`, import.meta.url), "utf8");
  const selector = `:root.dark .edgeever-editor[data-editor-theme="${theme}"]:not([data-editor-theme="default"])`;
  const blockStart = css.indexOf(`${selector} {`);
  expect(blockStart).toBeGreaterThanOrEqual(0);
  const blockEnd = css.indexOf("}", blockStart);
  const block = css.slice(blockStart, blockEnd);
  const tokens = Object.fromEntries(
    [...block.matchAll(/--editor-theme-([\w-]+):\s*(#[\da-f]{6}|var\([^;]+\));/gi)].map((match) => [match[1], match[2]])
  );
  return { block, css, tokens };
};

describe("dark theme contracts", () => {
  test("default custom editor themes meet their contrast thresholds", () => {
    for (const colors of [DEFAULT_CUSTOM_LIGHT_COLORS, DEFAULT_CUSTOM_DARK_COLORS]) {
      expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.muted, colors.soft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.heading, colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.accent, colors.background)).toBeGreaterThanOrEqual(3);
    }
  });

  test("public shares and divided surfaces have explicit dark rules", () => {
    const css = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");
    const memoCard = readFileSync(new URL("../components/MemoCard.tsx", import.meta.url), "utf8");
    expect(css).toContain(":root.dark .edgeever-public-share .ProseMirror");
    expect(css).toContain("color: #f8fafc;");
    expect(css).toContain('[class~="divide-slate-100"]');
    expect(css).toContain('[class~="text-emerald-700"]');
    expect(css).toContain("--workspace-memo-divider: #3b4540;");
    expect(css).toContain(":root.dark .edgeever-workspace-memo-list .edgeever-memo-divider");
    expect(memoCard).toContain("edgeever-memo-divider");
    expect(memoCard).not.toContain("dark:lg:border-slate-300");
    expect(memoCard).not.toContain("dark:lg:border-slate-300/70");
  });

  test("workspace dark surfaces stay neutral and bundled editor themes blend into the canvas", () => {
    const css = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");

    expect(css).toContain("--workspace-canvas: #101311;");
    expect(css).toContain("--workspace-sidebar: #121612;");
    expect(css).toContain("--workspace-memo-list: #151a17;");
    expect(css).toContain("--workspace-editor: #191e1b;");
    expect(css).toContain(':not([data-editor-theme="custom"])');
    expect(css).toContain("--editor-theme-bg: var(--workspace-editor);");
    expect(contrastRatio("#cad4ce", "#191e1b")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#9aa9a0", "#191e1b")).toBeGreaterThanOrEqual(4.5);
  });

  test("every bundled editor theme has a complete accessible dark palette", () => {
    for (const theme of BUILT_IN_EDITOR_THEMES) {
      const { tokens } = readDarkThemeTokens(theme);

      expect(tokens.bg).toBe("var(--workspace-editor)");
      expect(contrastRatio(tokens.text, "#191e1b")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.heading, "#191e1b")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.accent, "#191e1b")).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(tokens.muted, tokens.soft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["code-text"], tokens["code-bg"])).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("Marxico keeps note content legible in dark mode", () => {
    const { css, tokens } = readDarkThemeTokens("marxico");

    expect(css).toContain(':root.dark .edgeever-editor[data-editor-theme="marxico"]');
    expect(css).toContain("color: var(--editor-theme-text);");
    expect(contrastRatio(tokens.text, "#191e1b")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.heading, "#191e1b")).toBeGreaterThanOrEqual(4.5);
  });

  test("automatic Mermaid themes follow the resolved appearance", () => {
    expect(resolveMermaidTheme("auto", "light")).toBe("zinc-light");
    expect(resolveMermaidTheme("auto", "dark")).toBe("zinc-dark");
    expect(resolveMermaidTheme("dracula", "light")).toBe("dracula");
  });

  test("appearance changes stay out of the editor React render path", () => {
    const editorPane = readFileSync(new URL("../components/EditorPane.tsx", import.meta.url), "utf8");
    const editorThemeCss = readFileSync(new URL("../styles/editor-themes/base.css", import.meta.url), "utf8");

    expect(editorPane).toContain("useEditorTheme()");
    expect(editorPane).not.toContain("resolvedTheme");
    expect(editorThemeCss).toContain(':root.dark .edgeever-editor[data-editor-theme="custom"]:not([data-editor-theme="default"])');
    expect(editorThemeCss).toContain("--editor-theme-dark-bg");
  });
});
