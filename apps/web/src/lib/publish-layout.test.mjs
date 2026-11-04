import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PUBLISH_LAYOUT,
  DEFAULT_PUBLISH_PALETTE,
  PAPER_EDITOR_THEME_PALETTES,
  PUBLISH_LAYOUT_CHROME,
  PUBLISH_LAYOUT_IDS,
  PUBLISH_LAYOUT_RHYTHM,
  PUBLISH_PALETTE_IDS,
  PUBLISH_PALETTES,
  assertWeChatSafeCss,
  buildPublishStyles,
  collectPublishStyleText,
  formatChapterIndex,
  planHeadingDecoration,
  publishEditorCssVars,
  resolvePaperEditorTheme,
  resolveStoredPublishLayout,
  resolveStoredPublishPalette,
} from "./publish-layout.ts";

describe("publish layout catalog", () => {
  test("keeps ten paper editor themes and a palette per layout", () => {
    expect(PUBLISH_LAYOUT_IDS).toEqual([
      "letter",
      "guide",
      "blueprint",
      "journal",
      "stance",
      "stub",
      "brief",
      "outline",
      "zen",
      "grove",
    ]);
    expect(PUBLISH_PALETTE_IDS).toEqual([
      "emerald",
      "ink",
      "dawn",
      "clay",
      "navy",
      "slate",
      "plum",
      "forest",
      "azure",
      "amber",
      "teal",
      "violet",
      "mist",
    ]);
    expect(DEFAULT_PUBLISH_LAYOUT).toBe("letter");
    expect(DEFAULT_PUBLISH_PALETTE).toBe("emerald");
    expect(PUBLISH_PALETTES.emerald.accent).toBe("#16A06E");
    expect(PUBLISH_PALETTES.dawn.accent).toBe("#D9A521");
    expect(PUBLISH_PALETTES.azure.accent).toBe("#2F80ED");
    expect(PUBLISH_PALETTES.azure.surface).toBe("#F5F8FC");
    expect(PUBLISH_PALETTES.azure.surface).not.toBe("#F0FDF4");
    expect(PUBLISH_PALETTES.clay.accent).toBe("#E02D32");
  });

  test("maps paper editor themes to a fixed layout and palette", () => {
    expect(resolvePaperEditorTheme("letter")).toEqual({ layout: "letter", palette: "dawn" });
    expect(resolvePaperEditorTheme("guide")).toEqual({ layout: "guide", palette: "azure" });
    expect(PAPER_EDITOR_THEME_PALETTES).toEqual({
      letter: "dawn",
      guide: "azure",
      blueprint: "navy",
      journal: "slate",
      stance: "clay",
      stub: "amber",
      brief: "teal",
      outline: "violet",
      zen: "mist",
      grove: "forest",
    });
    expect(resolvePaperEditorTheme("default")).toBeNull();
  });

  test("falls back to defaults for unknown stored values", () => {
    expect(resolveStoredPublishLayout(null)).toBe("letter");
    expect(resolveStoredPublishLayout("sunlit-ledger")).toBe("letter");
    expect(resolveStoredPublishPalette("morning-cream")).toBe("emerald");
    expect(resolveStoredPublishPalette("dawn")).toBe("dawn");
  });

  test("numbers magazine chapters without CSS counters", () => {
    expect(formatChapterIndex(0)).toBe("01");
    expect(planHeadingDecoration("h2", "letter", 0)).toEqual({ kind: "chapter", chapterLabel: "01" });
    expect(planHeadingDecoration("h2", "guide", 0)).toEqual({ kind: "chapter", chapterLabel: "01" });
    expect(planHeadingDecoration("h2", "blueprint", 1)).toEqual({ kind: "none" });
    expect(planHeadingDecoration("h2", "stub", 0)).toEqual({ kind: "chapter", chapterLabel: "01" });
    expect(planHeadingDecoration("h2", "grove", 0)).toEqual({ kind: "none" });
    expect(planHeadingDecoration("h1", "letter", 0)).toEqual({ kind: "title" });
    expect(planHeadingDecoration("h4", "letter", 0)).toEqual({ kind: "none" });
    expect(planHeadingDecoration("h6", "guide", 0)).toEqual({ kind: "none" });
    expect(PUBLISH_LAYOUT_CHROME.letter.chapter).toBe("aside-serif");
    expect(PUBLISH_LAYOUT_CHROME.letter.quote).toBe("grid-card");
    expect(PUBLISH_LAYOUT_CHROME.brief.quoteBanner).toBe("EDITOR'S NOTE");
    expect(PUBLISH_LAYOUT_CHROME.grove.small).toBe("slash");
  });
});

