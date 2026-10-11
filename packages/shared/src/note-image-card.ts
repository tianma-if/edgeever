export type NoteImageFormat = "jpeg" | "png";
export type NoteImageTheme = "slate" | "aurora" | "sunset" | "midnight" | "editorial" | "terminal" | "film" | "mint" | "lavender";
export type NoteImageBackground = NoteImageTheme | "warm" | "notepad" | "xuan" | "polaroid";
export type NoteImageFontStyle = "auto" | "sans" | "serif" | "mono";
export const NOTE_IMAGE_THEME_OPTIONS = ["slate", "mint", "aurora", "sunset", "editorial", "film", "terminal"] as const;
export type NoteImageFontSize = "sm" | "md" | "lg";
export type NoteImageCardWidth = "compact" | "standard" | "wide";

export const NOTE_IMAGE_EXPORT_WIDTH = 768;
export const NOTE_IMAGE_EXPORT_PIXEL_RATIO = 2;

export const NOTE_IMAGE_CARD_WIDTH_PIXELS: Record<NoteImageCardWidth, number> = {
  compact: 560,
  standard: 680,
  wide: 800,
};

/** Bound a complete note card to dimensions that native WebViews can rasterize. */
export const planNativeNoteImageRender = (width: number, height: number) => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid note image dimensions");
  }

  const sourceScale = Math.min(1, 15_000 / height);
  if (sourceScale < 0.5) throw new Error("NOTE_IMAGE_TOO_LONG");

  const sourceWidth = Math.max(1, Math.floor(width * sourceScale));
  const sourceHeight = Math.max(1, Math.floor(height * sourceScale));
  const pixelRatio = Math.min(
    2,
    15_000 / sourceHeight,
    Math.sqrt(12_000_000 / (sourceWidth * sourceHeight)),
  );

  return { pixelRatio, sourceHeight, sourceScale, sourceWidth };
};

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export const NOTE_IMAGE_BACKGROUND_COLORS: Record<NoteImageBackground, string> = {
  slate: "#f8fafc",
  aurora: "#a7f3d0",
  sunset: "#fde68a",
  midnight: "#090d16",
  editorial: "#f1f3f5",
  terminal: "#0d1117",
  film: "#f4ede4",
  mint: "#ecfdf5",
  notepad: "#fbf7ee",
  xuan: "#f7f6f2",
  lavender: "#f5f3ff",
  polaroid: "#f5f4ef",
  warm: "#fffbeb",
};

export type ThemeStyleConfig = {
  canvasBg: string;
  cardBg: string;
  cardBorder: string;
  cardShadow: string;
  textColor: string;
  headingColor: string;
  metaColor: string;
  metaBg: string;
  metaBorder: string;
  accentColor: string;
  accentSubtle: string;
  linkBg: string;
  dividerColor: string;
  codeBg: string;
  codeBorder: string;
  codeColor: string;
  quoteBg: string;
  quoteBorder: string;
  tableThBg: string;
  tableBorder: string;
  brandText: string;
  brandMark: string;
  isDark?: boolean;
};

