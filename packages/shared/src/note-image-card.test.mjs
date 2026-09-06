import { describe, expect, test } from "bun:test";
import {
  NOTE_IMAGE_BACKGROUND_COLORS,
  NOTE_IMAGE_THEMES,
  buildImageExportBasename,
  buildNoteImageCardMarkup,
  generateCardCss,
  resolveTheme,
} from "./note-image-card";

describe("note-image-card shared module", () => {
  test("resolves theme correctly with fallbacks", () => {
    expect(resolveTheme(undefined, "notepad")).toBe("notepad");
    expect(resolveTheme(undefined, "xuan")).toBe("xuan");
    expect(resolveTheme("warm", undefined)).toBe("sunset");
    expect(resolveTheme(undefined, undefined)).toBe("slate");
  });

  test("contains all 8 curated themes with valid colors", () => {
    const expectedThemes = ["slate", "aurora", "sunset", "midnight", "mint", "lavender", "notepad", "xuan"];
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

  test("generates notepad theme markup and CSS with tear strip and ruled lines", () => {
    const markup = buildNoteImageCardMarkup({
      title: "Notepad Memo",
      bodyHtml: "<p>Classic note line</p>",
      theme: "notepad",
      fontStyle: "serif",
    });
    expect(markup).toContain("edgeever-card-tear-strip");

    const css = generateCardCss({
      theme: "notepad",
      fontStyle: "serif",
      fontSize: "lg",
      cardWidth: "standard",
    });
    expect(css).toContain("edgeever-card-tear-strip");
    expect(css).toContain("linear-gradient(to bottom, transparent calc(100% - 1px), #e8decb calc(100% - 1px))");
  });

  test("generates terminal header for mono font style", () => {
    const markup = buildNoteImageCardMarkup({
      title: "Code Memo",
      notebook: "TerminalNote",
      bodyHtml: "<p>console.log()</p>",
      theme: "midnight",
      fontStyle: "mono",
    });
    expect(markup).toContain("edgeever-terminal-header");
    expect(markup).toContain("TerminalNote");
  });

  test("sanitizes filenames and guards against reserved Windows names", () => {
    expect(buildImageExportBasename("CON", "fallback")).toBe("_CON");
    expect(buildImageExportBasename("My Note/Title?*", "fallback")).toBe("My Note-Title--");
  });
});
