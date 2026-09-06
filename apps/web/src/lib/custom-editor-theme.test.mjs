import { describe, expect, test } from "bun:test";
import {
  CUSTOM_EDITOR_THEME_FILE_SCHEMA,
  CUSTOM_EDITOR_THEME_FILE_VERSION,
  CustomEditorThemeFileError,
  DEFAULT_CUSTOM_LIGHT_COLORS,
  DEFAULT_CUSTOM_DARK_COLORS,
  normalizeThemeColors,
  customEditorThemeFileName,
  getEditorThemeContrastIssues,
  parseCustomEditorThemeFile,
  serializeCustomEditorTheme,
} from "./custom-editor-theme.ts";

const theme = {
  id: "custom-local-only",
  name: "Calm / Green",
  light: {
    background: "#ffffff",
    text: "#111111",
    muted: "#444444",
    heading: "#000000",
    accent: "#087f5b",
    soft: "#f1f5f9",
    codeBackground: "#e2e8f0",
    border: "#cbd5e1",
  },
  dark: {
    background: "#111111",
    text: "#f8fafc",
    muted: "#cbd5e1",
    heading: "#ffffff",
    accent: "#34d399",
    soft: "#1f2937",
    codeBackground: "#303b49",
    border: "#475569",
  },
  customCss: "h1 { font-style: italic; }",
};

describe("custom editor theme files", () => {
  test("round-trips a versioned theme without exporting its local id", () => {
    const serialized = serializeCustomEditorTheme(theme);
    const document = JSON.parse(serialized);

    expect(document.schema).toBe(CUSTOM_EDITOR_THEME_FILE_SCHEMA);
    expect(document.version).toBe(CUSTOM_EDITOR_THEME_FILE_VERSION);
    expect(document.id).toBeUndefined();
    expect(parseCustomEditorThemeFile(serialized)).toEqual({
      name: theme.name,
      light: theme.light,
      dark: theme.dark,
      customCss: theme.customCss,
    });
  });

  test("migrates old version 1 files using each mode's existing palette", () => {
    const legacy = JSON.parse(serializeCustomEditorTheme(theme));
    delete legacy.light.codeBackground;
    delete legacy.dark.codeBackground;
    const imported = parseCustomEditorThemeFile(JSON.stringify(legacy));
    for (const [mode, fallback] of [["light", DEFAULT_CUSTOM_LIGHT_COLORS], ["dark", DEFAULT_CUSTOM_DARK_COLORS]]) {
      const normalized = normalizeThemeColors(legacy[mode], fallback);
      expect(imported[mode]).toEqual(normalized);
      expect(normalized.codeBackground).toMatch(/^#[0-9a-f]{6}$/);
      expect(normalized.codeBackground).not.toBe(normalized.soft);
      for (const field of Object.keys(legacy[mode])) expect(normalized[field]).toBe(legacy[mode][field]);
    }
    expect(imported.light.codeBackground).not.toBe(imported.dark.codeBackground);
  });

  test("preserves chosen code backgrounds and rejects malformed imported values", () => {
    expect(normalizeThemeColors(theme.light, DEFAULT_CUSTOM_LIGHT_COLORS)).toEqual(theme.light);
    for (const invalid of ["red", "", null, 123]) {
      const document = JSON.parse(serializeCustomEditorTheme(theme));
      document.dark.codeBackground = invalid;
      expect(() => parseCustomEditorThemeFile(JSON.stringify(document))).toThrow(CustomEditorThemeFileError);
    }
  });

  test("warns when code text is unreadable on its own background", () => {
    expect(getEditorThemeContrastIssues({ ...theme.light, codeBackground: theme.light.text })).toEqual(["codeBackground"]);
  });

  test("rejects invalid colors and unsupported versions", () => {
    const invalidColor = JSON.parse(serializeCustomEditorTheme(theme));
    invalidColor.light.text = "red";
    expect(() => parseCustomEditorThemeFile(JSON.stringify(invalidColor))).toThrow(CustomEditorThemeFileError);

    const unsupported = JSON.parse(serializeCustomEditorTheme(theme));
    unsupported.version = 2;
    try {
      parseCustomEditorThemeFile(JSON.stringify(unsupported));
      throw new Error("Expected an unsupported version error");
    } catch (error) {
      expect(error).toBeInstanceOf(CustomEditorThemeFileError);
      expect(error.code).toBe("unsupportedVersion");
    }
  });

  test("reports low contrast without making the theme structurally invalid", () => {
    expect(getEditorThemeContrastIssues({ ...theme.light, text: "#fefefe", accent: "#eeeeee" }))
      .toEqual(["text", "accent", "codeBackground"]);
  });

  test("creates a filesystem-safe descriptive filename", () => {
    expect(customEditorThemeFileName(theme.name)).toBe("EdgeEver-Calm - Green.json");
  });
});
