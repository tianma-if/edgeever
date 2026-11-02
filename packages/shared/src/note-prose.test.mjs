import { describe, expect, test } from "bun:test";
import {
  MAX_NOTE_PROSE_CSS_BYTES,
  NOTE_PROSE_PALETTES,
  NOTE_PROSE_PALETTE_CHOICES,
  NOTE_PROSE_DARK_ACCENTS,
  NOTE_PROSE_HEADING_STYLES,
  NOTE_PROSE_QUOTE_STYLES,
  NOTE_PROSE_EMPHASIS_STYLES,
  accountNoteProseFromRow,
  publicNoteProseFromAccount,
  noteProseCssVariables,
  NoteProseUpdateSchema,
  noteProseCodeFontSize,
  noteProseMigrationPatch,
  paletteForLegacyEditorTheme,
  parseNoteProsePalette,
  parseNoteProseHeadingStyle,
  parseNoteProseQuoteStyle,
  parseNoteProseEmphasisStyle,
  resolveNoteProse,
  DEFAULT_NOTE_PROSE_CSS,
  noteProseCssDropsDeclarations,
  sanitizeNoteProseCss,
} from "@edgeever/shared";

const emptyAccount = () => ({
  fontSize: null,
  lineHeight: null,
  palette: null,
  customCss: null,
  customColors: null,
});

