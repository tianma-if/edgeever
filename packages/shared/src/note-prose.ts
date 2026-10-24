export const NOTE_PROSE_FONT_SIZES = [14, 16, 18, 20] as const;
export type NoteProseFontSize = (typeof NOTE_PROSE_FONT_SIZES)[number];
export const DEFAULT_NOTE_PROSE_FONT_SIZE: NoteProseFontSize = 16;

export const NOTE_PROSE_LINE_HEIGHTS = [1.5, 1.65, 2] as const;
export type NoteProseLineHeight = (typeof NOTE_PROSE_LINE_HEIGHTS)[number];
export const DEFAULT_NOTE_PROSE_LINE_HEIGHT: NoteProseLineHeight = 1.65;

export const NOTE_PROSE_PALETTE_IDS = [
  "clay",
  "dawn",
  "teal",
  "azure",
  "violet",
  "pink",
  "slate",
] as const;
export type NoteProsePaletteId = (typeof NOTE_PROSE_PALETTE_IDS)[number];

export const NOTE_PROSE_PALETTE_CHOICES = ["native", ...NOTE_PROSE_PALETTE_IDS] as const;
export type NoteProsePaletteChoice = (typeof NOTE_PROSE_PALETTE_CHOICES)[number];

export const MAX_NOTE_PROSE_CSS_BYTES = 8 * 1024;
export const NOTE_PROSE_PARAGRAPH_SPACING_PX = 8;

export const NOTE_PROSE_HEADING_SCALE = {
  h1: 1.5,
  h2: 1.25,
  h3: 1.125,
  h4: 1.0625,
  h5: 1,
  h6: 0.9375,
} as const;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export type NoteProseCustomColorSet = {
  background: string;
  text: string;
  muted: string;
  heading: string;
  accent: string;
  soft: string;
  codeBackground: string;
  border: string;
};

export type NoteProseCustomColors = {
  light: NoteProseCustomColorSet;
  dark: NoteProseCustomColorSet;
};

export type NoteProsePaletteColors = {
  accent: string;
  text: string;
  muted: string;
  surface: string;
  divider: string;
  link: string;
  codeBackground: string;
  codeText: string;
  background: string;
};

export type AccountNoteProse = {
  fontSize: NoteProseFontSize | null;
  lineHeight: NoteProseLineHeight | null;
  palette: NoteProsePaletteChoice | null;
  customCss: string | null;
  customColors: NoteProseCustomColors | null;
};

export type ResolvedNoteProse = {
  fontSize: NoteProseFontSize;
  lineHeight: NoteProseLineHeight;
  palette: NoteProsePaletteChoice;
  customCss: string;
  customColors: NoteProseCustomColors | null;
};

export type PublicNoteProse = {
  fontSize: NoteProseFontSize;
  lineHeight: NoteProseLineHeight;
  palette: NoteProsePaletteChoice;
  customCss: string;
  customColors: NoteProseCustomColors | null;
};

export type NoteProsePatch = {
  fontSize?: NoteProseFontSize | null;
  lineHeight?: NoteProseLineHeight | null;
  palette?: NoteProsePaletteChoice | null;
  customCss?: string | null;
  customColors?: NoteProseCustomColors | null;
};

const CUSTOM_COLOR_FIELDS = [
  "background",
  "text",
  "muted",
  "heading",
  "accent",
  "soft",
  "codeBackground",
  "border",
] as const;

const palette = (colors: NoteProsePaletteColors): NoteProsePaletteColors => colors;

