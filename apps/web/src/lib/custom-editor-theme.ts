import { contrastRatio } from "./color-contrast";

export interface ThemeColors {
  background: string;
  text: string;
  muted: string;
  heading: string;
  accent: string;
  soft: string;
  border: string;
}

export interface CustomEditorTheme {
  id: string;
  name: string;
  light: ThemeColors;
  dark: ThemeColors;
  customCss?: string;
}

export const DEFAULT_CUSTOM_LIGHT_COLORS: ThemeColors = {
  background: "#fffdf7",
  text: "#292524",
  muted: "#57534e",
  heading: "#1c1917",
  accent: "#0f766e",
  soft: "#f0fdfa",
  border: "#99f6e4",
};

export const DEFAULT_CUSTOM_DARK_COLORS: ThemeColors = {
  background: "#1c1917",
  text: "#fafaf9",
  muted: "#d6d3d1",
  heading: "#fafaf9",
  accent: "#2dd4bf",
  soft: "#292524",
  border: "#44403c",
};

export const DEFAULT_CUSTOM_EDITOR_THEME: CustomEditorTheme = {
  id: "custom-default",
  name: "My custom theme",
  light: DEFAULT_CUSTOM_LIGHT_COLORS,
  dark: DEFAULT_CUSTOM_DARK_COLORS,
  customCss: "",
};

export const CUSTOM_EDITOR_THEME_FILE_SCHEMA = "edgeever.editor-theme";
export const CUSTOM_EDITOR_THEME_FILE_VERSION = 1;
export const MAX_CUSTOM_EDITOR_THEME_FILE_BYTES = 64 * 1024;
export const MAX_CUSTOM_EDITOR_THEME_CSS_LENGTH = 2000;

const COLOR_FIELDS = ["background", "text", "muted", "heading", "accent", "soft", "border"] as const;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

type PortableCustomEditorTheme = Omit<CustomEditorTheme, "id">;

export type EditorThemeContrastIssue = "text" | "muted" | "heading" | "accent";
export type CustomEditorThemeFileErrorCode = "invalidFile" | "unsupportedVersion" | "fileTooLarge";

export class CustomEditorThemeFileError extends Error {
  readonly code: CustomEditorThemeFileErrorCode;

  constructor(code: CustomEditorThemeFileErrorCode, message: string) {
    super(message);
    this.name = "CustomEditorThemeFileError";
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isValidThemeColors = (value: unknown): value is ThemeColors =>
  isRecord(value) && COLOR_FIELDS.every((field) => typeof value[field] === "string" && HEX_COLOR_PATTERN.test(value[field]));

export const getEditorThemeContrastIssues = (colors: ThemeColors): EditorThemeContrastIssue[] => {
  const issues: EditorThemeContrastIssue[] = [];
  if (contrastRatio(colors.text, colors.background) < 4.5) issues.push("text");
  if (contrastRatio(colors.muted, colors.soft) < 4.5) issues.push("muted");
  if (contrastRatio(colors.heading, colors.background) < 4.5) issues.push("heading");
  if (contrastRatio(colors.accent, colors.background) < 3) issues.push("accent");
  return issues;
};

export const serializeCustomEditorTheme = (theme: CustomEditorTheme) => JSON.stringify({
  schema: CUSTOM_EDITOR_THEME_FILE_SCHEMA,
  version: CUSTOM_EDITOR_THEME_FILE_VERSION,
  name: theme.name,
  light: theme.light,
  dark: theme.dark,
  customCss: theme.customCss ?? "",
}, null, 2);

export const parseCustomEditorThemeFile = (source: string): PortableCustomEditorTheme => {
  if (new TextEncoder().encode(source).byteLength > MAX_CUSTOM_EDITOR_THEME_FILE_BYTES) {
    throw new CustomEditorThemeFileError("fileTooLarge", "Editor theme file is too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new CustomEditorThemeFileError("invalidFile", "Editor theme file must contain valid JSON.");
  }
  if (!isRecord(parsed) || parsed.schema !== CUSTOM_EDITOR_THEME_FILE_SCHEMA) {
    throw new CustomEditorThemeFileError("invalidFile", "Editor theme file has an invalid schema.");
  }
  if (parsed.version !== CUSTOM_EDITOR_THEME_FILE_VERSION) {
    throw new CustomEditorThemeFileError("unsupportedVersion", "Editor theme file version is not supported.");
  }
  if (typeof parsed.name !== "string" || parsed.name.trim().length === 0 || parsed.name.trim().length > 32) {
    throw new CustomEditorThemeFileError("invalidFile", "Editor theme name must contain 1 to 32 characters.");
  }
  if (!isValidThemeColors(parsed.light) || !isValidThemeColors(parsed.dark)) {
    throw new CustomEditorThemeFileError("invalidFile", "Editor theme colors must use six-digit hex values.");
  }
  if (parsed.customCss !== undefined && (typeof parsed.customCss !== "string" || parsed.customCss.length > MAX_CUSTOM_EDITOR_THEME_CSS_LENGTH)) {
    throw new CustomEditorThemeFileError("invalidFile", "Editor theme CSS is invalid or too long.");
  }

  return {
    name: parsed.name.trim(),
    light: parsed.light,
    dark: parsed.dark,
    customCss: parsed.customCss ?? "",
  };
};

export const customEditorThemeFileName = (name: string) => {
  const safeName = name
    .trim()
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 80) || "custom-theme";
  return `EdgeEver-${safeName}.json`;
};