describe("publish layout CSS", () => {
  test("typesets phone output for a 375-wide reading column", () => {
    const phone = buildPublishStyles("letter", PUBLISH_PALETTES.emerald, "phone");
    const desktop = buildPublishStyles("letter", PUBLISH_PALETTES.emerald, "desktop");

    expect(phone.p).toContain("font-size: 15px");
    expect(phone.p).toContain("line-height: 2");
    expect(phone.p).toContain("letter-spacing: 0.06em");
    expect(phone.p).toContain("margin: 0 0 28px");
    expect(phone.h1).toContain("font-size: 24px");
    expect(phone.h2).toContain("font-size: 20px");
    expect(phone.h4).toContain("font-size: 14px");
    expect(phone.h6).toContain("font-size: 13px");
    expect(desktop.p).toContain("font-size: 15px");
    expect(desktop.p).toContain("line-height: 2");
  });

  test("uses a looser reading rhythm than the note editor contract", () => {
    const letter = buildPublishStyles("letter", PUBLISH_PALETTES.dawn);
    const blueprint = buildPublishStyles("blueprint", PUBLISH_PALETTES.navy);

    expect(letter.p).toContain("line-height: 2");
    expect(letter.p).toContain("letter-spacing: 0.06em");
    expect(letter.p).toContain("margin: 0 0 28px");
    expect(letter.h1).toContain("text-align: center");
    expect(letter.h1).toContain("letter-spacing: 0.08em");
    expect(blueprint.h2).toContain("border-left: 3px solid #4271B3");
    expect(letter.blockquote).toContain("border-radius: 18px");
    expect(letter.strong).toContain("color: #D9A521");
    expect(letter.th).toContain("background: #FFF7DF");
    expect(letter.a).toContain("color: #7C5500");
  });

  test("gives each paper theme its own line height and tracking", () => {
    const stance = buildPublishStyles("stance", PUBLISH_PALETTES.clay);
    const zen = buildPublishStyles("zen", PUBLISH_PALETTES.mist);
    const stub = buildPublishStyles("stub", PUBLISH_PALETTES.amber);

    expect(PUBLISH_LAYOUT_RHYTHM.stance.lineHeight).toBe("1.68");
    expect(PUBLISH_LAYOUT_RHYTHM.zen.lineHeight).toBe("2.2");
    expect(stance.p).toContain("letter-spacing: 0em");
    expect(zen.p).toContain("letter-spacing: 0.1em");
    expect(stub.h1).toContain("letter-spacing: 0.14em");
    expect(new Set(Object.values(PUBLISH_LAYOUT_RHYTHM).map((rhythm) => rhythm.lineHeight)).size).toBe(10);
    expect(new Set(Object.values(PUBLISH_LAYOUT_RHYTHM).map((rhythm) => rhythm.letterSpacing)).size).toBe(10);
  });

  test("keeps WeChat-safe inline CSS for every layout and palette", () => {
    for (const layout of PUBLISH_LAYOUT_IDS) {
      for (const paletteId of PUBLISH_PALETTE_IDS) {
        const css = collectPublishStyleText(buildPublishStyles(layout, PUBLISH_PALETTES[paletteId]));
        expect(assertWeChatSafeCss(css)).toBe(true);
      }
    }
  });
});

