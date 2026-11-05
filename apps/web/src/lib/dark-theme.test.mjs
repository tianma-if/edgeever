import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { contrastRatio } from "./color-contrast";
import {
  DEFAULT_CUSTOM_DARK_COLORS,
  DEFAULT_CUSTOM_LIGHT_COLORS,
  MERMAID_THEME_PREFERENCES,
  normalizeMermaidThemePreference,
  resolveMermaidTheme,
} from "../components/ThemeProvider";

const BUILT_IN_EDITOR_THEMES = [
  "minimal-emerald",
  "outline-emerald",
  "wechat-green",
  "modern-mint",
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
    expect(css).toContain("color: hsl(var(--foreground));");
    expect(css).toContain("--workspace-memo-divider: #383a3d;");
    expect(css).toContain(":root.dark .edgeever-workspace-memo-list .edgeever-memo-divider");
    expect(memoCard).toContain("edgeever-memo-divider");
    expect(memoCard).not.toContain("dark:lg:border-slate-300");
    expect(memoCard).not.toContain("dark:lg:border-slate-300/70");
  });

  test("components do not add a second dark: color path on top of theme tokens", () => {
    const css = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");
    const notebookPane = readFileSync(new URL("../components/NotebookPane.tsx", import.meta.url), "utf8");
    const companion = readFileSync(new URL("../components/CompanionActionCard.tsx", import.meta.url), "utf8");
    const badge = readFileSync(new URL("../components/ui/badge.tsx", import.meta.url), "utf8");

    expect(css).not.toContain('[class~="bg-white"]');
    expect(css).not.toContain('[class~="bg-slate-50"]');
    expect(css).not.toContain('[class~="text-slate-700"]');
    expect(css).not.toContain("--dark-utility-alpha");
    expect(notebookPane).not.toContain("dark:bg-slate-");
    expect(companion).not.toContain("dark:text-slate-");
    expect(badge).not.toContain("dark:bg-slate-");
  });

  test("workspace dark surfaces stay neutral and bundled editor themes blend into the canvas", () => {
    const css = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");

    expect(css).toContain("--workspace-canvas: #121315;");
    expect(css).toContain("--workspace-sidebar: #17181a;");
    expect(css).toContain("--workspace-memo-list: #1d1e20;");
    expect(css).toContain("--workspace-editor: #222325;");
    expect(css).toContain("--workspace-selection: #333638;");
    expect(css).toContain("--workspace-hover: color-mix(in srgb, var(--workspace-sidebar) 90%, white);");
    expect(css).toContain("--slate-500-rgb: 161 161 161;");
    expect(css).toContain(':not([data-editor-theme="custom"])');
    expect(css).toContain("--editor-theme-bg: var(--workspace-editor);");
    expect(contrastRatio("#dedede", "#222325")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#a3a3a3", "#222325")).toBeGreaterThanOrEqual(4.5);
  });

  test("dark chrome uses workspace tokens instead of leftover blue-slate", () => {
    const css = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");

    expect(css).toContain("--tooltip-bg: #303234;");
    expect(css).toContain("--scrollbar-thumb: rgb(145 145 145 / 0.38);");
    expect(css).toContain("--search-match: rgb(22 160 110 / 0.32);");
    expect(css).toContain(":root.dark .ProseMirror .edgeever-mermaid-preview");
    expect(css).toContain("background: var(--workspace-editor);");
    expect(css).toContain("border-color: var(--workspace-divider);");
    expect(css).not.toContain("background: #0f172a;");
    expect(css).not.toContain("border-color: #334155;");
    expect(css).toContain(":root.dark .edgeever-paper");
    expect(css).toContain("--tw-ring-offset-color: var(--workspace-canvas);");
  });

  test("every bundled editor theme has a complete accessible dark palette", () => {
    for (const theme of BUILT_IN_EDITOR_THEMES) {
      const { tokens } = readDarkThemeTokens(theme);

      expect(tokens.bg).toBe("var(--workspace-editor)");
      expect(contrastRatio(tokens.text, "#222325")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.heading, "#222325")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.accent, "#222325")).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(tokens.muted, tokens.soft)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["code-text"], tokens["code-bg"])).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("automatic Mermaid themes follow the resolved appearance", () => {
    expect(resolveMermaidTheme("auto", "light")).toBe("zinc-light");
    expect(resolveMermaidTheme("auto", "dark")).toBe("zinc-dark");
    expect(resolveMermaidTheme("zinc-dark", "light")).toBe("zinc-dark");
  });

  test("maps retired Mermaid preferences to the original brightness", () => {
    expect(MERMAID_THEME_PREFERENCES).toEqual(["auto", "zinc-light", "zinc-dark"]);
    for (const name of ["tokyo-night-light", "catppuccin-latte", "nord-light", "github-light", "solarized-light"]) {
      expect(normalizeMermaidThemePreference(name)).toBe("zinc-light");
    }
    for (const name of ["tokyo-night", "tokyo-night-storm", "catppuccin-mocha", "nord", "dracula", "github-dark", "solarized-dark", "one-dark"]) {
      expect(normalizeMermaidThemePreference(name)).toBe("zinc-dark");
    }
    for (const name of [null, "auto", "unknown", "constructor"]) {
      expect(normalizeMermaidThemePreference(name)).toBe("auto");
    }
  });

  test("appearance changes stay out of the editor React render path", () => {
    const editorPane = readFileSync(new URL("../components/EditorPane.tsx", import.meta.url), "utf8");
    const editorThemeCss = readFileSync(new URL("../styles/editor-themes/base.css", import.meta.url), "utf8");

    expect(editorPane).toContain('data-editor-theme="default"');
    expect(editorPane).toContain("noteProseCssVariables(noteProse)");
    expect(editorPane).not.toContain("useEditorTheme()");
    expect(editorPane).not.toContain("resolvedTheme");
    expect(editorThemeCss).toContain(':root.dark .edgeever-editor[data-editor-theme="custom"]:not([data-editor-theme="default"])');
    expect(editorThemeCss).toContain("--editor-theme-dark-bg");
  });
});
