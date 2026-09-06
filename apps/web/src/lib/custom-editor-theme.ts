import { contrastRatio } from "./color-contrast";

export interface ThemeColors {
  background: string;
  text: string;
  muted: string;
  heading: string;
  accent: string;
  soft: string;
  codeBackground: string;
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
  codeBackground: "#e0ece9",
  border: "#99f6e4",
};

export const DEFAULT_CUSTOM_DARK_COLORS: ThemeColors = {
  background: "#1c1917",
  text: "#fafaf9",
  muted: "#d6d3d1",
  heading: "#fafaf9",
  accent: "#2dd4bf",
  soft: "#292524",
  codeBackground: "#3a3635",
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

const LEGACY_COLOR_FIELDS = ["background", "text", "muted", "heading", "accent", "soft", "border"] as const;
const COLOR_FIELDS = [...LEGACY_COLOR_FIELDS, "codeBackground"] as const;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

type PortableCustomEditorTheme = Omit<CustomEditorTheme, "id">;

export type EditorThemeContrastIssue = "text" | "muted" | "heading" | "accent" | "codeBackground";
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

// Follow the existing palette: darken light quote surfaces and lighten dark ones.
const deriveCodeBackground = (soft: string, text: string) => `#${[1, 3, 5].map((offset) =>
  Math.round(Number.parseInt(soft.slice(offset, offset + 2), 16) * 0.92
    + Number.parseInt(text.slice(offset, offset + 2), 16) * 0.08).toString(16).padStart(2, "0"),
).join("")}`;

export const normalizeThemeColors = (value: Partial<ThemeColors> | undefined, fallback: ThemeColors): ThemeColors => {
  const colors = { ...fallback };
  for (const field of COLOR_FIELDS) {
    const color = value?.[field];
    if (typeof color === "string" && HEX_COLOR_PATTERN.test(color)) colors[field] = color;
  }
  if (typeof value?.codeBackground !== "string" || !HEX_COLOR_PATTERN.test(value.codeBackground)) {
    colors.codeBackground = deriveCodeBackground(colors.soft, colors.text);
  }
  return colors;
};

const isValidImportedThemeColors = (value: unknown): value is Partial<ThemeColors> =>
  isRecord(value)
  && LEGACY_COLOR_FIELDS.every((field) => typeof value[field] === "string" && HEX_COLOR_PATTERN.test(value[field]))
  && (value.codeBackground === undefined || (typeof value.codeBackground === "string" && HEX_COLOR_PATTERN.test(value.codeBackground)));

export const getEditorThemeContrastIssues = (colors: ThemeColors): EditorThemeContrastIssue[] => {
  const issues: EditorThemeContrastIssue[] = [];
  if (contrastRatio(colors.text, colors.background) < 4.5) issues.push("text");
  if (contrastRatio(colors.muted, colors.soft) < 4.5) issues.push("muted");
  if (contrastRatio(colors.heading, colors.background) < 4.5) issues.push("heading");
  if (contrastRatio(colors.accent, colors.background) < 3) issues.push("accent");
  if (contrastRatio(colors.text, colors.codeBackground) < 4.5) issues.push("codeBackground");
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
  if (!isValidImportedThemeColors(parsed.light) || !isValidImportedThemeColors(parsed.dark)) {
    throw new CustomEditorThemeFileError("invalidFile", "Editor theme colors must use six-digit hex values.");
  }
  if (parsed.customCss !== undefined && (typeof parsed.customCss !== "string" || parsed.customCss.length > MAX_CUSTOM_EDITOR_THEME_CSS_LENGTH)) {
    throw new CustomEditorThemeFileError("invalidFile", "Editor theme CSS is invalid or too long.");
  }

  return {
    name: parsed.name.trim(),
    light: normalizeThemeColors(parsed.light, DEFAULT_CUSTOM_LIGHT_COLORS),
    dark: normalizeThemeColors(parsed.dark, DEFAULT_CUSTOM_DARK_COLORS),
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
