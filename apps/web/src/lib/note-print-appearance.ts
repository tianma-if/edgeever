import {
  NOTE_PROSE_PALETTES,
  noteProseCssVariables,
  type NoteProsePaletteChoice,
  type ResolvedNoteProse,
} from "@edgeever/shared";
import { isRemoteNoteImageFont } from "@edgeever/shared/font-catalog-data";
import { LEGACY_BODY_FONTS } from "@edgeever/shared/font-defaults";
import type { BodyFontId } from "@edgeever/shared/font-loader";
import type { MermaidThemeName } from "@/components/ThemeProvider";
import { MERMAID_THEME_NAMES } from "@/components/ThemeProvider";
import { sanitizeAndScopeCss } from "@/lib/css-sandbox";
import {
  readEditorBodyFontPreference,
  resolveEditorBodyFontStack,
  type EditorBodyFontPreference,
} from "@/lib/editor-body-font";

export type NotePrintAppearance = {
  palette: NoteProsePaletteChoice;
  cssVariables: Record<string, string>;
  customCss: string;
  fontFamily: string | null;
  fontId: BodyFontId | null;
  mermaidTheme: MermaidThemeName;
};

const CSS_VARIABLE_NAME = /^--[a-z0-9-]+$/i;
const CSS_DECLARATION_VALUE = /^[^;{}]+$/;

const loadableBodyFontId = (choice: string): BodyFontId | null => {
  if (choice === "system" || choice === "custom") return null;
  if (isRemoteNoteImageFont(choice) || Object.hasOwn(LEGACY_BODY_FONTS, choice)) return choice as BodyFontId;
  return null;
};

export const notePrintAppearanceFromProse = (
  prose: ResolvedNoteProse,
  mermaidTheme: string,
  font: EditorBodyFontPreference = readEditorBodyFontPreference(),
): NotePrintAppearance => ({
  palette: prose.palette,
  cssVariables: noteProseCssVariables(prose),
  customCss: sanitizeAndScopeCss(prose.customCss),
  fontFamily: resolveEditorBodyFontStack(font) ?? null,
  fontId: loadableBodyFontId(font.choice),
  mermaidTheme: (MERMAID_THEME_NAMES as readonly string[]).includes(mermaidTheme)
    ? mermaidTheme as MermaidThemeName
    : "zinc-light",
});

const paletteRules = (palette: NoteProsePaletteChoice) => {
  if (palette === "native") return "";
  const colors = NOTE_PROSE_PALETTES[palette];
  if (!colors) return "";
  return [
    ".edgeever-print-content a:not(.edgeever-attachment-link):not([href*=\"/api/v1/resources/\"]) {",
    `  color: ${colors.link};`,
    `  text-decoration-color: color-mix(in srgb, ${colors.link} 45%, transparent);`,
    "}",
    ".edgeever-print-content strong,",
    ".edgeever-print-content b {",
    `  color: ${colors.accent};`,
    "}",
    ".edgeever-print-content ul[data-type=\"taskList\"] li[data-checked] > label input {",
    `  accent-color: ${colors.accent};`,
    "}",
  ].join("\n");
};

/** Account prose settings for the print page. Values come from the note palette, not from the message text. */
export const notePrintAppearanceCss = (appearance: NotePrintAppearance) => {
  const declarations = Object.entries(appearance.cssVariables)
    .filter(([name, value]) => CSS_VARIABLE_NAME.test(name) && CSS_DECLARATION_VALUE.test(value))
    .map(([name, value]) => `${name}: ${value}`);
  if (appearance.fontFamily && CSS_DECLARATION_VALUE.test(appearance.fontFamily)) {
    declarations.push(`--editor-body-font-family: ${appearance.fontFamily}`);
  }
  return [`:root { ${declarations.join("; ")}; }`, paletteRules(appearance.palette), appearance.customCss]
    .filter(Boolean)
    .join("\n");
};