export const NOTE_PROSE_PALETTES: Record<NoteProsePaletteId, NoteProsePaletteColors> = {
  clay: palette({
    accent: "#FF4C01",
    text: "#3A2E28",
    muted: "#746055",
    surface: "#FFFCFA",
    divider: "#F6D5C6",
    link: "#C63C00",
    codeBackground: "#FFF4EE",
    codeText: "#C63C00",
    background: "#FFFFFF",
  }),
  dawn: palette({
    accent: "#8A6716",
    text: "#3D2A1B",
    muted: "#74613C",
    surface: "#FFFDF8",
    divider: "#F0E3BD",
    link: "#7C5500",
    codeBackground: "#FFFAF0",
    codeText: "#7C5500",
    background: "#FFFFFF",
  }),
  teal: palette({
    accent: "#20AD9D",
    text: "#3E4C4A",
    muted: "#5C6E6B",
    surface: "#F2FBFA",
    divider: "#CDEFEA",
    link: "#14796E",
    codeBackground: "#ECFBF8",
    codeText: "#14796E",
    background: "#FFFFFF",
  }),
  azure: palette({
    accent: "#2663EB",
    text: "#374151",
    muted: "#4B5563",
    surface: "#F5F8FC",
    divider: "#D7E8FF",
    link: "#1D64C7",
    codeBackground: "#EEF6FF",
    codeText: "#1D64C7",
    background: "#FFFFFF",
  }),
  violet: palette({
    accent: "#7351CF",
    text: "#3F3F46",
    muted: "#3F3F46",
    surface: "#F4F4F5",
    divider: "#E1DEFF",
    link: "#5B4EE0",
    codeBackground: "#F3F1FF",
    codeText: "#5B4EE0",
    background: "#FFFFFF",
  }),
  pink: palette({
    accent: "#BB456E",
    text: "#3A2E34",
    muted: "#746068",
    surface: "#FFFCFD",
    divider: "#F3D0DC",
    link: "#BE185D",
    codeBackground: "#FDF2F6",
    codeText: "#BE185D",
    background: "#FFFFFF",
  }),
  slate: palette({
    accent: "#796B7C",
    text: "#5C505E",
    muted: "#5C505E",
    surface: "#FAFAFA",
    divider: "#E0DBE1",
    link: "#6B5C6D",
    codeBackground: "#F5F4F6",
    codeText: "#6B5C6D",
    background: "#FFFFFF",
  }),
};

// Dark reading surfaces need lighter accents than the white-background palette.
export const NOTE_PROSE_DARK_ACCENTS: Record<NoteProsePaletteId, string> = {
  clay: "#FF996E",
  dawn: "#D9B65C",
  teal: "#70C7B8",
  azure: "#8CB4F0",
  violet: "#B39AE8",
  pink: "#E794B0",
  slate: "#BCACBF",
};

const LEGACY_EDITOR_THEME_PALETTES: Record<string, NoteProsePaletteChoice> = {
  letter: "dawn",
  stub: "dawn",
  brief: "teal",
  zen: "teal",
  guide: "azure",
  blueprint: "azure",
  stance: "clay",
  outline: "violet",
  journal: "slate",
};

export const DEFAULT_NOTE_PROSE_CUSTOM_COLORS: NoteProseCustomColors = {
  light: {
    background: "#fffdf7",
    text: "#292524",
    muted: "#57534e",
    heading: "#1c1917",
    accent: "#0f766e",
    soft: "#f0fdfa",
    codeBackground: "#e0ece9",
    border: "#99f6e4",
  },
  dark: {
    background: "#1c1917",
    text: "#fafaf9",
    muted: "#d6d3d1",
    heading: "#fafaf9",
    accent: "#2dd4bf",
    soft: "#292524",
    codeBackground: "#3a3635",
    border: "#44403c",
  },
};

export const parseNoteProseFontSize = (value: unknown): NoteProseFontSize | null =>
  (NOTE_PROSE_FONT_SIZES as readonly unknown[]).includes(value) ? value as NoteProseFontSize : null;

export const parseNoteProseLineHeight = (value: unknown): NoteProseLineHeight | null => {
  if (typeof value === "number" && (NOTE_PROSE_LINE_HEIGHTS as readonly number[]).includes(value)) {
    return value as NoteProseLineHeight;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized === "1.5" || normalized === "1.50") return 1.5;
  if (normalized === "1.65") return 1.65;
  if (normalized === "2" || normalized === "2.0" || normalized === "2.00") return 2;
  return null;
};

export const parseNoteProsePalette = (value: unknown): NoteProsePaletteChoice | null => {
  // Red and orange now share the existing red identifier for older clients.
  if (value === "orange") return "clay";
  // Removed palettes and the custom color editor read as native.
  if (value === "emerald" || value === "green" || value === "plum" || value === "custom") return "native";
  return typeof value === "string" && (NOTE_PROSE_PALETTE_CHOICES as readonly string[]).includes(value)
    ? value as NoteProsePaletteChoice
    : null;
};

const isColorSet = (value: unknown): value is NoteProseCustomColorSet => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return CUSTOM_COLOR_FIELDS.every((field) => typeof record[field] === "string" && HEX_COLOR_PATTERN.test(record[field]));
};

export const parseNoteProseCustomColors = (value: unknown): NoteProseCustomColors | null => {
  let parsed = value;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as { light?: unknown; dark?: unknown };
  if (!isColorSet(record.light) || !isColorSet(record.dark)) return null;
  return { light: record.light, dark: record.dark };
};

