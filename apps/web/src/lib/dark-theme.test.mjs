import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { contrastRatio } from "./color-contrast";
import {
  DEFAULT_CUSTOM_DARK_COLORS,
  DEFAULT_CUSTOM_LIGHT_COLORS,
  resolveMermaidTheme,
} from "../components/ThemeProvider";

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
    expect(css).toContain(":root.dark .edgeever-public-share .ProseMirror");
    expect(css).toContain("color: #f8fafc;");
    expect(css).toContain('[class~="divide-slate-100"]');
    expect(css).toContain('[class~="text-emerald-700"]');
  });

  test("Marxico keeps note content legible in dark mode", () => {
    const css = readFileSync(new URL("../styles/editor-themes/marxico.css", import.meta.url), "utf8");

    expect(css).toContain(':root.dark .edgeever-editor[data-editor-theme="marxico"]');
    expect(css).toContain("color: var(--editor-theme-text);");
    expect(contrastRatio("#dce3ea", "#19222b")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#e7edf2", "#19222b")).toBeGreaterThanOrEqual(4.5);
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
