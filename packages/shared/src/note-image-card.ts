import { CATALOG_FONT_STACKS, type RemoteNoteImageFont } from "./font-catalog";
export { prepareNoteImageContent } from "./note-image-content";

export type NoteImageFormat = "jpeg" | "png";
export const NOTE_IMAGE_THEME_OPTIONS = ["glass", "quote", "book", "memo", "bento", "black-sun", "frame", "handwritten", "code"] as const;
export type NoteImageActiveTheme = (typeof NOTE_IMAGE_THEME_OPTIONS)[number];
type LegacyNoteImageTheme = "gradient" | "paper" | "press" | "highlight" | "slate" | "aurora" | "sunset" | "midnight" | "editorial" | "terminal" | "film" | "mint" | "lavender";
export type NoteImageTheme = NoteImageActiveTheme | LegacyNoteImageTheme;
export type NoteImageBackground = NoteImageTheme | "warm" | "notepad" | "xuan" | "polaroid";
export type NoteImageFontStyle = "auto" | "sans" | "serif" | "mono" | "kai" | RemoteNoteImageFont;
export type NoteImageFontSize = "sm" | "md" | "lg";
export type NoteImageCardWidth = "compact" | "standard" | "wide";
export const NOTE_IMAGE_EXPORT_WIDTH = 768;
export const NOTE_IMAGE_EXPORT_PIXEL_RATIO = 2;
export const NOTE_IMAGE_CARD_WIDTH_PIXELS: Record<NoteImageCardWidth, number> = { compact: 560, standard: 680, wide: 800 };

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

const LEGACY_THEMES: Record<Exclude<NoteImageBackground, NoteImageActiveTheme>, NoteImageActiveTheme> = {
  paper: "handwritten", press: "book", highlight: "memo", slate: "frame", aurora: "glass", gradient: "glass",
  sunset: "glass", midnight: "black-sun", editorial: "frame", terminal: "code", film: "book",
  mint: "quote", lavender: "glass", warm: "glass", notepad: "memo", xuan: "handwritten", polaroid: "frame",
};

export const resolveTheme = (background?: NoteImageBackground, theme?: NoteImageTheme): NoteImageActiveTheme => {
  for (const candidate of [theme, background]) {
    if (!candidate) continue;
    if ((NOTE_IMAGE_THEME_OPTIONS as readonly string[]).includes(candidate)) return candidate as NoteImageActiveTheme;
    if (Object.hasOwn(LEGACY_THEMES, candidate)) return LEGACY_THEMES[candidate as keyof typeof LEGACY_THEMES];
  }
  return "glass";
};

export type ThemeStyleConfig = {
  canvasBg: string; cardBg: string; cardBorder: string; cardShadow: string;
  textColor: string; headingColor: string; metaColor: string; metaBg: string; metaBorder: string;
  accentColor: string; accentSubtle: string; linkBg: string; dividerColor: string;
  codeBg: string; codeBorder: string; codeColor: string; quoteBg: string; quoteBorder: string;
  tableThBg: string; tableBorder: string; brandText: string; brandMark: string; isDark?: boolean;
};

const palette = (base: Pick<ThemeStyleConfig, "canvasBg" | "cardBg" | "textColor"> & Partial<ThemeStyleConfig>): ThemeStyleConfig => {
  const line = base.isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)";
  const subtle = base.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.035)";
  return {
    cardBorder: "none", cardShadow: "none", headingColor: base.textColor,
    metaColor: base.isDark ? "#999ba3" : "#737373", metaBg: subtle, metaBorder: line,
    accentColor: base.textColor, accentSubtle: line, linkBg: "transparent", dividerColor: line,
    codeBg: subtle, codeBorder: line, codeColor: base.textColor, quoteBg: "transparent", quoteBorder: line,
    tableThBg: subtle, tableBorder: line, brandText: base.textColor, brandMark: base.textColor,
    ...base,
  };
};

// Measured against the public Firefly Card templates at their 400px / 440px design widths.
// Structure and CSS are implemented here; exports never depend on that service.
const ACTIVE_THEMES: Record<NoteImageActiveTheme, ThemeStyleConfig> = {
  glass: palette({ canvasBg: "linear-gradient(45deg, #5797f9, #6cd5c4)", cardBg: "rgba(255,255,255,0.7)", textColor: "#000000", cardShadow: "0 5px 10px rgba(99,99,99,0.2), 0 15px 15px rgba(99,99,99,0.2)" }),
  quote: palette({ canvasBg: "#ffffff", cardBg: "transparent", textColor: "#0a7c07", metaColor: "#497447", accentColor: "#0a7c07" }),
  book: palette({ canvasBg: "#f8f3e8", cardBg: "transparent", textColor: "#302b24", metaColor: "#786c5c", accentColor: "#66513a" }),
  memo: palette({ canvasBg: "#ffffff", cardBg: "#ffffff", textColor: "#353535", metaColor: "#737377", accentColor: "#e5ae00" }),
  bento: palette({ canvasBg: "linear-gradient(45deg, #5797f9, #6cd5c4)", cardBg: "#f5f4f7", textColor: "#000000", headingColor: "#5797f9", cardShadow: "0 6px 18px rgba(0,0,0,0.15), 0 21px 68px rgba(0,0,0,0.1)" }),
  "black-sun": palette({ canvasBg: "#101010", cardBg: "#020410", textColor: "#ffffff", metaColor: "#9392a4", cardBorder: "1px solid #777681", cardShadow: "0 0 22px rgba(216,213,255,0.65)", isDark: true }),
  frame: palette({ canvasBg: "#ffffff", cardBg: "#ffffff", textColor: "#000000", cardBorder: "2px solid #000000", cardShadow: "7px 7px 0 #000000" }),
  handwritten: palette({ canvasBg: "#e3dfd4", cardBg: "transparent", textColor: "#000000", metaColor: "#000000", accentColor: "#000000" }),
  code: palette({ canvasBg: "linear-gradient(45deg, #5797f9, #6cd5c4)", cardBg: "#151718", textColor: "#d4d4d4", headingColor: "#f1f1f1", metaColor: "#949898", codeBg: "#151718", isDark: true }),
};