export const NOTE_IMAGE_THEMES: Record<NoteImageTheme, ThemeStyleConfig> = {
  slate: {
    canvasBg: "#ffffff",
    cardBg: "#ffffff",
    cardBorder: "1px solid #e2e8f0",
    cardShadow: "none",
    textColor: "#1e293b",
    headingColor: "#0f172a",
    metaColor: "#64748b",
    metaBg: "#f8fafc",
    metaBorder: "#e2e8f0",
    accentColor: "#16a06e",
    accentSubtle: "rgba(22, 160, 110, 0.16)",
    linkBg: "rgba(22, 160, 110, 0.08)",
    dividerColor: "#e2e8f0",
    codeBg: "#f8fafc",
    codeBorder: "#e2e8f0",
    codeColor: "#0f172a",
    quoteBg: "rgba(240, 253, 244, 0.7)",
    quoteBorder: "#10b981",
    tableThBg: "#f8fafc",
    tableBorder: "#e2e8f0",
    brandText: "#07130b",
    brandMark: "#16a06e",
  },
  aurora: {
    canvasBg: "linear-gradient(135deg, #a7f3d0 0%, #67e8f9 40%, #c4b5fd 100%)",
    cardBg: "rgba(255, 255, 255, 0.96)",
    cardBorder: "1px solid rgba(255, 255, 255, 0.95)",
    cardShadow: "0 24px 60px -12px rgba(14, 165, 233, 0.28), 0 4px 16px rgba(0, 0, 0, 0.04)",
    textColor: "#1e293b",
    headingColor: "#0f172a",
    metaColor: "#475569",
    metaBg: "rgba(241, 245, 249, 0.85)",
    metaBorder: "rgba(203, 213, 225, 0.7)",
    accentColor: "#0d9488",
    accentSubtle: "rgba(13, 148, 136, 0.18)",
    linkBg: "rgba(13, 148, 136, 0.09)",
    dividerColor: "rgba(226, 232, 240, 0.8)",
    codeBg: "rgba(248, 250, 252, 0.95)",
    codeBorder: "rgba(226, 232, 240, 0.8)",
    codeColor: "#0f172a",
    quoteBg: "rgba(240, 253, 250, 0.85)",
    quoteBorder: "#14b8a6",
    tableThBg: "#f1f5f9",
    tableBorder: "#cbd5e1",
    brandText: "#0f172a",
    brandMark: "#0d9488",
  },
  sunset: {
    canvasBg: "linear-gradient(135deg, #fde68a 0%, #fbcfe8 45%, #fed7aa 100%)",
    cardBg: "#fffdfa",
    cardBorder: "1px solid rgba(253, 230, 138, 0.7)",
    cardShadow: "0 24px 60px -12px rgba(244, 63, 94, 0.18), 0 4px 16px rgba(0, 0, 0, 0.03)",
    textColor: "#292524",
    headingColor: "#1c1917",
    metaColor: "#78716c",
    metaBg: "rgba(254, 243, 199, 0.75)",
    metaBorder: "rgba(253, 230, 138, 0.8)",
    accentColor: "#ea580c",
    accentSubtle: "rgba(234, 88, 12, 0.15)",
    linkBg: "rgba(234, 88, 12, 0.08)",
    dividerColor: "rgba(254, 215, 170, 0.7)",
    codeBg: "#fffbeb",
    codeBorder: "#fde68a",
    codeColor: "#1c1917",
    quoteBg: "rgba(255, 247, 237, 0.85)",
    quoteBorder: "#f97316",
    tableThBg: "#fef3c7",
    tableBorder: "#fde68a",
    brandText: "#1c1917",
    brandMark: "#ea580c",
  },
  midnight: {
    canvasBg: "linear-gradient(135deg, #090d16 0%, #0f172a 50%, #1e1b4b 100%)",
    cardBg: "#131b2e",
    cardBorder: "1px solid rgba(255, 255, 255, 0.14)",
    cardShadow: "0 24px 60px -12px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.08)",
    textColor: "#cbd5e1",
    headingColor: "#f8fafc",
    metaColor: "#94a3b8",
    metaBg: "rgba(30, 41, 59, 0.85)",
    metaBorder: "rgba(51, 65, 85, 0.8)",
    accentColor: "#34d399",
    accentSubtle: "rgba(52, 211, 153, 0.2)",
    linkBg: "rgba(52, 211, 153, 0.12)",
    dividerColor: "rgba(51, 65, 85, 0.7)",
    codeBg: "#0b1120",
    codeBorder: "#1e293b",
    codeColor: "#e2e8f0",
    quoteBg: "rgba(16, 185, 129, 0.12)",
    quoteBorder: "#34d399",
    tableThBg: "#1e293b",
    tableBorder: "#334155",
    brandText: "#f8fafc",
    brandMark: "#34d399",
    isDark: true,
  },
  mint: {
    canvasBg: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 50%, #a7f3d0 100%)",
    cardBg: "#ffffff",
    cardBorder: "1px solid rgba(167, 243, 208, 0.85)",
    cardShadow: "0 20px 50px -15px rgba(16, 185, 129, 0.2), 0 4px 16px rgba(16, 185, 129, 0.06)",
    textColor: "#134e4a",
    headingColor: "#042f2e",
    metaColor: "#0f766e",
    metaBg: "#ccfbf1",
    metaBorder: "#99f6e4",
    accentColor: "#059669",
    accentSubtle: "rgba(5, 150, 105, 0.18)",
    linkBg: "rgba(5, 150, 105, 0.1)",
    dividerColor: "#a7f3d0",
    codeBg: "#f0fdf4",
    codeBorder: "#a7f3d0",
    codeColor: "#064e3b",
    quoteBg: "rgba(236, 253, 245, 0.85)",
    quoteBorder: "#10b981",
    tableThBg: "#ccfbf1",
    tableBorder: "#99f6e4",
    brandText: "#042f2e",
    brandMark: "#059669",
  },
  lavender: {
    canvasBg: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 50%, #ddd6fe 100%)",
    cardBg: "#ffffff",
    cardBorder: "1px solid rgba(221, 214, 254, 0.85)",
    cardShadow: "0 20px 48px -12px rgba(124, 58, 237, 0.16), 0 2px 8px rgba(124, 58, 237, 0.04)",
    textColor: "#1e1b4b",
    headingColor: "#0f0a2e",
    metaColor: "#6b21a8",
    metaBg: "#f5f3ff",
    metaBorder: "#ddd6fe",
    accentColor: "#7c3aed",
    accentSubtle: "rgba(124, 58, 237, 0.18)",
    linkBg: "rgba(124, 58, 237, 0.08)",
    dividerColor: "#e9d5ff",
    codeBg: "#faf5ff",
    codeBorder: "#e9d5ff",
    codeColor: "#4c1d95",
    quoteBg: "rgba(245, 243, 255, 0.85)",
    quoteBorder: "#8b5cf6",
    tableThBg: "#f5f3ff",
    tableBorder: "#ddd6fe",
    brandText: "#1e1b4b",
    brandMark: "#7c3aed",
  },
  editorial: {
    canvasBg: "linear-gradient(145deg, #f1f3f5 0%, #e9ecef 50%, #dee2e6 100%)",
    cardBg: "#ffffff",
    cardBorder: "1px solid #111827",
    cardShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 20px 40px -8px rgba(0, 0, 0, 0.12)",
    textColor: "#1f2937",
    headingColor: "#111827",
    metaColor: "#4b5563",
    metaBg: "#f3f4f6",
    metaBorder: "#111827",
    accentColor: "#111827",
    accentSubtle: "rgba(17, 24, 39, 0.15)",
    linkBg: "rgba(17, 24, 39, 0.06)",
    dividerColor: "#111827",
    codeBg: "#f9fafb",
    codeBorder: "#d1d5db",
    codeColor: "#111827",
    quoteBg: "#f9fafb",
    quoteBorder: "#111827",
    tableThBg: "#f3f4f6",
    tableBorder: "#d1d5db",
    brandText: "#111827",
    brandMark: "#111827",
  },
  terminal: {
    canvasBg: "linear-gradient(145deg, #0d1117 0%, #161b22 60%, #090d13 100%)",
    cardBg: "#0d1117",
    cardBorder: "1px solid #30363d",
    cardShadow: "0 0 0 1px rgba(0, 255, 170, 0.15), 0 24px 60px -12px rgba(0, 0, 0, 0.95)",
    textColor: "#c9d1d9",
    headingColor: "#58a6ff",
    metaColor: "#8b949e",
    metaBg: "#161b22",
    metaBorder: "#30363d",
    accentColor: "#6ee7b7",
    accentSubtle: "rgba(0, 240, 160, 0.2)",
    linkBg: "rgba(0, 240, 160, 0.1)",
    dividerColor: "#21262d",
    codeBg: "#161b22",
    codeBorder: "#30363d",
    codeColor: "#6ee7b7",
    quoteBg: "rgba(88, 166, 255, 0.08)",
    quoteBorder: "#58a6ff",
    tableThBg: "#161b22",
    tableBorder: "#30363d",
    brandText: "#f0f6fc",
    brandMark: "#00f0a0",
    isDark: true,
  },
  film: {
    canvasBg: "linear-gradient(145deg, #f4ede4 0%, #eaddcf 50%, #dfd0bf 100%)",
    cardBg: "#fcfbf9",
    cardBorder: "1px solid rgba(197, 168, 137, 0.8)",
    cardShadow: "0 2px 4px rgba(60, 45, 30, 0.04), 0 16px 36px -6px rgba(60, 45, 30, 0.11), 0 32px 64px -12px rgba(60, 45, 30, 0.08)",
    textColor: "#292524",
    headingColor: "#1c1917",
    metaColor: "#78716c",
    metaBg: "#f5eee6",
    metaBorder: "#e7d9cb",
    accentColor: "#ea580c",
    accentSubtle: "rgba(234, 88, 12, 0.15)",
    linkBg: "rgba(234, 88, 12, 0.08)",
    dividerColor: "#e7d9cb",
    codeBg: "#f5eee6",
    codeBorder: "#e7d9cb",
    codeColor: "#9a3412",
    quoteBg: "rgba(254, 243, 199, 0.6)",
    quoteBorder: "#d97706",
    tableThBg: "#f5eee6",
    tableBorder: "#e7d9cb",
    brandText: "#1c1917",
    brandMark: "#ea580c",
  },
};

