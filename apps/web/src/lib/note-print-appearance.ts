import {
  NOTE_PROSE_PALETTES,
  noteProseCssVariables,
  noteProseStyleCssVariables,
  type NoteProsePaletteChoice,
  type NoteProseStylePreferences,
  type ResolvedNoteProse,
} from "@edgeever/shared";
import { catalogCodeFontStack, isRemoteNoteImageFont } from "@edgeever/shared/font-catalog-data";
import { LEGACY_BODY_FONTS } from "@edgeever/shared/font-defaults";
import type { BodyFontId } from "@edgeever/shared/font-loader";
import type { MermaidThemeName } from "@/components/ThemeProvider";
import { normalizeMermaidThemePreference, resolveMermaidTheme } from "@/components/ThemeProvider";
import { sanitizeAndScopeCss } from "@/lib/css-sandbox";
import {
  readEditorBodyFontPreference,
  resolveEditorBodyFontStack,
  type EditorBodyFontPreference,
} from "@/lib/editor-body-font";
import {
  DEFAULT_NOTE_PROSE_STYLE_PREFERENCES,
  readNoteProseStylePreference,
} from "@/lib/note-prose-style-preference";

export type NotePrintAppearance = {
  palette: NoteProsePaletteChoice;
  proseStyle?: NoteProseStylePreferences;
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
  proseStyle: NoteProseStylePreferences = readNoteProseStylePreference(),
): NotePrintAppearance => ({
  palette: prose.palette,
  proseStyle,
  cssVariables: { ...noteProseCssVariables(prose), ...noteProseStyleCssVariables(proseStyle) },
  customCss: sanitizeAndScopeCss(prose.customCss),
  fontFamily: resolveEditorBodyFontStack(font) ?? null,
  fontId: loadableBodyFontId(font.choice),
  mermaidTheme: resolveMermaidTheme(normalizeMermaidThemePreference(mermaidTheme), "light"),
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
    ".edgeever-print-content th {",
    `  background: ${colors.accent};`,
    "  color: #ffffff;",
    "  font-weight: 700;",
    "}",
    ".edgeever-print-content th strong,",
    ".edgeever-print-content th b {",
    "  color: #ffffff;",
    "}",
    ".edgeever-print-content td strong,",
    ".edgeever-print-content td b {",
    "  color: #111827;",
    "}",
    ".edgeever-print-content tbody tr:nth-child(even) td {",
    "  background: #f9fafb;",
    "}",
  ].join("\n");
};

const proseStyleRules = (
  palette: NoteProsePaletteChoice,
  proseStyle: NoteProseStylePreferences = DEFAULT_NOTE_PROSE_STYLE_PREFERENCES,
) => {
  const colors = palette === "native" ? null : NOTE_PROSE_PALETTES[palette];
  const accent = colors?.accent ?? "#374151";
  const surface = colors?.surface ?? "#f3f4f6";
  const divider = colors?.divider ?? "#d1d5db";
  const rules: string[] = [];
  if (proseStyle.headingStyle === "bar") {
    rules.push(
      `.edgeever-print-content h2 { border-left: 4px solid ${accent}; padding-left: 10px; }`,
      `.edgeever-print-content h3 { border-left: 3px solid ${accent}; padding-left: 8px; }`,
    );
  } else if (proseStyle.headingStyle === "numbered") {
    rules.push(
      ".edgeever-print-content { counter-reset: note-prose-h2; }",
      ".edgeever-print-content h1 { font-size: calc(var(--editor-body-font-size, 16px) * 1.75); }",
      ".edgeever-print-content h4 { font-size: var(--editor-body-font-size, 16px); }",
      `.edgeever-print-content h2 { font-size: calc(var(--editor-body-font-size, 16px) * 1.4); counter-increment: note-prose-h2; padding-bottom: 6px; border-bottom: 2px solid ${divider}; }`,
      `.edgeever-print-content h2::before { content: counter(note-prose-h2, decimal-leading-zero) " · "; color: ${accent}; font-weight: 800; letter-spacing: 0.04em; }`,
      `.edgeever-print-content h3 { display: block; font-size: calc(var(--editor-body-font-size, 16px) * 1.15); font-weight: 700; line-height: 1.4; letter-spacing: -0.01em; margin: 1.6em 0 0.6em; color: #111827; }`,
    );
  }
  if (proseStyle.quoteStyle === "dashed") {
    rules.push(
      ".edgeever-print-content blockquote { background: #f9fafb; border: 1px dashed #d1d5db; border-radius: 6px; padding: 12px 16px; }",
    );
  } else if (proseStyle.quoteStyle === "accent-bar") {
    rules.push(
      `.edgeever-print-content blockquote { background: ${surface}; border: 0; border-left: 3px solid ${accent}; border-radius: 0 6px 6px 0; padding: 12px 16px; }`,
    );
  } else if (proseStyle.quoteStyle === "minimal-rule") {
    rules.push(
      ".edgeever-print-content blockquote { background: transparent; border: 0; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; border-radius: 0; padding: 12px 4px; }",
    );
  }
  if (proseStyle.emphasisStyle === "marker") {
    rules.push(
      `.edgeever-print-content u { text-decoration: none; border-bottom: 2px solid ${divider}; padding-bottom: 1px; }`,
      ".edgeever-print-content mark { background-color: #fde68a; color: #111827; padding: 1px 4px; border-radius: 2px; }",
    );
  }
  return rules.join("\n");
};

/** Account prose settings for the print page. Values come from the note palette, not from the message text. */
export const notePrintAppearanceCss = (appearance: NotePrintAppearance) => {
  const declarations = Object.entries(appearance.cssVariables)
    .filter(([name, value]) => CSS_VARIABLE_NAME.test(name) && CSS_DECLARATION_VALUE.test(value))
    .map(([name, value]) => `${name}: ${value}`);
  if (appearance.fontFamily && CSS_DECLARATION_VALUE.test(appearance.fontFamily)) {
    declarations.push(`--editor-body-font-family: ${appearance.fontFamily}`);
  }
  const codeStack = catalogCodeFontStack(appearance.fontId);
  if (codeStack) declarations.push(`--editor-code-font-family: ${codeStack}`);
  return [
    `:root { ${declarations.join("; ")}; }`,
    paletteRules(appearance.palette),
    proseStyleRules(appearance.palette, appearance.proseStyle),
    appearance.customCss,
  ]
    .filter(Boolean)
    .join("\n");
};