describe("note prose", () => {
  test("merges old red and orange choices without dropping account or public share preferences", () => {
    expect(NOTE_PROSE_PALETTE_CHOICES).toContain("clay");
    expect(NOTE_PROSE_PALETTE_CHOICES).not.toContain("orange");
    for (const oldPalette of ["clay", "orange"]) {
      const account = accountNoteProseFromRow({ note_prose_palette: oldPalette });
      expect(account.palette).toBe("clay");
      expect(resolveNoteProse(account).palette).toBe("clay");
      expect(publicNoteProseFromAccount(account).palette).toBe("clay");
      expect(NoteProseUpdateSchema.parse({ palette: oldPalette }).palette).toBe("clay");
    }
    expect(noteProseMigrationPatch(emptyAccount(), { palette: "orange", customCss: null, customColors: null }))
      .toEqual({ palette: "clay" });
  });

  test("checks reading contrast with intentional bright teal and vermilion emphasis exceptions", () => {
    const luminance = (hex) => {
      const channels = [1, 3, 5].map((offset) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (foreground, background) => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
      return (values[1] + 0.05) / (values[0] + 0.05);
    };
    for (const [id, colors] of Object.entries(NOTE_PROSE_PALETTES)) {
      for (const background of ["#FFFFFF", "#F8FAFB"]) {
        // Bright emphasis is intentional; links and code retain normal-text AA.
        const minimumAccentContrast = id === "teal" ? 2.5 : id === "clay" || id === "emerald" ? 3 : 4.5;
        expect(contrast(colors.accent, background)).toBeGreaterThanOrEqual(minimumAccentContrast);
        for (const foreground of [colors.link, colors.codeText]) {
          expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const background of ["#222325", "#333638"]) {
        expect(contrast(NOTE_PROSE_DARK_ACCENTS[id], background)).toBeGreaterThanOrEqual(4.5);
      }
      const variables = noteProseCssVariables(resolveNoteProse({ palette: id }));
      expect(variables["--note-palette-accent"]).toBe(colors.accent);
      expect(variables["--note-palette-dark-accent"]).toBe(NOTE_PROSE_DARK_ACCENTS[id]);
    }
    expect(noteProseCssVariables(resolveNoteProse({ palette: "native" })))
      .not.toHaveProperty("--note-palette-dark-accent");
  });

  test("maps retired editor themes onto color names and leaves the native theme unset", () => {
    expect(paletteForLegacyEditorTheme("stance")).toBe("clay");
    expect(paletteForLegacyEditorTheme("stub")).toBe("dawn");
    expect(paletteForLegacyEditorTheme("letter")).toBe("dawn");
    expect(paletteForLegacyEditorTheme("grove")).toBeNull();
    expect(paletteForLegacyEditorTheme("minimal-emerald")).toBeNull();
    expect(paletteForLegacyEditorTheme("outline-emerald")).toBeNull();
    expect(paletteForLegacyEditorTheme("wechat-green")).toBeNull();
    expect(paletteForLegacyEditorTheme("modern-mint")).toBeNull();
    expect(parseNoteProsePalette("emerald")).toBe("emerald");
    expect(NoteProseUpdateSchema.safeParse({ palette: "emerald" }).success).toBe(true);
    expect(parseNoteProsePalette("green")).toBe("native");
    expect(NoteProseUpdateSchema.safeParse({ palette: "green" }).success).toBe(false);
    expect(parseNoteProsePalette("plum")).toBe("native");
    expect(NoteProseUpdateSchema.safeParse({ palette: "plum" }).success).toBe(false);
    expect(resolveNoteProse({ palette: "emerald" }).palette).toBe("emerald");
    expect(NOTE_PROSE_HEADING_STYLES).toEqual(["default", "bar", "numbered"]);
    expect(NOTE_PROSE_QUOTE_STYLES).toEqual(["default", "dashed", "accent-bar", "minimal-rule"]);
    expect(NOTE_PROSE_EMPHASIS_STYLES).toEqual(["default", "marker"]);
    expect(parseNoteProseHeadingStyle("numbered")).toBe("numbered");
    expect(parseNoteProseHeadingStyle("unknown")).toBeNull();
    expect(parseNoteProseQuoteStyle("dashed")).toBe("dashed");
    expect(parseNoteProseQuoteStyle("unknown")).toBeNull();
    expect(parseNoteProseEmphasisStyle("marker")).toBe("marker");
    expect(parseNoteProseEmphasisStyle("unknown")).toBeNull();
    expect(paletteForLegacyEditorTheme("brief")).toBe("teal");
    expect(paletteForLegacyEditorTheme("zen")).toBe("teal");
    expect(paletteForLegacyEditorTheme("guide")).toBe("azure");
    expect(paletteForLegacyEditorTheme("blueprint")).toBe("azure");
    expect(paletteForLegacyEditorTheme("outline")).toBe("violet");
    expect(paletteForLegacyEditorTheme("journal")).toBe("slate");
    expect(paletteForLegacyEditorTheme("default")).toBeNull();
    expect(paletteForLegacyEditorTheme("marxico")).toBeNull();
    expect(paletteForLegacyEditorTheme("custom-default")).toBeNull();
    expect(parseNoteProsePalette("custom")).toBe("native");
    expect(resolveNoteProse({ palette: "custom" }).palette).toBe("native");
    expect(paletteForLegacyEditorTheme("not-a-theme")).toBeNull();
  });

  test("steps code one preset below the body size", () => {
    expect(noteProseCodeFontSize(14)).toBe(12);
    expect(noteProseCodeFontSize(16)).toBe(14);
    expect(noteProseCodeFontSize(18)).toBe(16);
    expect(noteProseCodeFontSize(20)).toBe(18);
  });

  test("drops font size, line height, and urls from account CSS", () => {
    const css = sanitizeNoteProseCss("p { color: red; font-size: 40px; line-height: 3; margin: 1em 0; background: url(https://evil.test/a.png); } @import 'x';");
    expect(css).toContain("color: red");
    expect(css).toContain("margin: 1em 0");
    expect(css).not.toContain("font-size");
    expect(css).not.toContain("line-height");
    expect(css).not.toContain("url(");
    expect(css).not.toContain("@import");
  });

  test("fills only account fields that were never set", () => {
    expect(noteProseMigrationPatch(emptyAccount(), {
      palette: "teal",
      customCss: "p { color: red; }",
      customColors: null,
    })).toEqual({
      palette: "teal",
      customCss: "p { color: red; }",
    });

    expect(noteProseMigrationPatch({
      ...emptyAccount(),
      palette: "native",
      customCss: "",
    }, {
      palette: "clay",
      customCss: "h1 { letter-spacing: 0.04em; }",
      customColors: null,
    })).toEqual({});

    expect(noteProseMigrationPatch(emptyAccount(), {
      palette: "custom",
      customCss: "   ",
      customColors: null,
    })).toEqual({});
  });

  test("ships a light and dark starter sheet without font size or line height", () => {
    expect(DEFAULT_NOTE_PROSE_CSS).toContain("/* 正文。text-indent 是首行缩进，margin-bottom 是段距。 */");
    expect(DEFAULT_NOTE_PROSE_CSS).toContain("text-indent: 0;");
    expect(DEFAULT_NOTE_PROSE_CSS).toContain("/* 深色 · 标题 */");
    expect(DEFAULT_NOTE_PROSE_CSS).toContain("color: #212121;");
    expect(DEFAULT_NOTE_PROSE_CSS).toContain("color: #dee3e0;");
    expect(DEFAULT_NOTE_PROSE_CSS).not.toContain("font-size");
    expect(DEFAULT_NOTE_PROSE_CSS).not.toContain("line-height");
    const sanitized = sanitizeNoteProseCss(DEFAULT_NOTE_PROSE_CSS);
    expect(sanitized).toContain(":root.dark p");
    expect(sanitized).toContain("color: #dee3e0");
    expect(DEFAULT_NOTE_PROSE_CSS.indexOf(":root.dark p")).toBeGreaterThan(DEFAULT_NOTE_PROSE_CSS.indexOf("p {"));
    expect(DEFAULT_NOTE_PROSE_CSS.indexOf(":root.dark p")).toBeLessThan(DEFAULT_NOTE_PROSE_CSS.indexOf("/* 一级标题 */"));
    expect(DEFAULT_NOTE_PROSE_CSS.indexOf(":root.dark a")).toBeGreaterThan(DEFAULT_NOTE_PROSE_CSS.indexOf("\na {"));
    expect(DEFAULT_NOTE_PROSE_CSS.indexOf(":root.dark a")).toBeLessThan(DEFAULT_NOTE_PROSE_CSS.indexOf("/* 粗体 */"));
    expect(noteProseCssDropsDeclarations(DEFAULT_NOTE_PROSE_CSS)).toBe(false);
    expect(noteProseCssDropsDeclarations("p { color: red; }")).toBe(false);
    expect(noteProseCssDropsDeclarations("p { font-size: 18px; color: red; }")).toBe(true);
    expect(noteProseCssDropsDeclarations("p { line-height: 2; }")).toBe(true);
    expect(noteProseCssDropsDeclarations("p { color: red; } /* font-size: 1px */")).toBe(false);
    expect(noteProseCssDropsDeclarations('@import "x.css"; p { color: red; }')).toBe(true);
    expect(new TextEncoder().encode(DEFAULT_NOTE_PROSE_CSS).byteLength).toBeLessThan(MAX_NOTE_PROSE_CSS_BYTES);
  });

  test("rejects a stylesheet larger than 8 KB", () => {
    expect(NoteProseUpdateSchema.safeParse({
      customCss: "p { color: red; }",
    }).success).toBe(true);
    expect(NoteProseUpdateSchema.safeParse({
      customCss: "a".repeat(MAX_NOTE_PROSE_CSS_BYTES + 1),
    }).success).toBe(false);
    expect(NoteProseUpdateSchema.safeParse({}).success).toBe(false);
    expect(MAX_NOTE_PROSE_CSS_BYTES).toBe(8192);
  });
});