export const NOTE_IMAGE_FONT_FAMILIES: Record<Exclude<NoteImageFontStyle, "auto">, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  serif: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", "STSong", "Hiragino Mincho ProN", Georgia, "Times New Roman", serif',
  mono: '"JetBrains Mono", "SF Mono", "Fira Code", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
};

/** Theme typography is shared by previews, Web exports and native WebViews. */
export const resolveNoteImageTypography = (theme: NoteImageTheme, fontStyle: NoteImageFontStyle = "auto") => {
  const resolvedTheme = resolveTheme(undefined, theme);
  const bodyStyle = fontStyle === "auto"
    ? (resolvedTheme === "film" || resolvedTheme === "sunset" ? "serif" : "sans")
    : fontStyle;
  const headingStyle = fontStyle === "auto"
    ? (resolvedTheme === "editorial" ? "serif" : resolvedTheme === "terminal" ? "mono" : bodyStyle)
    : bodyStyle;
  return {
    bodyFamily: NOTE_IMAGE_FONT_FAMILIES[bodyStyle],
    headingFamily: NOTE_IMAGE_FONT_FAMILIES[headingStyle],
    headingWeight: headingStyle === "serif" ? 700 : 720,
    lineHeightAdjustment: bodyStyle === "serif" ? 0.08 : bodyStyle === "mono" ? 0.02 : 0,
  };
};

export const NOTE_IMAGE_FONT_SIZES: Record<
  NoteImageFontSize,
  {
    base: string;
    lineHeight: string;
    title: string;
    h1: string;
    h2: string;
    h3: string;
    h4: string;
    h5: string;
    h6: string;
    meta: string;
    code: string;
  }
> = {
  sm: {
    base: "14.5px",
    lineHeight: "1.72",
    title: "28px",
    h1: "21px",
    h2: "18px",
    h3: "16px",
    h4: "15px",
    h5: "14.5px",
    h6: "14.5px",
    meta: "12px",
    code: "12.5px",
  },
  md: {
    base: "16px",
    lineHeight: "1.8",
    title: "32px",
    h1: "24px",
    h2: "20px",
    h3: "17.5px",
    h4: "16.5px",
    h5: "16px",
    h6: "16px",
    meta: "13px",
    code: "13.5px",
  },
  lg: {
    base: "18px",
    lineHeight: "1.86",
    title: "36px",
    h1: "27px",
    h2: "22.5px",
    h3: "19px",
    h4: "18px",
    h5: "18px",
    h6: "18px",
    meta: "14px",
    code: "15px",
  },
};

export const resolveTheme = (background?: NoteImageBackground, theme?: NoteImageTheme): NoteImageTheme => {
  if (theme === "midnight") return "terminal";
  if (theme === "lavender") return "mint";
  if (theme && NOTE_IMAGE_THEMES[theme]) return theme;
  if (theme === ("notepad" as unknown as NoteImageTheme) || theme === ("xuan" as unknown as NoteImageTheme)) return "editorial";
  if (theme === ("polaroid" as unknown as NoteImageTheme)) return "film";
  if (background === "warm") return "sunset";
  if (background === "notepad" || background === "xuan") return "editorial";
  if (background === "polaroid") return "film";
  if (background && NOTE_IMAGE_THEMES[background as NoteImageTheme]) return resolveTheme(undefined, background as NoteImageTheme);
  return "mint";
};

