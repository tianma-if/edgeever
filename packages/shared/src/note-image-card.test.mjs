import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import {
  NOTE_IMAGE_BUNDLED_FONTS, NOTE_IMAGE_TEMPLATE_TYPOGRAPHY, NOTE_IMAGE_THEME_OPTIONS, NOTE_IMAGE_THEMES, NOTE_IMAGE_BACKGROUND_COLORS, NOTE_IMAGE_FONT_FAMILIES,
  resolveTheme, resolveNoteImageTypography, buildImageExportBasename, buildNoteImageCardMarkup,
  estimateReadingStats, generateCardCss,
} from "./note-image-card";
import { zhCN } from "./i18n/zh-CN";
import { enUS } from "./i18n/en-US";
import { ja } from "./i18n/ja";
import { pl } from "./i18n/pl";
import { ru } from "./i18n/ru";
import { NOTE_IMAGE_FONT_SUBSETS } from "./note-image-font-manifest";

describe("note image templates", () => {
  test("author signatures show only the name without a generated avatar in every template", () => {
    for (const theme of NOTE_IMAGE_THEME_OPTIONS) {
      const markup = buildNoteImageCardMarkup({ theme, title: "Note", bodyHtml: "<p>Text</p>", author: "天马", showAuthor: true });
      const { document } = parseHTML(markup);
      const signature = document.querySelector(".edgeever-footer-author");
      expect(signature?.textContent).toBe("天马");
      expect(signature?.children.length).toBe(1);
      expect(document.querySelector(".edgeever-card-avatar")).toBeNull();
    }
  });

  test("each template references the font family registered by its bundled assets", () => {
    for (const theme of NOTE_IMAGE_THEME_OPTIONS) {
      const preset = NOTE_IMAGE_TEMPLATE_TYPOGRAPHY[theme];
      for (const role of ["body", "heading"]) {
        const familyStack = resolveNoteImageTypography(theme)[`${role}Family`];
        for (const font of preset[role]) {
          const subsets = NOTE_IMAGE_FONT_SUBSETS[font];
          expect(subsets.length).toBeGreaterThan(0);
          for (const { family } of subsets) {
            expect(family).toBe(NOTE_IMAGE_BUNDLED_FONTS[font].family);
            expect(familyStack).toContain(`"${family}"`);
          }
        }
      }
    }
  });

  test("every selectable template is localized and has renderable colors", () => {
    for (const theme of NOTE_IMAGE_THEME_OPTIONS) {
      expect(NOTE_IMAGE_THEMES[theme]).toBeDefined();
      expect(NOTE_IMAGE_BACKGROUND_COLORS[theme]).toMatch(/^#[\da-f]{6}$/i);
      for (const locale of [zhCN, enUS, ja, pl, ru]) expect(locale.editor.imageShare.themes[theme]).toBeTruthy();
    }
    for (const retired of ["paper", "press", "highlight", "slate", "mint", "aurora", "sunset", "terminal"]) {
      expect(NOTE_IMAGE_THEME_OPTIONS).not.toContain(retired);
    }
  });

  test("old export settings resolve to supported templates through either input", () => {
    const mapping = {
      gradient: "glass",
      paper: "handwritten", press: "book", highlight: "memo", slate: "frame", mint: "quote",
      aurora: "glass", sunset: "glass", terminal: "code", midnight: "black-sun", editorial: "frame",
      film: "book", lavender: "glass", notepad: "memo", xuan: "handwritten", polaroid: "frame", warm: "glass",
    };
    for (const [old, active] of Object.entries(mapping)) {
      expect(resolveTheme(old)).toBe(active);
      expect(resolveTheme(undefined, old)).toBe(active);
      expect(buildNoteImageCardMarkup({ title: "Note", bodyHtml: "<p>Text</p>", theme: old })).toContain(`data-theme="${active}"`);
    }
    expect(resolveTheme()).toBe("glass");
    expect(resolveTheme("book", "missing")).toBe("book");
    expect(resolveTheme("__proto__", "constructor")).toBe("glass");
  });

  test("explicit fonts override both heading and body for every template", () => {
    expect(resolveNoteImageTypography("book").bodyFamily).toContain("SourceHanSerifCN_SemiBold");
    expect(resolveNoteImageTypography("handwritten").bodyFamily).toContain("Long Cang");
    expect(resolveNoteImageTypography("code").bodyFamily).toContain("Geist Mono Variable");
    for (const theme of NOTE_IMAGE_THEME_OPTIONS) for (const font of ["sans", "serif", "kai", "mono"]) {
      const typography = resolveNoteImageTypography(theme, font);
      expect(typography.bodyFamily).toBe(NOTE_IMAGE_FONT_FAMILIES[font]);
      expect(typography.headingFamily).toBe(NOTE_IMAGE_FONT_FAMILIES[font]);
    }
  });

  test("unselected metadata stays private in all decorations", () => {
    for (const theme of NOTE_IMAGE_THEME_OPTIONS) {
      const markup = buildNoteImageCardMarkup({
        theme, title: "Private title", notebook: "Private notebook", author: "Private author", tags: ["Private tag"],
        updatedAt: "Private date", bodyHtml: "<p>Public body</p>", showUpdatedAt: false, showBranding: false,
      });
      for (const hidden of ["Private title", "Private notebook", "Private author", "Private tag", "Private date", "EdgeEver"]) expect(markup).not.toContain(hidden);
      expect(markup).toContain("<p>Public body</p>");
    }
  });

  test("escapes enabled metadata while preserving prepared rich text", () => {
    const markup = buildNoteImageCardMarkup({
      theme: "frame", title: '<img src=x onerror="x">', notebook: "A&B", tags: ["<tag>"],
      author: "<author>", updatedAt: "<date>", bodyHtml: '<p><strong>Kept</strong></p><img src="data:image/png;base64,AA==">',
      showTitle: true, showNotebook: true, showTags: true, showAuthor: true,
    });
    expect(markup).not.toContain('<img src=x');
    expect(markup).toContain("&lt;img");
    expect(markup).toContain("A&amp;B");
    expect(markup).toContain("#&lt;tag&gt;");
    expect(markup).toContain("&lt;author&gt;");
    expect(markup).toContain("&lt;date&gt;");
    expect(markup).toContain('<p><strong>Kept</strong></p><img src="data:image/png;base64,AA==">');
  });

  test("code window respects the title and notebook visibility switches", () => {
    const hidden = buildNoteImageCardMarkup({ theme: "code", title: "Secret", notebook: "Hidden", bodyHtml: "" });
    expect(hidden).toContain("note.md");
    expect(hidden).not.toContain("Secret");
    expect(hidden).not.toContain("Hidden");
    const shown = buildNoteImageCardMarkup({ theme: "code", title: "Visible", bodyHtml: "", showTitle: true });
    expect(shown.match(/Visible/g)).toHaveLength(1);
    const mono = buildNoteImageCardMarkup({ theme: "book", title: "Note", bodyHtml: "", fontStyle: "mono" });
    expect(mono).not.toContain("edgeever-terminal-header");
  });

  test("an empty author does not create an empty footer when branding is hidden", () => {
    const markup = buildNoteImageCardMarkup({ title: "Note", bodyHtml: "", author: "  ", showAuthor: true, showBranding: false });
    expect(markup).not.toContain("edgeever-card-footer");
  });

  test("branding never creates an anonymous header avatar", () => {
    for (const theme of NOTE_IMAGE_THEME_OPTIONS) {
      for (const author of ["", "  ", "Hidden author"]) {
        const markup = buildNoteImageCardMarkup({ theme, title: "Note", bodyHtml: "<p>Body</p>", author, showBranding: true });
        expect(markup).not.toContain('class="edgeever-card-avatar"');
        expect(markup.match(/class="edgeever-brand-badge"/g)).toHaveLength(1);
      }
    }
    const signed = buildNoteImageCardMarkup({ theme: "bento", title: "Note", bodyHtml: "", author: "天马", showAuthor: true, showBranding: false });
    expect(signed).not.toContain('class="edgeever-card-avatar"');
    expect(signed).toContain('<span>天马</span>');
    expect(signed).toContain('<span>天马</span>');
    expect(signed).not.toContain('class="edgeever-brand-badge"');
  });

  test("every metadata combination keeps date above content and auxiliary details below it", () => {
    for (const theme of NOTE_IMAGE_THEME_OPTIONS) for (let mask = 0; mask < 128; mask++) {
      const [showTitle, showUpdatedAt, showNotebook, showTags, showReadingTime, showAuthor, showBranding] =
        Array.from({ length: 7 }, (_, index) => Boolean(mask & (1 << index)));
      const { document } = parseHTML(buildNoteImageCardMarkup({
        theme, title: "Title", updatedAt: "2026/10/18", notebook: "Notebook", tags: ["tag"], author: "Author",
        bodyHtml: "<p>Content</p>", showTitle, showUpdatedAt, showNotebook, showTags, showReadingTime, showAuthor, showBranding,
      }));
      const header = document.querySelector(".edgeever-card-header");
      const footer = document.querySelector(".edgeever-card-footer");
      expect(Boolean(header)).toBe(showTitle || showUpdatedAt);
      expect(Boolean(footer)).toBe(showNotebook || showTags || showReadingTime || showAuthor || showBranding);
      expect(Boolean(header?.querySelector(".edgeever-meta-date"))).toBe(showUpdatedAt);
      expect(Boolean(header?.querySelector(".edgeever-card-title"))).toBe(showTitle);
      expect(Boolean(footer?.querySelector(".edgeever-meta-notebook"))).toBe(showNotebook);
      expect(Boolean(footer?.querySelector(".edgeever-meta-tag"))).toBe(showTags);
      expect(Boolean(footer?.querySelector(".edgeever-meta-reading"))).toBe(showReadingTime);
      expect(Boolean(footer?.querySelector(".edgeever-footer-author"))).toBe(showAuthor);
      expect(Boolean(footer?.querySelector(".edgeever-brand-badge"))).toBe(showBranding);
      expect(header?.querySelector(".edgeever-card-avatar")).toBeFalsy();
      expect(document.querySelector(".edgeever-terminal-header")?.textContent || "").not.toContain("Notebook");
    }
  });

  test("empty metadata never creates blank header or footer panels", () => {
    for (const theme of NOTE_IMAGE_THEME_OPTIONS) {
      const markup = buildNoteImageCardMarkup({ theme, title: " ", updatedAt: " ", notebook: " ", tags: ["", " "], author: " ", bodyHtml: "<p>Content</p>",
        showTitle: true, showUpdatedAt: true, showNotebook: true, showTags: true, showAuthor: true, showBranding: false });
      expect(markup).not.toContain('class="edgeever-card-header"');
      expect(markup).not.toContain('class="edgeever-card-footer"');
    }
  });

  test("only standalone short quotes receive display typography without a title", () => {
    const cases = [
      ["<p>把想法写清楚。</p>", true], ["<p><strong>Less, but better.</strong></p>", true],
      [`<p>${"长文内容".repeat(30)}</p>`, false], ["<p>第一段</p><p>第二段</p>", false],
      ["<p>第一行<br>第二行</p>", false], ["<p></p>", false], ["<p><br></p>", false],
      ["<p>&nbsp;</p>", false], ["<p>&#160;</p>", false],
      ["<h2>小标题</h2><p>正文</p>", false], ['<p><img src="image.png">配图</p>', false],
    ];
    for (const [bodyHtml, short] of cases) {
      const markup = buildNoteImageCardMarkup({ theme: "quote", title: "Title", bodyHtml, showTitle: false });
      expect(markup).toContain(`data-short-quote="${short}"`);
      expect(markup).toContain(bodyHtml);
    }
    expect(buildNoteImageCardMarkup({ theme: "quote", title: "Title", bodyHtml: "<p>Short</p>", showTitle: true })).toContain('data-short-quote="false"');
  });

  test("export styles stay scoped and do not depend on viewport height", () => {
    for (const theme of NOTE_IMAGE_THEME_OPTIONS) {
      const css = generateCardCss({ theme, fontStyle: "auto", fontSize: "lg", cardWidth: "compact" });
      expect(css).not.toContain(":root");
      expect(css).not.toMatch(/(?:^|\n)\s*\*\s*\{/);
      expect(css).not.toMatch(/\d+vh/);
      expect(css).not.toMatch(/url\(["']?https?:\/\//);
    }
  });

  test("keeps mixed-language reading statistics and portable filenames", () => {
    const stats = estimateReadingStats("<p>中文阅读与 English words.</p>");
    expect(stats.totalCount).toBe(7);
    expect(stats.minutes).toBe(1);
    expect(buildImageExportBasename(" Roadmap: Q3/Q4. ", "Untitled")).toBe("Roadmap- Q3-Q4");
    expect(buildImageExportBasename("CON", "Untitled")).toBe("_CON");
    expect(buildImageExportBasename("   ", "Untitled")).toBe("Untitled");
  });
});
