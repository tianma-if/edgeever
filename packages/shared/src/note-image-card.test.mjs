import { describe, expect, test } from "bun:test";
import {
  NOTE_IMAGE_BACKGROUND_COLORS,
  NOTE_IMAGE_THEMES,
  NOTE_IMAGE_THEME_OPTIONS,
  NOTE_IMAGE_FONT_FAMILIES,
  resolveNoteImageTypography,
  buildImageExportBasename,
  buildNoteImageCardMarkup,
  estimateReadingStats,
  generateCardCss,
  resolveTheme,
} from "./note-image-card";

describe("note-image-card shared module", () => {
  test("resolves theme correctly with fallbacks", () => {
    expect(resolveTheme(undefined, "editorial")).toBe("editorial");
    expect(resolveTheme(undefined, "terminal")).toBe("terminal");
    expect(resolveTheme(undefined, "film")).toBe("film");
    expect(resolveTheme(undefined, "notepad")).toBe("editorial");
    expect(resolveTheme(undefined, "xuan")).toBe("editorial");
    expect(resolveTheme(undefined, "polaroid")).toBe("film");
    expect(resolveTheme("warm", undefined)).toBe("sunset");
    expect(resolveTheme(undefined, undefined)).toBe("mint");
  });

  test("retired themes resolve to active choices in both legacy inputs", () => {
    expect(NOTE_IMAGE_THEME_OPTIONS).toHaveLength(7);
    for (const [legacy, active] of [["midnight", "terminal"], ["lavender", "mint"]]) {
      expect(NOTE_IMAGE_THEME_OPTIONS).not.toContain(legacy);
      expect(resolveTheme(undefined, legacy)).toBe(active);
      expect(resolveTheme(legacy)).toBe(active);
      const css = generateCardCss({ theme: legacy, fontStyle: "auto", fontSize: "md", cardWidth: "standard" });
      expect(css).toContain(NOTE_IMAGE_THEMES[active].canvasBg);
      const markup = buildNoteImageCardMarkup({ title: "Legacy", bodyHtml: "<p>Content</p>", theme: legacy });
      expect(markup).toContain(`data-theme="${active}"`);
    }
  });

  test("theme typography pairs headings and body while explicit fonts override both", () => {
    for (const theme of NOTE_IMAGE_THEME_OPTIONS) {
      const auto = resolveNoteImageTypography(theme);
      expect(auto.bodyFamily).toBe(NOTE_IMAGE_FONT_FAMILIES[theme === "film" || theme === "sunset" ? "serif" : "sans"]);
      expect(auto.headingFamily).toBe(NOTE_IMAGE_FONT_FAMILIES[theme === "editorial" ? "serif" : theme === "terminal" ? "mono" : theme === "film" || theme === "sunset" ? "serif" : "sans"]);
      for (const fontStyle of ["sans", "serif", "mono"]) {
        const manual = resolveNoteImageTypography(theme, fontStyle);
        expect(manual.bodyFamily).toBe(NOTE_IMAGE_FONT_FAMILIES[fontStyle]);
        expect(manual.headingFamily).toBe(NOTE_IMAGE_FONT_FAMILIES[fontStyle]);
        const css = generateCardCss({ theme, fontStyle, fontSize: "md", cardWidth: "standard" });
        expect(css).toContain(`--ee-heading-font-family: ${manual.headingFamily}`);
        expect(css).not.toMatch(/\n\s+font-family: "Songti SC"/);
      }
    }
  });

  test("manual mono font does not add terminal decoration to a light theme", () => {
    const markup = buildNoteImageCardMarkup({ title: "Paper", bodyHtml: "<p>Content</p>", theme: "slate", fontStyle: "mono" });
    expect(markup).not.toContain("edgeever-terminal-header");
  });

  test("retains valid colors for current themes and legacy slate exports", () => {
    const expectedThemes = ["slate", "aurora", "sunset", "midnight", "editorial", "terminal", "film", "mint", "lavender"];
    for (const theme of expectedThemes) {
      expect(NOTE_IMAGE_THEMES[theme]).toBeDefined();
      expect(NOTE_IMAGE_BACKGROUND_COLORS[theme]).toBeDefined();
      expect(NOTE_IMAGE_THEMES[theme].cardBg).toBeDefined();
      expect(NOTE_IMAGE_THEMES[theme].textColor).toBeDefined();
    }
  });

  test("generates rich card markup with title, date, and official EdgeEver logo badge", () => {
    const markup = buildNoteImageCardMarkup({
      title: "Shared Card Title",
      notebook: "Work",
      tags: ["feature", "design"],
      updatedAt: "2026-08-22",
      bodyHtml: "<p>Note body text</p>",
      theme: "slate",
      fontStyle: "serif",
      showTitle: true,
      showNotebook: false,
      showTags: false,
      showUpdatedAt: true,
      showBranding: true,
    });

    expect(markup).toContain("Shared Card Title");
    expect(markup).toContain("2026-08-22");
    expect(markup).toContain("edgeever-brand-logo");
    expect(markup).toContain("EdgeEver");
    expect(markup).not.toContain("edgeever-meta-notebook");
    expect(markup).not.toContain("edgeever-meta-tag");
  });

  test("generates editorial theme card with distinct borders and styling", () => {
    const markup = buildNoteImageCardMarkup({
      title: "Editorial Dispatch",
      bodyHtml: "<p>Deep analytical reporting on modern engineering.</p>",
      theme: "editorial",
      fontStyle: "serif",
      showTitle: true,
      author: "@tianma",
      showAuthor: true,
    });
    expect(markup).toContain('data-theme="editorial"');
    expect(markup).toContain("@tianma");

    const css = generateCardCss({
      theme: "editorial",
      fontStyle: "serif",
      fontSize: "md",
      cardWidth: "standard",
    });
    expect(css).toContain('data-theme="editorial"');
    expect(css).toContain("box-shadow: 6px 6px 0px #111827");
  });

  test("generates terminal header for the terminal theme", () => {
    const markup = buildNoteImageCardMarkup({
      title: "Code Memo",
      notebook: "TerminalNote",
      bodyHtml: "<p>console.log()</p>",
      theme: "terminal",
      fontStyle: "mono",
    });
    expect(markup).toContain("edgeever-terminal-header");
    expect(markup).toContain("TerminalNote");

    const css = generateCardCss({
      theme: "terminal",
      fontStyle: "mono",
      fontSize: "md",
      cardWidth: "standard",
    });
    expect(css).toContain('data-theme="terminal"');
  });

  test("generates film theme card with custom author and reading time", () => {
    const markup = buildNoteImageCardMarkup({
      title: "Memories in Summer",
      notebook: "Journal",
      bodyHtml: "<p>A quick reflection on building delightful software.</p>",
      theme: "film",
      fontStyle: "serif",
      showTitle: true,
      showReadingTime: true,
      author: "@tianma",
      showAuthor: true,
      showBranding: true,
    });

    expect(markup).toContain("edgeever-grain-overlay");
    expect(markup).toContain('data-theme="film"');
    expect(markup).toContain("@tianma");
    expect(markup).toContain("edgeever-footer-author");
    expect(markup).toContain("edgeever-meta-reading");

    const css = generateCardCss({
      theme: "film",
      fontStyle: "serif",
      fontSize: "md",
      cardWidth: "standard",
    });
    expect(css).toContain('data-theme="film"');
    expect(css).toContain("edgeever-grain-overlay");
  });

  test("calculates reading stats for mixed Chinese and English text", () => {
    const stats = estimateReadingStats("<p>这里是中文内容五十字。</p><p>Some english words here.</p>");
    expect(stats.totalCount).toBeGreaterThan(0);
    expect(stats.minutes).toBeGreaterThanOrEqual(1);
  });

  test("sanitizes filenames and guards against reserved Windows names", () => {
    expect(buildImageExportBasename("CON", "fallback")).toBe("_CON");
    expect(buildImageExportBasename("My Note/Title?*", "fallback")).toBe("My Note-Title--");
  });
});