export const NOTE_IMAGE_THEMES: Record<NoteImageTheme, ThemeStyleConfig> = {
  ...ACTIVE_THEMES,
  ...Object.fromEntries(Object.entries(LEGACY_THEMES).map(([legacy, active]) => [legacy, ACTIVE_THEMES[active]])),
} as Record<NoteImageTheme, ThemeStyleConfig>;

const CANVAS_COLORS: Record<NoteImageActiveTheme, string> = {
  glass: "#5797f9", quote: "#ffffff", book: "#f8f3e8", memo: "#ffffff",
  bento: "#5797f9", "black-sun": "#101010", frame: "#ffffff", handwritten: "#e3dfd4", code: "#5797f9",
};
export const NOTE_IMAGE_BACKGROUND_COLORS = {
  ...CANVAS_COLORS,
  ...Object.fromEntries(Object.entries(LEGACY_THEMES).map(([legacy, active]) => [legacy, CANVAS_COLORS[active]])),
} as Record<NoteImageBackground, string>;

export const NOTE_IMAGE_FONT_FAMILIES: Record<Exclude<NoteImageFontStyle, "auto">, string> = {
  sans: '"EdgeEver Offline Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  serif: 'Georgia, "Nimbus Roman No9 L", "Songti SC", "Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", "STSong", "AR PL New Sung", "SimSun", "Hiragino Mincho ProN", "EdgeEver Offline Sans", serif',
  mono: '"Geist Mono Variable", "JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  kai: '"LXGW WenKai", "霞鹜文楷", "Kaiti SC", "STKaiti", "KaiTi", "KaiTi_GB2312", "BiauKai", "楷体", "STFangsong", "FangSong", "EdgeEver Offline Sans", serif',
  ...CATALOG_FONT_STACKS,
};

/** Keep CSS families and asset selection together so defaults cannot silently fall back. */
export const NOTE_IMAGE_BUNDLED_FONTS = {
  puhui: { labelKey: "editor.imageShare.templateFonts.puhui", family: "Alibaba-PuHuiTi-Regular", fallback: "sans" },
  misans: { labelKey: "editor.imageShare.templateFonts.misans", family: "MiSans", fallback: "sans" },
  mincho: { labelKey: "editor.imageShare.templateFonts.mincho", family: "Huiwen_mingchao", fallback: "serif" },
  song: { labelKey: "editor.imageShare.templateFonts.song", family: "SourceHanSerifCN_SemiBold", fallback: "serif" },
  longcang: { labelKey: "editor.imageShare.templateFonts.longcang", family: "Long Cang", fallback: "kai" },
  geist: { labelKey: "editor.imageShare.templateFonts.geist", family: "Geist Mono Variable", fallback: "mono" },
} as const;

type BundledNoteImageFont = keyof typeof NOTE_IMAGE_BUNDLED_FONTS;
type TemplateTypography = {
  body: readonly BundledNoteImageFont[];
  heading: readonly BundledNoteImageFont[];
  headingWeight: number;
};

export const NOTE_IMAGE_TEMPLATE_TYPOGRAPHY = {
  glass: { body: ["misans"], heading: ["mincho"], headingWeight: 400 },
  quote: { body: ["mincho"], heading: ["mincho"], headingWeight: 700 },
  book: { body: ["song"], heading: ["song"], headingWeight: 700 },
  memo: { body: ["misans"], heading: ["misans"], headingWeight: 700 },
  bento: { body: ["misans"], heading: ["song"], headingWeight: 600 },
  "black-sun": { body: ["geist", "misans"], heading: ["geist", "misans"], headingWeight: 700 },
  frame: { body: ["song"], heading: ["song"], headingWeight: 600 },
  handwritten: { body: ["longcang"], heading: ["longcang"], headingWeight: 400 },
  code: { body: ["geist"], heading: ["geist"], headingWeight: 700 },
} as const satisfies Record<NoteImageActiveTheme, TemplateTypography>;

const templateFontStack = (fonts: readonly BundledNoteImageFont[]) => [
  ...fonts.map(font => `"${NOTE_IMAGE_BUNDLED_FONTS[font].family}"`),
  NOTE_IMAGE_FONT_FAMILIES[NOTE_IMAGE_BUNDLED_FONTS[fonts[0]].fallback],
].join(", ");

export const resolveNoteImageTypography = (theme: NoteImageTheme, fontStyle: NoteImageFontStyle = "auto") => {
  const active = resolveTheme(undefined, theme);
  const preset = NOTE_IMAGE_TEMPLATE_TYPOGRAPHY[active];
  return {
    bodyFamily: fontStyle === "auto" ? templateFontStack(preset.body) : NOTE_IMAGE_FONT_FAMILIES[fontStyle],
    headingFamily: fontStyle === "auto" ? templateFontStack(preset.heading) : NOTE_IMAGE_FONT_FAMILIES[fontStyle],
    headingWeight: fontStyle === "auto" ? preset.headingWeight : active === "handwritten" ? 400 : 700,
    lineHeightAdjustment: 0,
  };
};

