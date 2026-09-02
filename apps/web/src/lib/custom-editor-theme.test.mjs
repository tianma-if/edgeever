import { describe, expect, test } from "bun:test";
import {
  CUSTOM_EDITOR_THEME_FILE_SCHEMA,
  CUSTOM_EDITOR_THEME_FILE_VERSION,
  CustomEditorThemeFileError,
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
    border: "#cbd5e1",
  },
  dark: {
    background: "#111111",
    text: "#f8fafc",
    muted: "#cbd5e1",
    heading: "#ffffff",
    accent: "#34d399",
    soft: "#1f2937",
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
      .toEqual(["text", "accent"]);
  });

  test("creates a filesystem-safe descriptive filename", () => {
    expect(customEditorThemeFileName(theme.name)).toBe("EdgeEver-Calm - Green.json");
  });
});