describe("copy pipeline wiring", () => {
  test("wechat copy uses account prose and no longer applies paper layouts", () => {
    const source = readFileSync(new URL("./wechat-copy.ts", import.meta.url), "utf8");
    const preferenceCard = readFileSync(new URL("../components/settings/PreferenceCard.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("resolvePaperEditorTheme");
    expect(source).not.toContain("applyPublishLayout");
    expect(source).toContain("noteProseCodeFontSize");
    expect(source).toContain("NOTE_PROSE_HEADING_SCALE");
    expect(source).toContain('rhythm["--editor-paragraph-spacing"]');
    expect(source).toContain("[data-note-palette]");
    expect(source).toContain("preparePublishArticle");
    expect(source).not.toContain("editorThemeOverride");
    expect(source).toContain("ProseMirror-separator");
    expect(source).toContain("findOriginalImage");
    expect(source).toContain("svgToWeChatImage");
    expect(source).toContain("rasterizePublishOrnamentsForWeChat");
    expect(source).toContain('fillStyle = "#ffffff"');
    expect(source).toContain("image/jpeg");
    expect(source).toContain("text-align: center");
    expect(preferenceCard).not.toContain('t("settings.publishLayoutTitle")');
    expect(preferenceCard).not.toContain('t("settings.editorThemeTitle")');
  });

  test("keeps paper layout styles available without applying them in the editor", () => {
    const editorPane = readFileSync(new URL("../components/EditorPane.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("../styles/publish-layout.css", import.meta.url), "utf8");
    const vars = publishEditorCssVars("letter", "dawn");

    expect(PUBLISH_LAYOUT_RHYTHM.letter.lineHeight).toBe("2");
    expect(PUBLISH_LAYOUT_RHYTHM.letter.paragraphSpacing).toBe("28px");
    expect(vars["--editor-body-line-height"]).toBe("2");
    expect(vars["--editor-letter-spacing"]).toBe("0.06em");
    expect(vars["--editor-heading-letter-spacing"]).toBe("0.08em");
    expect(css).toContain("letter-spacing: var(--editor-letter-spacing)");
    expect(css).toContain("letter-spacing: var(--editor-heading-letter-spacing)");
    expect(vars["--publish-accent"]).toBe("#D9A521");
    expect(vars["--publish-accent-grid"]).toBe("rgba(217,165,33,0.14)");
    expect(vars["--brand-green-rgb"]).toBe("217 165 33");
    expect(vars["--publish-ornament-brush"]).toContain("url(\"data:image/svg+xml");
    expect(css).toContain("--editor-theme-accent: var(--publish-accent)");
    expect(css).toContain("--brand-green: var(--publish-accent)");
    expect(editorPane).toContain('data-editor-theme="default"');
    expect(editorPane).not.toContain("isPaperEditorTheme");
    expect(editorPane).not.toContain("publishEditorCssVars");
    expect(editorPane).not.toContain("data-paper-theme");
    expect(css).toContain("counter-increment: publish-h2");
    expect(css).toContain("[data-paper-theme]");
    expect(css).toContain('[data-editor-theme="letter"]');
    expect(css).toContain('[data-editor-theme="stance"]');
    expect(css).toContain('[data-editor-theme="grove"]');
    expect(css).toContain("line-height: var(--editor-body-line-height)");
  });

  test("phone preview markup follows account prose instead of a paper layout", () => {
    const source = readFileSync(new URL("./wechat-copy.ts", import.meta.url), "utf8");
    const preview = readFileSync(new URL("../components/EditorPhonePreview.tsx", import.meta.url), "utf8");
    expect(source).toContain("export const preparePublishArticle");
    expect(source).not.toContain("applyPublishLayout");
    expect(source).toContain("applyLegacyWeChatStyles");
    expect(source).toContain("const bold = colors ? `font-weight: 800; color: ${accent};` : \"font-weight: 800;\"");
    expect(source).toContain("accentOnly");
    expect(source).toContain("#27272a");
    expect(source).toContain("#3d4450");
    expect(source).toContain("#f3f5f7");
    expect(source).toContain("data-ee-math");
    expect(source).toContain("katex.renderToString");
    expect(source).toContain("rasterizeMathForWeChat");
    expect(source).not.toContain("#be123c");
    expect(source).not.toContain("#10b981");
    expect(source).not.toContain("#f0fdf4");
    expect(source).toContain('palette !== "native"');
    expect(source).not.toContain('palette !== "custom"');
    expect(preview).toContain("preparePublishArticle(editor.getHTML(), editor.view.dom)");
    expect(preview).toContain("previewRef.current?.setAttribute(\"style\", markup.style)");
    expect(preview).toContain("noteProse");
    expect(preview).not.toContain("key={editorTheme}");
  });
});