export const buildImageExportBasename = (title: string, fallback: string) => {
  const sanitized = title
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  const basename = sanitized || fallback;
  return WINDOWS_RESERVED_NAME.test(basename) ? `_${basename}` : basename;
};

export const escapeCardHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const estimateReadingStats = (html: string) => {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const cjkChars = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const nonCjkText = text.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, " ").trim();
  const words = nonCjkText ? nonCjkText.split(/\s+/).filter(Boolean).length : 0;
  const totalCount = cjkChars + words;
  const minutes = Math.max(1, Math.ceil(totalCount / 350));
  return { minutes, totalCount };
};

export const buildNoteImageCardMarkup = ({
  title,
  notebook = "",
  tags = [],
  updatedAt = "",
  bodyHtml,
  theme = "mint",
  fontStyle = "auto",
  showTitle = true,
  showNotebook = false,
  showTags = false,
  showUpdatedAt = true,
  showBranding = true,
  author = "",
  showAuthor = false,
  showReadingTime = false,
  readingTimeText = "",
}: {
  title: string;
  notebook?: string;
  tags?: string[];
  updatedAt?: string;
  bodyHtml: string;
  theme?: NoteImageTheme;
  fontStyle?: NoteImageFontStyle;
  showTitle?: boolean;
  showNotebook?: boolean;
  showTags?: boolean;
  showUpdatedAt?: boolean;
  showBranding?: boolean;
  author?: string;
  showAuthor?: boolean;
  showReadingTime?: boolean;
  readingTimeText?: string;
}) => {
  theme = resolveTheme(undefined, theme);

  const terminalBarHtml = (theme === "terminal")
    ? `<div class="edgeever-terminal-header">
        <span class="edgeever-terminal-dot dot-red"></span>
        <span class="edgeever-terminal-dot dot-yellow"></span>
        <span class="edgeever-terminal-dot dot-green"></span>
        <span class="edgeever-terminal-name">${escapeCardHtml(notebook || "note.md")}</span>
      </div>`
    : "";

  const tearStripHtml = "";

  const hasMeta = (showNotebook && Boolean(notebook)) || (showUpdatedAt && Boolean(updatedAt)) || (showTags && tags.length > 0) || showReadingTime;
  let metaHtml = "";
  if (hasMeta) {
    const parts: string[] = [];
    if (showNotebook && notebook) {
      parts.push(
        `<span class="edgeever-meta-pill edgeever-meta-notebook"><svg class="edgeever-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/></svg>${escapeCardHtml(notebook)}</span>`,
      );
    }
    if (showUpdatedAt && updatedAt) {
      parts.push(
        `<span class="edgeever-meta-pill edgeever-meta-date"><svg class="edgeever-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>${escapeCardHtml(updatedAt)}</span>`,
      );
    }
    if (showReadingTime) {
      const stats = estimateReadingStats(bodyHtml);
      const displayReading = readingTimeText || `${stats.minutes} min · ${stats.totalCount} words`;
      parts.push(
        `<span class="edgeever-meta-pill edgeever-meta-reading"><svg class="edgeever-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${escapeCardHtml(displayReading)}</span>`,
      );
    }
    if (showTags && tags.length > 0) {
      for (const tag of tags) {
        parts.push(`<span class="edgeever-meta-pill edgeever-meta-tag">#${escapeCardHtml(tag)}</span>`);
      }
    }
    metaHtml = `<div class="edgeever-card-meta">${parts.join("")}</div>`;
  }

  const titleHtml = showTitle && title ? `<h1 class="edgeever-card-title">${escapeCardHtml(title)}</h1>` : "";
  const dividerHtml = (titleHtml || metaHtml) ? `<div class="edgeever-card-divider"></div>` : "";

  const brandBadgeHtml = `<div class="edgeever-brand-badge">
        <svg class="edgeever-brand-logo" viewBox="0 0 1024 1024" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
          <rect x="100" y="100" width="824" height="824" rx="188" fill="#16a06e" />
          <g transform="translate(100 100) scale(0.74234234) translate(-72 -72)">
            <path fill="#07130b" fill-rule="evenodd" d="M253.5 707.5Q249 678 249.5 655Q250 632 253.5 611.5Q257 591 264.5 568.5Q272 546 281 530Q290 514 287 485Q284 456 283.5 417Q283 378 285 351.5Q287 325 292 299Q297 273 304.5 254.5Q312 236 318.5 227.5Q325 219 336 213Q347 207 358.5 207.5Q370 208 383 213.5Q396 219 407 226.5Q418 234 428 242.5Q438 251 455 268.5Q472 286 485.5 303.5Q499 321 510.5 339Q522 357 528 368.5Q534 380 534 385.5Q534 391 532.5 394.5Q531 398 527.5 401Q524 404 518 405Q512 406 507 404Q502 402 499.5 399.5Q497 397 491.5 386Q486 375 474 357Q462 339 450.5 324.5Q439 310 426 296.5Q413 283 400.5 272.5Q388 262 377 255.5Q366 249 361 248Q356 247 352.5 249.5Q349 252 344.5 261Q340 270 337 280Q334 290 329 325.5Q324 361 323.5 400Q323 439 327 479.5Q331 520 321 538Q311 556 306 568.5Q301 581 297 596Q293 611 291 624.5Q289 638 289 661Q289 684 292 702Q295 720 301 739.5Q307 759 315.5 776.5Q324 794 335 810Q346 826 358 838.5Q370 851 386.5 863.5Q403 876 419.5 884.5Q436 893 456 899.5Q476 906 501 909.5Q526 913 529.5 916Q533 919 534.5 922Q536 925 536 931.5Q536 938 532.5 943Q529 948 524 950Q519 952 505.5 951Q492 950 473 946Q454 942 426 931Q398 920 385.5 912.5Q373 905 359.5 894.5Q346 884 333.5 871.5Q321 859 313 849Q305 839 291 815Q277 791 267.5 764Q258 737 253.5 707.5ZM719 941.5Q716 936 717 929Q718 922 721 918.5Q724 915 727 913.5Q730 912 749 910Q768 908 785 903.5Q802 899 823 889.5Q844 880 860.5 868.5Q877 857 887.5 847Q898 837 911 820Q924 803 932 788.5Q940 774 947.5 753.5Q955 733 959.5 708Q964 683 964 660.5Q964 638 960.5 617.5Q957 597 952.5 582.5Q948 568 943.5 558Q939 548 931 535Q923 522 927 479Q931 436 930.5 400Q930 364 925.5 329Q921 294 917 280Q913 266 909 258.5Q905 251 902 249Q899 247 893 248.5Q887 250 867.5 264Q848 278 835.5 290.5Q823 303 810.5 318Q798 333 783.5 354Q769 375 762 387.5Q755 400 751 402.5Q747 405 742 405.5Q737 406 732 404Q727 402 723.5 397Q720 392 720.5 385Q721 378 736.5 353Q752 328 768 307.5Q784 287 803.5 267Q823 247 834 238Q845 229 858.5 221Q872 213 881 210Q890 207 899.5 207Q909 207 918.5 212Q928 217 935.5 226.5Q943 236 949.5 252Q956 268 960 286Q964 304 967.5 344.5Q971 385 970.5 418Q970 451 967 482.5Q964 514 972 528Q980 542 986 558Q992 574 996 591Q1000 608 1002 624.5Q1004 641 1003.5 667Q1003 693 998 719.5Q993 746 985 768Q977 790 964.5 812Q952 834 940 849Q928 864 915.5 876Q903 888 892.5 896Q882 904 858 917Q834 930 820 935Q806 940 789.5 944Q773 948 753 950Q733 952 727.5 949.5Q722 947 719 941.5ZM378.5 728Q373 718 373 714.5Q373 711 375.5 708Q378 705 387 699Q396 693 405 689Q414 685 426 682.5Q438 680 447.5 680Q457 680 467.5 682Q478 684 490 690Q502 696 512.5 706.5Q523 717 530.5 733Q538 749 539.5 762Q541 775 537 778Q533 781 515.5 784Q498 787 481 786.5Q464 786 451 783Q438 780 428.5 775.5Q419 771 412 766Q405 761 394.5 749.5Q384 738 378.5 728ZM713.5 778Q710 775 710.5 767Q711 759 714 749Q717 739 723.5 727.5Q730 716 740.5 706Q751 696 762 690.5Q773 685 785.5 682.5Q798 680 813 681Q828 682 843.5 688Q859 694 869.5 702.5Q880 711 880 714.5Q880 718 871.5 732Q863 746 853 755.5Q843 765 830.5 772Q818 779 804 782.5Q790 786 772.5 786.5Q755 787 736 784Q717 781 713.5 778ZM406 710Q395 716 398 722.5Q401 729 410 738.5Q419 748 427 753Q435 758 441 760Q447 762 444.5 749.5Q442 737 442.5 726.5Q443 716 445 707.5Q447 699 432 701.5Q417 704 406 710ZM819.5 701Q806 699 808 708.5Q810 718 810 730.5Q810 743 808 750.5Q806 758 806 760Q806 762 807 762Q808 762 815 759Q822 756 830.5 750Q839 744 846 736Q853 728 855.5 722Q858 716 845.5 709.5Q833 703 819.5 701ZM471 759.5Q469 763 469 765Q469 767 472 767.5Q475 768 488.5 768Q502 768 512 766Q522 764 519.5 754Q517 744 511 734Q505 724 498.5 718Q492 712 484.5 708Q477 704 475.5 704Q474 704 475 723Q476 742 474.5 749Q473 756 471 759.5ZM733 750.5Q730 759 730 761.5Q730 764 737 765.5Q744 767 763.5 767Q783 767 779.5 752Q776 737 776 730.5Q776 724 778 714Q780 704 770.5 708Q761 712 753 719.5Q745 727 740.5 734.5Q736 742 733 750.5ZM592.5 848.5Q588 841 588 836.5Q588 832 590 829Q592 826 599.5 822.5Q607 819 613.5 818Q620 817 626.5 817Q633 817 642.5 819Q652 821 655 822.5Q658 824 661.5 828.5Q665 833 664.5 838Q664 843 659.5 850Q655 857 645 867Q635 877 631.5 878.5Q628 880 625 879.5Q622 879 617.5 876Q613 873 605 864.5Q597 856 592.5 848.5Z" />
          </g>
        </svg>
        <span class="edgeever-brand-name">EdgeEver</span>
      </div>`;

  const hasAuthor = showAuthor && Boolean(author.trim());
  let authorHtml = "";
  if (hasAuthor) {
    const trimmedAuthor = author.trim();
    // Extract first letter or character for initials avatar
    const firstChar = Array.from(trimmedAuthor)[0]?.toUpperCase() || "E";
    authorHtml = `<span class="edgeever-footer-author"><span class="edgeever-footer-avatar" aria-hidden="true">${escapeCardHtml(firstChar)}</span><span class="edgeever-footer-author-name">${escapeCardHtml(trimmedAuthor)}</span></span><span class="edgeever-footer-sep">·</span>`;
  }

  const footerHtml = (showBranding || hasAuthor)
    ? `<footer class="edgeever-card-footer">
        <div class="edgeever-card-footer-meta">
          ${authorHtml}
          ${showBranding ? `<span class="edgeever-footer-slogan">Think, capture, and flourish</span>` : ""}
        </div>
        ${showBranding ? brandBadgeHtml : ""}
      </footer>`
    : "";

  return `<div class="edgeever-image-wrapper">
  <div class="edgeever-grain-overlay" aria-hidden="true"></div>
  <article class="edgeever-image-card" data-theme="${theme}">
    ${tearStripHtml}
    ${terminalBarHtml}
    <header class="edgeever-card-header">
      ${metaHtml}
      ${titleHtml}
      ${dividerHtml}
    </header>
    <div class="edgeever-card-body">
      ${bodyHtml}
    </div>
    ${footerHtml}
  </article>
</div>`;
};