export const paletteForLegacyEditorTheme = (theme: string | null | undefined): NoteProsePaletteChoice | null => {
  if (!theme || theme === "default" || theme === "marxico") return null;
  const mapped = LEGACY_EDITOR_THEME_PALETTES[theme];
  if (mapped) return mapped;
  return null;
};

export const noteProseCodeFontSize = (fontSize: number): number => {
  const index = NOTE_PROSE_FONT_SIZES.indexOf(fontSize as NoteProseFontSize);
  if (index > 0) return NOTE_PROSE_FONT_SIZES[index - 1];
  if (index === 0) return 12;
  return Math.max(12, Math.round(fontSize) - 2);
};

export const resolveNoteProse = (account: Partial<AccountNoteProse> | null | undefined): ResolvedNoteProse => ({
  fontSize: account?.fontSize ?? DEFAULT_NOTE_PROSE_FONT_SIZE,
  lineHeight: account?.lineHeight ?? DEFAULT_NOTE_PROSE_LINE_HEIGHT,
  palette: parseNoteProsePalette(account?.palette) ?? "native",
  customCss: account?.customCss ?? "",
  customColors: account?.customColors ?? null,
});

export const publicNoteProseFromAccount = (account: Partial<AccountNoteProse> | null | undefined): PublicNoteProse => {
  const resolved = resolveNoteProse(account);
  return {
    fontSize: resolved.fontSize,
    lineHeight: resolved.lineHeight,
    palette: resolved.palette,
    customCss: resolved.customCss,
    customColors: null,
  };
};

export type NoteProseAccountRow = {
  note_prose_font_size: number | null;
  note_prose_line_height: string | null;
  note_prose_palette: string | null;
  note_prose_custom_css: string | null;
  note_prose_custom_colors: string | null;
};

export const accountNoteProseFromRow = (row: NoteProseAccountRow | null | undefined): AccountNoteProse => ({
  fontSize: parseNoteProseFontSize(row?.note_prose_font_size),
  lineHeight: parseNoteProseLineHeight(row?.note_prose_line_height),
  palette: parseNoteProsePalette(row?.note_prose_palette),
  customCss: row?.note_prose_custom_css ?? null,
  customColors: parseNoteProseCustomColors(row?.note_prose_custom_colors),
});

export const noteProseMigrationPatch = (
  account: AccountNoteProse,
  local: {
    palette: NoteProsePaletteChoice | null;
    customCss: string | null;
    customColors: NoteProseCustomColors | null;
  },
): NoteProsePatch => {
  const patch: NoteProsePatch = {};
  const palette = parseNoteProsePalette(local.palette);
  if (account.palette == null && palette && palette !== "native") {
    patch.palette = palette;
  }
  if (account.customCss == null && local.customCss?.trim()) {
    patch.customCss = local.customCss;
  }
  return patch;
};

export const noteProsePaletteColors = (prose: Pick<ResolvedNoteProse, "palette" | "customColors">): NoteProsePaletteColors | null => {
  if (prose.palette === "native") return null;
  return NOTE_PROSE_PALETTES[prose.palette];
};

export const noteProseCssVariables = (prose: ResolvedNoteProse): Record<string, string> => {
  const variables: Record<string, string> = {
    "--editor-body-font-size": `${prose.fontSize}px`,
    "--editor-body-line-height": String(prose.lineHeight),
    "--editor-paragraph-spacing": `${NOTE_PROSE_PARAGRAPH_SPACING_PX}px`,
    "--editor-code-font-size": `${noteProseCodeFontSize(prose.fontSize)}px`,
  };
  const colors = noteProsePaletteColors(prose);
  if (!colors) return variables;
  variables["--note-palette-accent"] = colors.accent;
  variables["--note-palette-light-accent"] = colors.accent;
  if (prose.palette !== "native") {
    variables["--note-palette-dark-accent"] = NOTE_PROSE_DARK_ACCENTS[prose.palette];
  }
  variables["--note-palette-text"] = colors.text;
  variables["--note-palette-muted"] = colors.muted;
  variables["--note-palette-surface"] = colors.surface;
  variables["--note-palette-divider"] = colors.divider;
  variables["--note-palette-link"] = colors.link;
  variables["--note-palette-code-bg"] = colors.codeBackground;
  variables["--note-palette-code-text"] = colors.codeText;
  variables["--note-palette-bg"] = colors.background;
  return variables;
};
