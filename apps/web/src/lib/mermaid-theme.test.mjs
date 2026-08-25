import { describe, expect, test } from "bun:test";
import { renderMermaidSVG, THEMES } from "beautiful-mermaid";
import { MERMAID_THEME_PALETTES } from "../components/ThemeProvider";
import { contrastRatio } from "./color-contrast";
import { getOfficialMermaidThemeVariables } from "./mermaid-theme";

const SEQUENCE_SOURCE = `sequenceDiagram
  participant User as 用户
  participant App as 客户端
  User->>App: 保存笔记
  App-->>User: 保存成功`;

describe("official Mermaid theme variables", () => {
  test("maps every built-in theme across flowchart, sequence, and state diagrams", () => {
    for (const palette of Object.values(MERMAID_THEME_PALETTES)) {
      const variables = getOfficialMermaidThemeVariables(palette);
      const expectedAccent = palette.accent ?? palette.line ?? palette.fg;
      const expectedLine = palette.line ?? palette.muted ?? palette.fg;
      const expectedBorder = palette.border ?? palette.muted ?? expectedAccent;

      expect(variables.background).toBe(palette.bg);
      expect(variables.primaryTextColor).toBe(palette.fg);
      expect(variables.clusterBorder).toBe(expectedBorder);
      expect(variables.actorBorder).toBe(expectedBorder);
      expect(variables.signalColor).toBe(expectedAccent);
      expect(variables.stateBorder).toBe(expectedBorder);
      expect(variables.transitionColor).toBe(expectedLine);
    }
  });

  test("keeps the zinc light theme coherent", () => {
    const palette = MERMAID_THEME_PALETTES["zinc-light"];
    const variables = getOfficialMermaidThemeVariables(palette);

    expect(variables.background).toBe(palette.bg);
    expect(variables.primaryColor).toBe(palette.bg);
    expect(variables.primaryBorderColor).toBe(palette.muted);
    expect(variables.signalColor).toBe(palette.accent);
  });

  test("keeps primary and secondary diagram text readable in every theme", () => {
    for (const [theme, palette] of Object.entries(MERMAID_THEME_PALETTES)) {
      expect(contrastRatio(palette.fg, palette.bg), `${theme} primary text`).toBeGreaterThanOrEqual(4.5);
      expect(palette.muted, `${theme} secondary text color`).toBeDefined();
      expect(contrastRatio(palette.muted, palette.bg), `${theme} secondary text`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("applies the accessible text palette when every theme renders a sequence diagram", () => {
    for (const [theme, palette] of Object.entries(MERMAID_THEME_PALETTES)) {
      const svg = renderMermaidSVG(SEQUENCE_SOURCE, {
        ...THEMES[theme],
        ...palette,
        transparent: true,
      });

      expect(svg, `${theme} rendered SVG`).toContain(`--bg:${palette.bg}`);
      expect(svg, `${theme} rendered SVG`).toContain(`--fg:${palette.fg}`);
      expect(svg, `${theme} rendered SVG`).toContain(`--muted:${palette.muted}`);
      expect(svg, `${theme} message text`).toContain('fill="var(--_text-muted)"');
    }
  });
});