export const NOTE_IMAGE_FONT_SIZES = {
  sm: { base: "14.4px", lineHeight: "1.8", title: "18.4px", h1: "19px", h2: "17px", h3: "16px", h4: "15px", h5: "14.4px", h6: "14.4px", meta: "11.5px", code: "12px" },
  md: { base: "16px", lineHeight: "1.8", title: "20.4px", h1: "21px", h2: "19px", h3: "18px", h4: "17px", h5: "16px", h6: "16px", meta: "12.7px", code: "13.5px" },
  lg: { base: "17.6px", lineHeight: "1.8", title: "22.4px", h1: "23px", h2: "21px", h3: "19px", h4: "18px", h5: "17.6px", h6: "17.6px", meta: "14px", code: "15px" },
} satisfies Record<NoteImageFontSize, Record<string, string>>;

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export const buildImageExportBasename = (title: string, fallback: string) => {
  const sanitized = title
    // oxlint-disable-next-line no-control-regex -- replaces control characters in export filenames
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

export type NoteImageCardMarkupOptions = {
  title: string; notebook?: string; tags?: string[]; updatedAt?: string; bodyHtml: string;
  theme?: NoteImageTheme; fontStyle?: NoteImageFontStyle; showTitle?: boolean; showNotebook?: boolean;
  showTags?: boolean; showUpdatedAt?: boolean; showBranding?: boolean; author?: string;
  showAuthor?: boolean; showReadingTime?: boolean; readingTimeText?: string;
};

export const buildNoteImageCardMarkup = ({
  title, notebook = "", tags = [], updatedAt = "", bodyHtml, theme = "glass",
  showTitle = false, showNotebook = false, showTags = false, showUpdatedAt = true,
  showBranding = true, author = "", showAuthor = false, showReadingTime = false, readingTimeText = "",
}: NoteImageCardMarkupOptions) => {
  const active = resolveTheme(undefined, theme);
  const hasTitle = showTitle && Boolean(title.trim());
  const hasAuthor = showAuthor && Boolean(author.trim());
  const authorName = hasAuthor ? escapeCardHtml(author.trim()) : "";
  const meta: string[] = [];
  const dateHtml = showUpdatedAt && updatedAt.trim() ? `<div class="edgeever-card-date"><span class="edgeever-meta-date">${escapeCardHtml(updatedAt)}</span></div>` : "";
  if (showNotebook && notebook.trim()) meta.push(`<span class="edgeever-meta-notebook">${escapeCardHtml(notebook)}</span>`);
  if (showTags) meta.push(...tags.filter(tag => tag.trim()).map(tag => `<span class="edgeever-meta-tag">#${escapeCardHtml(tag)}</span>`));
  if (showReadingTime) {
    const stats = estimateReadingStats(bodyHtml);
    meta.push(`<span class="edgeever-meta-reading">${escapeCardHtml(readingTimeText || `${stats.minutes} min · ${stats.totalCount} words`)}</span>`);
  }
  const metaHtml = meta.length ? `<div class="edgeever-card-meta">${meta.join("")}</div>` : "";
  const titleHtml = hasTitle ? `<h1 class="edgeever-card-title">${escapeCardHtml(title)}</h1>` : "";
  const dots = `<span class="edgeever-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>`;
  const chrome = active === "code"
    ? `<div class="edgeever-terminal-header">${dots}<span class="edgeever-terminal-name">note.md</span></div>`
    : active === "memo"
    ? `<div class="edgeever-memo-toolbar" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg><span></span><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M7 12h.01M12 12h.01M17 12h.01"/></svg><svg viewBox="0 0 24 24"><path d="M12 16V2m-5 5 5-5 5 5M5 10v11h14V10"/></svg></div>`
    : active === "frame" ? `<div class="edgeever-frame-toolbar">${dots}</div>` : "";
  const brandBadgeHtml = `<div class="edgeever-brand-badge">
        <svg class="edgeever-brand-logo" viewBox="0 0 1024 1024" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="edgeever-note-tile" gradientUnits="userSpaceOnUse" x1="100" y1="100" x2="924" y2="924" color-interpolation="sRGB">
              <stop offset="0%" stop-color="#36d98e" />
              <stop offset="100%" stop-color="#12c578" />
            </linearGradient>
          </defs>
          <rect x="100" y="100" width="824" height="824" rx="188" fill="url(#edgeever-note-tile)" />
          <g transform="translate(100 100) scale(0.74234234) translate(-72 -72)">
            <path fill="#07130b" fill-rule="evenodd" d="M253.5 707.5Q249 678 249.5 655Q250 632 253.5 611.5Q257 591 264.5 568.5Q272 546 281 530Q290 514 287 485Q284 456 283.5 417Q283 378 285 351.5Q287 325 292 299Q297 273 304.5 254.5Q312 236 318.5 227.5Q325 219 336 213Q347 207 358.5 207.5Q370 208 383 213.5Q396 219 407 226.5Q418 234 428 242.5Q438 251 455 268.5Q472 286 485.5 303.5Q499 321 510.5 339Q522 357 528 368.5Q534 380 534 385.5Q534 391 532.5 394.5Q531 398 527.5 401Q524 404 518 405Q512 406 507 404Q502 402 499.5 399.5Q497 397 491.5 386Q486 375 474 357Q462 339 450.5 324.5Q439 310 426 296.5Q413 283 400.5 272.5Q388 262 377 255.5Q366 249 361 248Q356 247 352.5 249.5Q349 252 344.5 261Q340 270 337 280Q334 290 329 325.5Q324 361 323.5 400Q323 439 327 479.5Q331 520 321 538Q311 556 306 568.5Q301 581 297 596Q293 611 291 624.5Q289 638 289 661Q289 684 292 702Q295 720 301 739.5Q307 759 315.5 776.5Q324 794 335 810Q346 826 358 838.5Q370 851 386.5 863.5Q403 876 419.5 884.5Q436 893 456 899.5Q476 906 501 909.5Q526 913 529.5 916Q533 919 534.5 922Q536 925 536 931.5Q536 938 532.5 943Q529 948 524 950Q519 952 505.5 951Q492 950 473 946Q454 942 426 931Q398 920 385.5 912.5Q373 905 359.5 894.5Q346 884 333.5 871.5Q321 859 313 849Q305 839 291 815Q277 791 267.5 764Q258 737 253.5 707.5ZM719 941.5Q716 936 717 929Q718 922 721 918.5Q724 915 727 913.5Q730 912 749 910Q768 908 785 903.5Q802 899 823 889.5Q844 880 860.5 868.5Q877 857 887.5 847Q898 837 911 820Q924 803 932 788.5Q940 774 947.5 753.5Q955 733 959.5 708Q964 683 964 660.5Q964 638 960.5 617.5Q957 597 952.5 582.5Q948 568 943.5 558Q939 548 931 535Q923 522 927 479Q931 436 930.5 400Q930 364 925.5 329Q921 294 917 280Q913 266 909 258.5Q905 251 902 249Q899 247 893 248.5Q887 250 867.5 264Q848 278 835.5 290.5Q823 303 810.5 318Q798 333 783.5 354Q769 375 762 387.5Q755 400 751 402.5Q747 405 742 405.5Q737 406 732 404Q727 402 723.5 397Q720 392 720.5 385Q721 378 736.5 353Q752 328 768 307.5Q784 287 803.5 267Q823 247 834 238Q845 229 858.5 221Q872 213 881 210Q890 207 899.5 207Q909 207 918.5 212Q928 217 935.5 226.5Q943 236 949.5 252Q956 268 960 286Q964 304 967.5 344.5Q971 385 970.5 418Q970 451 967 482.5Q964 514 972 528Q980 542 986 558Q992 574 996 591Q1000 608 1002 624.5Q1004 641 1003.5 667Q1003 693 998 719.5Q993 746 985 768Q977 790 964.5 812Q952 834 940 849Q928 864 915.5 876Q903 888 892.5 896Q882 904 858 917Q834 930 820 935Q806 940 789.5 944Q773 948 753 950Q733 952 727.5 949.5Q722 947 719 941.5ZM378.5 728Q373 718 373 714.5Q373 711 375.5 708Q378 705 387 699Q396 693 405 689Q414 685 426 682.5Q438 680 447.5 680Q457 680 467.5 682Q478 684 490 690Q502 696 512.5 706.5Q523 717 530.5 733Q538 749 539.5 762Q541 775 537 778Q533 781 515.5 784Q498 787 481 786.5Q464 786 451 783Q438 780 428.5 775.5Q419 771 412 766Q405 761 394.5 749.5Q384 738 378.5 728ZM713.5 778Q710 775 710.5 767Q711 759 714 749Q717 739 723.5 727.5Q730 716 740.5 706Q751 696 762 690.5Q773 685 785.5 682.5Q798 680 813 681Q828 682 843.5 688Q859 694 869.5 702.5Q880 711 880 714.5Q880 718 871.5 732Q863 746 853 755.5Q843 765 830.5 772Q818 779 804 782.5Q790 786 772.5 786.5Q755 787 736 784Q717 781 713.5 778ZM406 710Q395 716 398 722.5Q401 729 410 738.5Q419 748 427 753Q435 758 441 760Q447 762 444.5 749.5Q442 737 442.5 726.5Q443 716 445 707.5Q447 699 432 701.5Q417 704 406 710ZM819.5 701Q806 699 808 708.5Q810 718 810 730.5Q810 743 808 750.5Q806 758 806 760Q806 762 807 762Q808 762 815 759Q822 756 830.5 750Q839 744 846 736Q853 728 855.5 722Q858 716 845.5 709.5Q833 703 819.5 701ZM471 759.5Q469 763 469 765Q469 767 472 767.5Q475 768 488.5 768Q502 768 512 766Q522 764 519.5 754Q517 744 511 734Q505 724 498.5 718Q492 712 484.5 708Q477 704 475.5 704Q474 704 475 723Q476 742 474.5 749Q473 756 471 759.5ZM733 750.5Q730 759 730 761.5Q730 764 737 765.5Q744 767 763.5 767Q783 767 779.5 752Q776 737 776 730.5Q776 724 778 714Q780 704 770.5 708Q761 712 753 719.5Q745 727 740.5 734.5Q736 742 733 750.5ZM592.5 848.5Q588 841 588 836.5Q588 832 590 829Q592 826 599.5 822.5Q607 819 613.5 818Q620 817 626.5 817Q633 817 642.5 819Q652 821 655 822.5Q658 824 661.5 828.5Q665 833 664.5 838Q664 843 659.5 850Q655 857 645 867Q635 877 631.5 878.5Q628 880 625 879.5Q622 879 617.5 876Q613 873 605 864.5Q597 856 592.5 848.5Z" />
          </g>
        </svg>
        <span class="edgeever-brand-name">EdgeEver</span>
      </div>`;
  const footer = hasAuthor || showBranding || meta.length ? `<footer class="edgeever-card-footer">
    ${metaHtml}
    ${hasAuthor ? `<div class="edgeever-footer-author"><span>${authorName}</span></div>` : ""}
    ${showBranding ? brandBadgeHtml : ""}
  </footer>` : "";
  // Only a standalone short paragraph gets the large quotation treatment.
  // Long excerpts, hard breaks and rich blocks keep the regular reading size.
  const quoteParagraph = bodyHtml.trim().match(/^<p(?:\s[^>]*)?>([\s\S]*?)<\/p>$/i)?.[1];
  const quoteText = quoteParagraph?.replace(/<[^>]*>/g, "").replace(/&(?:nbsp|#160|#xa0);/gi, " ")
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, "x").trim() || "";
  const shortQuote = active === "quote" && !hasTitle && Boolean(quoteText) && Array.from(quoteText).length <= 60
    && !/<\/?(?:p|br|img|svg|video|iframe|math)\b/i.test(quoteParagraph || "");
  const header = titleHtml || dateHtml ? `<header class="edgeever-card-header">${titleHtml}${dateHtml}</header>` : "";
  return `<div class="edgeever-image-wrapper" data-theme="${active}" data-has-title="${hasTitle}" data-short-quote="${shortQuote}">
    <article class="edgeever-image-card">
      ${chrome}
      ${header}
      <div class="edgeever-card-body">${bodyHtml}</div>
      ${footer}
    </article>
  </div>`;
};

export const generateCardCss = ({ theme = "glass", fontStyle = "auto", fontSize = "lg", cardWidth = "wide" }: {
  theme: NoteImageTheme; fontStyle: NoteImageFontStyle; fontSize: NoteImageFontSize; cardWidth: NoteImageCardWidth;
}) => {
  const active = resolveTheme(undefined, theme);
  const cfg = NOTE_IMAGE_THEMES[active];
  const typography = resolveNoteImageTypography(active, fontStyle);
  const size = NOTE_IMAGE_FONT_SIZES[fontSize] || NOTE_IMAGE_FONT_SIZES.lg;
  const width = NOTE_IMAGE_CARD_WIDTH_PIXELS[cardWidth] || 800;
  const scale = width / (["handwritten", "quote"].includes(active) ? 400 : 440);
  const px = (n: number) => `${Number((n * scale).toFixed(3))}px`;
  const scaledCss = (value: string) => value.replace(/([\d.]+)px/g, (_, n: string) => px(Number(n)));
  const textScale = parseFloat(size.base) / 17.6;
  const bodySize = active === "book" ? 20 : active === "code" ? 15 : active === "quote" ? 14.4 : 17.6;
  // Keep the note title above every heading in its body, across font-size choices.
  const titleSize = active === "quote" ? 28.8 : active === "memo" ? 32 : bodySize * 1.6;
  const inset = ["book", "quote", "memo", "handwritten"].includes(active) ? 0 : 30;
  const padding = active === "handwritten" ? "50px" : active === "bento" ? "14px" : active === "frame" ? "16px" : active === "code" ? "16px" : active === "memo" ? "0px 32px 32px" : active === "book" || active === "quote" ? "30px" : "32px 28px";
  const scaledPadding = padding.replace(/([\d.]+)px/g, (_, n: string) => px(Number(n)));
  const radius = ["book", "quote", "memo", "handwritten"].includes(active) ? 0 : active === "code" ? 5 : active === "frame" ? 12 : 15;
  return `
.edgeever-image-wrapper[data-theme="${active}"] {
  --ee-canvas-bg: ${cfg.canvasBg}; --ee-card-bg: ${cfg.cardBg}; --ee-card-border: ${scaledCss(cfg.cardBorder)};
  --ee-text: ${cfg.textColor}; --ee-heading: ${cfg.headingColor}; --ee-meta: ${cfg.metaColor};
  --ee-line: ${cfg.dividerColor}; --ee-accent: ${cfg.accentColor}; --ee-code-bg: ${cfg.codeBg};
  --ee-quote-bg: ${cfg.quoteBg}; --ee-quote-border: ${cfg.quoteBorder};
  --ee-unit: ${px(1)}; --ee-body-size: ${px(bodySize * textScale)};
  --ee-meta-size: ${px(Math.min(bodySize * 0.78, 13) * textScale)}; --ee-title-size: ${px(titleSize * textScale)};
  width: ${width}px; padding: ${px(inset)}; margin: 0; background: var(--ee-canvas-bg);
  color: var(--ee-text); font-family: ${typography.bodyFamily}; font-size: var(--ee-body-size);
  line-height: ${active === "quote" ? 1.6 : active === "black-sun" ? 1.7 : 1.8}; -webkit-font-smoothing: antialiased;
  font-feature-settings: "chws" 1; overflow: hidden; position: relative; isolation: isolate;
}
.edgeever-image-wrapper, .edgeever-image-wrapper * { box-sizing: border-box; }
.edgeever-image-card {
  position: relative; padding: ${scaledPadding}; border-radius: ${px(radius)};
  background: var(--ee-card-bg); border: var(--ee-card-border); box-shadow: ${scaledCss(cfg.cardShadow)};
  min-width: 0; overflow: hidden;
}
.edgeever-card-header:empty { display: none; }
.edgeever-card-date,
.edgeever-card-meta {
  display: flex; flex-wrap: wrap; align-items: center; gap: ${px(4)} ${px(12)};
  color: var(--ee-meta); font-size: var(--ee-meta-size); font-weight: 400; line-height: 1.5; margin: 0;
  overflow-wrap: anywhere;
}
.edgeever-card-date { margin-bottom: ${px(16)}; }
.edgeever-card-title {
  margin: 0 0 ${px(12)}; padding: 0; color: var(--ee-heading); font-family: ${typography.headingFamily};
  font-size: var(--ee-title-size); font-weight: ${typography.headingWeight}; line-height: 1.35;
  letter-spacing: 0; overflow-wrap: anywhere;
}
.edgeever-card-body { white-space: normal; color: var(--ee-text); font-size: var(--ee-body-size); line-height: inherit; overflow-wrap: anywhere; }
.edgeever-card-body > :first-child { margin-top: 0; }
.edgeever-card-body > :last-child { margin-bottom: 0; }
.edgeever-card-body p { margin: 0; white-space: pre-wrap; }
.edgeever-card-body p + p, .edgeever-card-body p + ul, .edgeever-card-body p + ol { margin-top: 0.7em; }
/* Existing empty paragraphs already provide a blank line. Do not add another gap. */
.edgeever-card-body p:empty, .edgeever-card-body p:has(> br:only-child),
.edgeever-card-body p:empty + p, .edgeever-card-body p:has(> br:only-child) + p { margin-top: 0; }
.edgeever-card-body b, .edgeever-card-body strong { margin: 0 .1em; }
.edgeever-card-body h1, .edgeever-card-body h2, .edgeever-card-body h3,
.edgeever-card-body h4, .edgeever-card-body h5, .edgeever-card-body h6 {
  color: var(--ee-heading); font-family: ${typography.headingFamily}; font-weight: ${typography.headingWeight};
  line-height: 1.5; padding: 0; margin: 1.2em 0 0.5em; overflow-wrap: anywhere;
}
.edgeever-card-body h1 { font-size: 1.3em; }
.edgeever-card-body h2 { font-size: 1.2em; }
.edgeever-card-body h3 { font-size: 1.1em; }
.edgeever-card-body h4, .edgeever-card-body h5, .edgeever-card-body h6 { font-size: 1em; }
.edgeever-card-body ul, .edgeever-card-body ol { margin: 0 0 0.75em; padding-left: 1.35em; }
.edgeever-card-body ul { list-style: disc; }
.edgeever-card-body ol { list-style: decimal; }
.edgeever-card-body ul ul { list-style: circle; }
.edgeever-card-body li { margin: 0.2em 0; }
.edgeever-card-body li > ul, .edgeever-card-body li > ol { margin: 0.35em 0 0; padding-left: 1.2em; }
.edgeever-card-body li > p { margin-bottom: 0; }
.edgeever-card-body ul[data-type="taskList"] { list-style: none; padding: 0; }
.edgeever-card-body ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; }
.edgeever-card-body ul[data-type="taskList"] label { display: inline-flex; flex-shrink: 0; padding-top: 0.4em; }
.edgeever-card-body ul[data-type="taskList"] input { width: 0.85em; height: 0.85em; margin: 0; accent-color: var(--ee-accent); }
.edgeever-card-body ul[data-type="taskList"] li > div { min-width: 0; }
.edgeever-card-body ul[data-type="taskList"] li[data-checked="true"] > div { opacity: 0.6; text-decoration: line-through; }
.edgeever-card-body blockquote {
  margin: 1em 0; padding: 0.1em 0 0.1em 0.9em; border-left: ${px(2)} solid var(--ee-quote-border);
  background: var(--ee-quote-bg); color: inherit;
}
.edgeever-card-body blockquote > :last-child { margin-bottom: 0; }
.edgeever-card-body blockquote > :first-child { margin-top: 0; }
.edgeever-card-body blockquote blockquote { margin: 0.65em 0; padding-left: 0.7em; }
.edgeever-card-body a { color: var(--ee-accent); text-decoration: underline; text-underline-offset: 0.15em; overflow-wrap: anywhere; }
.edgeever-card-body mark { background: ${cfg.isDark ? "rgba(255,225,132,0.2)" : "#fff0a8"}; color: inherit; padding: 0.05em 0.1em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.edgeever-card-body code { background: var(--ee-code-bg); border-radius: ${px(3)}; padding: 0.1em 0.25em; color: inherit; font-family: ${NOTE_IMAGE_FONT_FAMILIES.mono}; font-size: 0.85em; white-space: pre-wrap; }
.edgeever-card-body pre, .edgeever-card-body .edgeever-code-source {
  max-width: 100%; padding: 0.8em; border: 1px solid var(--ee-line); border-radius: ${px(5)};
  margin: 1em 0; background: var(--ee-code-bg); color: inherit; white-space: pre-wrap;
  overflow-wrap: anywhere; font-family: ${NOTE_IMAGE_FONT_FAMILIES.mono}; font-size: 0.85em; line-height: 1.6;
}
.edgeever-card-body pre code { padding: 0; border: 0; background: transparent; font-size: inherit; }
.edgeever-card-body pre *, .edgeever-card-body .edgeever-code-source * { white-space: inherit !important; overflow-wrap: anywhere; }
.edgeever-card-body pre, .edgeever-card-body .edgeever-code-source { tab-size: 4; min-width: 0; }
.edgeever-card-body hr { margin: 1.4em 0; border: 0; border-top: 1px solid var(--ee-line); }
.edgeever-card-body img, .edgeever-card-body .edgeever-html-mermaid svg {
  display: block; max-width: 100%; height: auto; max-height: none; margin: 1em auto; border-radius: ${px(4)};
}
.edgeever-card-body figure, .edgeever-card-body .edgeever-html-mermaid { max-width: 100%; margin: 1em 0; }
.edgeever-card-body .edgeever-image-node, .edgeever-card-body .tableWrapper { min-width: 0; max-width: 100%; height: auto !important; max-height: none !important; overflow: visible !important; }
.edgeever-card-body img { width: auto !important; height: auto !important; min-height: 0 !important; max-height: ${px(480)} !important; object-fit: contain !important; }
.edgeever-card-body [data-edgeever-image-gallery] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 0.6em; margin: 1em 0; }
.edgeever-card-body [data-edgeever-image-gallery][data-image-gallery-layout="1"] { grid-template-columns: minmax(0, 1fr); }
.edgeever-card-body [data-edgeever-image-gallery][data-image-gallery-layout="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.edgeever-card-body [data-edgeever-image-gallery] > *, .edgeever-card-body [data-edgeever-image-gallery] img { margin: 0; min-width: 0; min-height: 0 !important; height: auto !important; background: transparent; }
.edgeever-card-body figcaption { margin-top: 0.5em; color: var(--ee-meta); font-size: 0.78em; line-height: 1.5; text-align: center; }
.edgeever-card-body table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 1em 0; font-size: 0.85em; line-height: 1.5; }
.edgeever-card-body th, .edgeever-card-body td { border: 1px solid var(--ee-line); text-align: left; vertical-align: top; padding: 0.5em; overflow-wrap: anywhere; }
.edgeever-card-body th { background: ${cfg.tableThBg}; font-weight: 600; }
.edgeever-card-body table[data-edgeever-export-table="stacked"],
.edgeever-card-body table[data-edgeever-export-table="stacked"] > thead,
.edgeever-card-body table[data-edgeever-export-table="stacked"] > tbody { display: block; width: 100%; }
.edgeever-card-body [data-edgeever-export-header] { display: none !important; }
.edgeever-card-body table[data-edgeever-export-table="stacked"] tr { display: block; margin: 0 0 0.75em; padding: 0.5em; border: 1px solid var(--ee-line); border-radius: ${px(5)}; }
.edgeever-card-body table[data-edgeever-export-table="stacked"] td,
.edgeever-card-body table[data-edgeever-export-table="stacked"] th { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 0.75em; padding: 0.5em; border: 0; background: transparent; font-weight: 400; }
.edgeever-card-body .edgeever-table-label { color: var(--ee-meta); font-weight: 600; }
.edgeever-card-body .edgeever-table-value { min-width: 0; }
.edgeever-card-body [data-edgeever-theme-block] { border-left: ${px(2)} solid var(--ee-accent); background: ${cfg.metaBg}; padding: 0.8em; margin: 1em 0; }
.edgeever-card-body .edgeever-image-panel, .edgeever-card-body .edgeever-image-controls, .edgeever-card-body .edgeever-code-copy-button,
.edgeever-card-body .edgeever-theme-block__toolbar, .edgeever-card-body .edgeever-mermaid-source { display: none !important; }
.edgeever-card-footer { display: flex; flex-direction: column; gap: ${px(12)}; margin-top: ${px(24)}; color: var(--ee-meta); font-size: var(--ee-meta-size); }
.edgeever-footer-author { display: flex; align-items: center; gap: ${px(8)}; min-width: 0; overflow-wrap: anywhere; }
.edgeever-footer-author > span { min-width: 0; }
.edgeever-brand-badge {
  display: flex; align-items: center; gap: ${px(7)}; border-top: 1px solid var(--ee-line);
  padding-top: ${px(12)}; color: var(--ee-meta); font-family: ${NOTE_IMAGE_FONT_FAMILIES.sans};
  font-size: ${px(12)}; font-weight: 500;
}
.edgeever-brand-logo { opacity: 1; width: ${px(18)}; height: ${px(18)}; flex-shrink: 0; }
.edgeever-window-dots { display: inline-flex; gap: ${px(6)}; align-items: center; flex-shrink: 0; }
.edgeever-window-dots i { display: block; width: ${px(12)}; height: ${px(12)}; border-radius: 50%; background: #ed6a5e; }
.edgeever-window-dots i:nth-child(2) { background: #f4bf4f; }
.edgeever-window-dots i:nth-child(3) { background: #61c554; }
${active === "book" ? `
.edgeever-image-wrapper {
  background-image: linear-gradient(90deg, rgba(101,77,43,0.09), transparent 6%, transparent 96%, rgba(101,77,43,0.04));
}
.edgeever-image-wrapper::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: var(--ee-paper) repeat center / ${px(320)}; opacity: 0.045; z-index: 0;
}
.edgeever-image-card { min-height: 0; z-index: 1; }
.edgeever-card-body { font-weight: 400; letter-spacing: ${px(1)}; }
.edgeever-card-date { margin-bottom: ${px(20)}; }
.edgeever-card-title { font-weight: 700; line-height: 1.4; margin-bottom: ${px(14)}; }
.edgeever-card-header { display: flex; flex-direction: column; }
.edgeever-footer-author { line-height: 1.6; }
` : ""}
${active === "quote" ? `
.edgeever-card-title { font-size: ${px(28.8 * textScale)}; font-weight: 700; line-height: 1.6; margin-top: ${px(8)}; margin-bottom: ${px(4)}; }
.edgeever-card-body { font-weight: 400; }
.edgeever-card-footer { margin-top: ${px(20)}; }
.edgeever-image-wrapper[data-short-quote="true"] .edgeever-card-body > p:only-child { font-size: 2em; font-weight: 700; line-height: 1.6; }
.edgeever-footer-author { justify-content: flex-end; font-weight: 400; }
.edgeever-card-meta { justify-content: flex-end; }
.edgeever-brand-badge { justify-content: flex-end; border: 0; }
` : ""}
${active === "memo" ? `
.edgeever-memo-toolbar { display: flex; align-items: center; gap: ${px(16)}; margin: 0 -${px(12)}; padding: ${px(16)} 0 ${px(6)}; color: #e5ae00; }
.edgeever-memo-toolbar span { flex: 1; }
.edgeever-memo-toolbar svg { width: ${px(22)}; height: ${px(22)}; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.edgeever-card-date { justify-content: center; margin-bottom: ${px(12)}; }
.edgeever-card-title { font-weight: 700; line-height: 1.4; margin-bottom: ${px(6)}; }
.edgeever-image-card { min-height: 0; }
.edgeever-brand-badge { border: 0; justify-content: center; }
` : ""}
${active === "bento" ? `
.edgeever-card-header { display: grid; gap: ${px(8)}; margin-bottom: ${px(8)}; padding: ${px(16)} ${px(20)}; background: #ffffff; border-radius: ${px(12)}; }
.edgeever-card-date, .edgeever-card-title { margin: 0; }
.edgeever-card-body { padding: ${px(16)} ${px(20)}; background: #ffffff; border-radius: ${px(12)}; }
.edgeever-card-footer { margin-top: ${px(8)}; padding: ${px(12)} ${px(20)}; background: #ffffff; border-radius: ${px(12)}; }
.edgeever-brand-badge { border: 0; padding: 0; }
` : ""}
${active === "black-sun" ? `
.edgeever-image-card { padding: ${px(30)}; border: 0; background: #000410; box-shadow: 0 -${px(12)} ${px(34)} rgba(255,255,255,0.1), 0 -${px(10)} ${px(15)} rgba(255,255,255,0.4), 0 -${px(1)} ${px(3)} rgba(255,255,255,0.8), 0 -${px(10)} ${px(40)} rgba(92,84,175,0.5); }
.edgeever-card-title { line-height: 1.4; text-shadow: 0 0 ${px(6)} rgba(175,160,255,0.6); }
.edgeever-brand-badge { justify-content: center; border: 0; }
` : ""}
${active === "frame" ? `
.edgeever-image-card { padding-top: 0; border-radius: ${px(10)}; }
.edgeever-frame-toolbar { display: flex; align-items: center; justify-content: space-between; gap: ${px(12)}; padding: ${px(16)} ${px(8)}; margin-bottom: ${px(20)}; border-bottom: ${px(2)} solid #000000; }
.edgeever-frame-toolbar .edgeever-window-dots { margin-left: auto; }
.edgeever-frame-toolbar .edgeever-window-dots i { border: ${px(1.5)} solid #000000; width: ${px(12)}; height: ${px(12)}; background: transparent; }
.edgeever-frame-toolbar .edgeever-window-dots i:nth-child(2) { background: #000000; }
.edgeever-card-title { line-height: 1.625; }
.edgeever-card-title, .edgeever-card-body { padding-left: ${px(8)}; padding-right: ${px(8)}; }
.edgeever-card-date { padding-left: ${px(8)}; padding-right: ${px(8)}; }
.edgeever-card-footer { border-top: 1px solid var(--ee-line); padding: ${px(12)} ${px(8)} 0; }
.edgeever-brand-badge { border: 0; padding: 0; }
` : ""}
${active === "handwritten" ? `
.edgeever-image-wrapper::before, .edgeever-image-wrapper::after { content: ""; position: absolute; inset: 0; pointer-events: none; }
.edgeever-image-wrapper::before { background: var(--ee-paper) no-repeat center / cover; z-index: 2; }
.edgeever-image-wrapper::after { background: var(--ee-paper-grain) repeat; filter: blur(${px(3)}); z-index: 3; }
.edgeever-image-card { overflow: visible; }
.edgeever-card-header, .edgeever-card-body, .edgeever-card-footer { position: relative; z-index: 4; }
.edgeever-card-title { font-weight: 400; }
.edgeever-card-date, .edgeever-card-footer { color: #746d60; line-height: 1.6; }
.edgeever-card-header { display: flex; flex-direction: column; }
.edgeever-card-meta, .edgeever-footer-author { justify-content: flex-end; }
.edgeever-card-meta, .edgeever-brand-badge { color: inherit; }
.edgeever-brand-badge { justify-content: center; border: 0; }
` : ""}
${active === "code" ? `
.edgeever-image-card { padding: 0; }
.edgeever-terminal-header { position: relative; display: flex; align-items: center; height: ${px(26)}; padding-top: ${px(10)}; margin: 0; }
.edgeever-terminal-name { display: block; width: 100%; padding: 0 ${px(65)}; text-align: center; color: #999999; font-size: ${px(12)}; line-height: 1.333333; overflow-wrap: anywhere; }
.edgeever-terminal-header .edgeever-window-dots { position: absolute; left: ${px(16)}; top: ${px(16)}; }
.edgeever-card-header { padding: ${px(16)} ${px(16)} 0; }
.edgeever-card-title { margin: 0 0 ${px(12)}; }
.edgeever-card-title:last-child { margin-bottom: 0; }
.edgeever-card-body { padding: ${px(16)} ${px(16)} ${px(21)}; min-height: ${px(37)}; line-height: 1.6; }
.edgeever-card-date { margin: 0; }
.edgeever-card-footer { margin: 0 ${px(16)} ${px(16)}; }
.edgeever-card-body pre { border: 0; padding: 0; margin: 0; font-family: inherit; font-size: inherit; line-height: 1.6; }
.edgeever-card-body pre code, .edgeever-card-body .edgeever-code-source { font-family: inherit; font-size: inherit; }
.edgeever-brand-badge { }
` : ""}
`;
};