export const generateCardCss = ({
  theme = "mint",
  fontStyle = "auto",
  fontSize = "lg",
  cardWidth = "wide",
}: {
  theme: NoteImageTheme;
  fontStyle: NoteImageFontStyle;
  fontSize: NoteImageFontSize;
  cardWidth: NoteImageCardWidth;
}) => {
  theme = resolveTheme(undefined, theme);
  const themeCfg = NOTE_IMAGE_THEMES[theme];
  const typography = resolveNoteImageTypography(theme, fontStyle);
  const sizeCfg = NOTE_IMAGE_FONT_SIZES[fontSize] || NOTE_IMAGE_FONT_SIZES.md;
  const widthPx = NOTE_IMAGE_CARD_WIDTH_PIXELS[cardWidth] || NOTE_IMAGE_CARD_WIDTH_PIXELS.wide;

  return `
    :root {
      --ee-canvas-bg: ${themeCfg.canvasBg};
      --ee-card-bg: ${themeCfg.cardBg};
      --ee-card-border: ${themeCfg.cardBorder};
      --ee-card-shadow: ${themeCfg.cardShadow};
      --ee-text-color: ${themeCfg.textColor};
      --ee-heading-color: ${themeCfg.headingColor};
      --ee-meta-color: ${themeCfg.metaColor};
      --ee-meta-bg: ${themeCfg.metaBg};
      --ee-meta-border: ${themeCfg.metaBorder};
      --ee-accent: ${themeCfg.accentColor};
      --ee-accent-subtle: ${themeCfg.accentSubtle};
      --ee-link-bg: ${themeCfg.linkBg};
      --ee-divider: ${themeCfg.dividerColor};
      --ee-code-bg: ${themeCfg.codeBg};
      --ee-code-border: ${themeCfg.codeBorder};
      --ee-code-color: ${themeCfg.codeColor};
      --ee-quote-bg: ${themeCfg.quoteBg};
      --ee-quote-border: ${themeCfg.quoteBorder};
      --ee-table-th-bg: ${themeCfg.tableThBg};
      --ee-table-border: ${themeCfg.tableBorder};
      --ee-brand-text: ${themeCfg.brandText};
      --ee-brand-mark: ${themeCfg.brandMark};

      --ee-font-family: ${typography.bodyFamily};
      --ee-heading-font-family: ${typography.headingFamily};
      --ee-heading-weight: ${typography.headingWeight};
      --ee-base-size: ${sizeCfg.base};
      --ee-line-height: ${(Number(sizeCfg.lineHeight) + typography.lineHeightAdjustment).toFixed(2)};
      --ee-title-size: ${sizeCfg.title};
      --ee-h1-size: ${sizeCfg.h1};
      --ee-h2-size: ${sizeCfg.h2};
      --ee-h3-size: ${sizeCfg.h3};
      --ee-h4-size: ${sizeCfg.h4};
      --ee-h5-size: ${sizeCfg.h5};
      --ee-h6-size: ${sizeCfg.h6};
      --ee-meta-size: ${sizeCfg.meta};
      --ee-code-size: ${sizeCfg.code};
    }

    * { box-sizing: border-box; }

    .edgeever-image-wrapper {
      position: relative;
      width: ${widthPx}px;
      padding: 38px 32px 44px;
      background: var(--ee-canvas-bg);
      font-family: var(--ee-font-family);
      box-sizing: border-box;
      margin: 0;
      color: var(--ee-text-color);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-feature-settings: "chws" 1;
      overflow: hidden;
    }

    .edgeever-grain-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.055'/%3E%3C/svg%3E");
      background-repeat: repeat;
      z-index: 1;
    }

    .edgeever-image-card {
      background: var(--ee-card-bg);
      border: var(--ee-card-border);
      border-radius: ${theme === "editorial" || theme === "film" || theme === "slate" ? 4 : 20}px;
      box-shadow: var(--ee-card-shadow);
      padding: 40px 38px 36px;
      position: relative;
      z-index: 2;
      overflow: hidden;
    }

    .edgeever-terminal-header {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 12px 18px;
      margin: -40px -38px 26px;
      border-bottom: var(--ee-card-border);
      background: var(--ee-meta-bg);
    }
    .edgeever-terminal-dot {
      width: 10.5px;
      height: 10.5px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot-red { background: #ff5f56; }
    .dot-yellow { background: #ffbd2e; }
    .dot-green { background: #27c93f; }
    .edgeever-terminal-name {
      margin-left: 6px;
      font-size: 12px;
      color: var(--ee-meta-color);
      font-family: inherit;
      opacity: 0.9;
    }

    .edgeever-card-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }

    .edgeever-meta-pill {
      display: inline-flex;
      align-items: center;
      gap: 5.5px;
      padding: 3.5px 10px;
      border-radius: 9999px;
      background: var(--ee-meta-bg);
      border: 1px solid var(--ee-meta-border);
      color: var(--ee-meta-color);
      font-size: var(--ee-meta-size);
      font-weight: 550;
      line-height: 1.2;
    }
    .edgeever-icon {
      display: inline-block;
      vertical-align: middle;
      stroke: currentColor;
    }
    .edgeever-meta-tag {
      background: var(--ee-link-bg);
      border-color: var(--ee-accent-subtle);
      color: var(--ee-accent);
      font-weight: 600;
    }

    .edgeever-card-title {
      margin: 0 0 16px;
      font-size: var(--ee-title-size);
      font-family: var(--ee-heading-font-family);
      font-weight: var(--ee-heading-weight);
      line-height: 1.25;
      letter-spacing: -0.026em;
      color: var(--ee-heading-color);
      word-break: break-word;
    }

    .edgeever-card-divider {
      height: 1px;
      background: linear-gradient(90deg, var(--ee-divider) 0%, transparent 95%);
      margin: 0 0 24px;
    }

    .edgeever-card-body {
      font-size: var(--ee-base-size);
      line-height: var(--ee-line-height);
      color: var(--ee-text-color);
      overflow-wrap: anywhere;
    }

    .edgeever-card-body > :first-child { margin-top: 0; }
    .edgeever-card-body > :last-child { margin-bottom: 0; }

    .edgeever-card-body h1,
    .edgeever-card-body h2,
    .edgeever-card-body h3,
    .edgeever-card-body h4,
    .edgeever-card-body h5,
    .edgeever-card-body h6 {
      color: var(--ee-heading-color);
      line-height: 1.28;
      font-family: var(--ee-heading-font-family);
      font-weight: var(--ee-heading-weight);
      letter-spacing: -0.015em;
    }
    .edgeever-card-body h1 {
      font-size: var(--ee-h1-size);
      margin: 1.6em 0 0.7em;
      border-left: 3.5px solid var(--ee-accent);
      padding-left: 10px;
      margin-left: -13.5px;
    }
    .edgeever-card-body h2 { font-size: var(--ee-h2-size); margin: 1.4em 0 0.6em; }
    .edgeever-card-body h3 { font-size: var(--ee-h3-size); margin: 1.2em 0 0.5em; }
    .edgeever-card-body h4 { font-size: var(--ee-h4-size); margin: 1.1em 0 0.45em; }
    .edgeever-card-body h5 { font-size: var(--ee-h5-size); margin: 1em 0 0.4em; }
    .edgeever-card-body h6 { font-size: var(--ee-h6-size); margin: 0.9em 0 0.35em; }

    .edgeever-card-body p { margin: 0 0 1em; }

    .edgeever-card-body ul,
    .edgeever-card-body ol {
      margin: 0 0 1.1em;
      padding-left: 1.5em;
    }
    .edgeever-card-body li { margin: 0.3em 0; }

    .edgeever-card-body ul[data-type="taskList"] {
      padding-left: 0;
      list-style: none;
    }
    .edgeever-card-body ul[data-type="taskList"] li[data-checked] {
      display: flex;
      align-items: flex-start;
      gap: 0.6rem;
      margin: 0.4rem 0;
    }
    .edgeever-card-body ul[data-type="taskList"] li[data-checked="true"] {
      opacity: 0.7;
      text-decoration: line-through;
    }
    .edgeever-card-body ul[data-type="taskList"] li[data-checked] > label {
      display: inline-flex;
      flex: 0 0 auto;
      margin-top: 0.2rem;
    }
    .edgeever-card-body ul[data-type="taskList"] li[data-checked] > label input {
      width: 1.1rem;
      height: 1.1rem;
      margin: 0;
      accent-color: var(--ee-accent);
    }
    .edgeever-card-body ul[data-type="taskList"] li[data-checked] > div {
      min-width: 0;
      flex: 1 1 auto;
    }
    .edgeever-card-body ul[data-type="taskList"] li[data-checked] > div > p {
      margin-bottom: 0;
    }

    .edgeever-card-body blockquote {
      position: relative;
      margin: 1.3em 0;
      border-left: 4px solid var(--ee-quote-border);
      background: var(--ee-quote-bg);
      padding: 14px 18px 14px 24px;
      border-radius: 0 10px 10px 0;
      color: var(--ee-text-color);
      font-size: 0.98em;
      line-height: 1.75;
    }
    .edgeever-card-body blockquote::before {
      content: "“";
      position: absolute;
      top: -8px;
      left: 6px;
      font-size: 38px;
      line-height: 1;
      font-family: Georgia, "Songti SC", "Times New Roman", serif;
      color: var(--ee-quote-border);
      opacity: 0.28;
      pointer-events: none;
    }
    .edgeever-card-body blockquote p:last-child { margin-bottom: 0; }

    .edgeever-card-body mark {
      background: linear-gradient(104deg, rgba(254, 240, 138, 0) 1%, rgba(254, 240, 138, 0.88) 3%, rgba(254, 240, 138, 0.76) 98%);
      padding: 0.1em 0.35em;
      border-radius: 4px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      color: inherit;
    }

    .edgeever-card-body hr {
      margin: 1.8em 0;
      border: 0;
      border-top: 1px solid var(--ee-divider);
    }

    .edgeever-card-body a {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--ee-accent);
      text-decoration: none;
      font-weight: 600;
      background: var(--ee-link-bg);
      border: 1px solid var(--ee-accent-subtle);
      padding: 1.5px 8px;
      border-radius: 6px;
      line-height: 1.45;
      vertical-align: baseline;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
    }

    .edgeever-card-body code {
      border-radius: 5px;
      background: var(--ee-code-bg);
      border: 1px solid var(--ee-code-border);
      color: var(--ee-code-color);
      padding: 2px 6px;
      font-family: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, monospace;
      font-size: var(--ee-code-size);
    }

    .edgeever-card-body pre,
    .edgeever-card-body .edgeever-code-source {
      max-width: 100%;
      margin: 1.3em 0;
      border: 1px solid var(--ee-code-border);
      border-radius: 10px;
      background: var(--ee-code-bg);
      padding: 14px 18px;
      color: var(--ee-code-color);
      font-family: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, monospace;
      font-size: var(--ee-code-size);
      line-height: 1.6;
      overflow-x: auto;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
    }

    .edgeever-card-body pre code {
      background: transparent;
      border: 0;
      padding: 0;
      color: inherit;
    }

    .edgeever-card-body img,
    .edgeever-card-body .edgeever-html-mermaid svg {
      display: block;
      width: auto;
      max-width: 100%;
      height: auto;
      max-height: 80vh;
      border-radius: 10px;
      margin: 1.3em auto;
      object-fit: contain;
    }

    .edgeever-card-body figure,
    .edgeever-card-body .edgeever-html-mermaid {
      max-width: 100%;
      margin: 1.3em auto;
    }

    .edgeever-card-body table {
      width: 100%;
      margin: 1.4em 0;
      border-collapse: separate;
      border-spacing: 0;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--ee-table-border);
      font-size: calc(var(--ee-base-size) * 0.92);
      line-height: 1.5;
    }

    .edgeever-card-body th,
    .edgeever-card-body td {
      padding: 9px 13px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--ee-table-border);
      border-right: 1px solid var(--ee-table-border);
    }

    .edgeever-card-body th {
      background: var(--ee-table-th-bg);
      color: var(--ee-heading-color);
      font-weight: 650;
    }

    .edgeever-card-body tr:last-child td { border-bottom: 0; }
    .edgeever-card-body td:last-child,
    .edgeever-card-body th:last-child { border-right: 0; }

    .edgeever-card-body [data-edgeever-theme-block] {
      margin: 1.3em 0;
      border: 1px solid var(--ee-meta-border);
      border-left: 4px solid var(--ee-accent);
      border-radius: 10px;
      background: var(--ee-meta-bg);
      padding: 12px 16px;
    }

    .edgeever-card-body .edgeever-image-controls,
    .edgeever-card-body .edgeever-code-copy-button,
    .edgeever-card-body .edgeever-theme-block__toolbar,
    .edgeever-card-body .edgeever-mermaid-source {
      display: none !important;
    }

    .edgeever-card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 36px;
      border-top: 1px solid var(--ee-divider);
      padding-top: 22px;
    }

    .edgeever-card-footer-meta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--ee-meta-color);
      font-weight: 500;
      opacity: 0.85;
    }

    .edgeever-footer-author {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      color: var(--ee-heading-color);
    }

    .edgeever-footer-avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--ee-heading-color);
      color: var(--ee-card-bg);
      font-size: 10px;
      font-weight: 700;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1;
      text-transform: uppercase;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      flex-shrink: 0;
    }

    .edgeever-footer-author-name {
      letter-spacing: -0.01em;
    }

    .edgeever-footer-sep {
      opacity: 0.45;
    }

    .edgeever-brand-badge {
      display: inline-flex;
      align-items: center;
      gap: 7.5px;
      font-size: 13px;
      font-weight: 650;
      color: var(--ee-brand-text);
      opacity: 0.95;
    }

    .edgeever-brand-logo {
      display: inline-block;
      vertical-align: middle;
      border-radius: 5px;
    }

    .edgeever-brand-name {
      font-weight: 760;
      letter-spacing: -0.01em;
      color: var(--ee-brand-text);
    }

    ${theme === "editorial" ? `
    .edgeever-image-card[data-theme="editorial"] {
      border: 2px solid #111827;
      border-radius: 4px;
      box-shadow: 6px 6px 0px #111827;
    }
    .edgeever-image-card[data-theme="editorial"] .edgeever-card-header {
      border-bottom: 2px solid #111827;
      padding-bottom: 12px;
      margin-bottom: 24px;
    }
    .edgeever-image-card[data-theme="editorial"] .edgeever-card-title {
      font-family: var(--ee-heading-font-family);
      letter-spacing: -0.02em;
    }
    ` : ""}

    ${theme === "terminal" ? `
    .edgeever-image-card[data-theme="terminal"] {
      border: 1px solid rgba(0, 240, 160, 0.35);
      border-radius: 12px;
      box-shadow: 0 0 30px -5px rgba(0, 240, 160, 0.15), 0 24px 60px -12px rgba(0, 0, 0, 0.95);

    }
    .edgeever-image-card[data-theme="terminal"] .edgeever-terminal-header {
      border-bottom: 1px solid rgba(0, 240, 160, 0.2);
      background: #161b22;
    }
    ` : ""}

    ${theme === "film" ? `
    .edgeever-image-card[data-theme="film"] {
      border: 1px solid rgba(214, 186, 155, 0.85);
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(60, 45, 30, 0.05);
    }
    .edgeever-image-card[data-theme="film"] .edgeever-card-title {
      color: #1c1917;
    }
    ` : ""}
  `;
};
