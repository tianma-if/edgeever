import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { MEMO_CONTENT_STYLE } from "@edgeever/shared";

const PRESET_THEME_FILES = [
  "minimal-emerald.css",
  "outline-emerald.css",
  "wechat-green.css",
  "modern-mint.css",
  "marxico.css",
];

const readStyle = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const declarationsForSelector = (source, selectorSuffix) =>
  [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(",").some((selector) => selector.trim().endsWith(selectorSuffix)))
    .map(([, , declarations]) => declarations)
    .join("\n");

describe("editor typography contract", () => {
  test("keeps the shared body rhythm compact", () => {
    expect(MEMO_CONTENT_STYLE.body.lineHeight / MEMO_CONTENT_STYLE.body.fontSize).toBe(1.6);
    expect(MEMO_CONTENT_STYLE.body.paragraphSpacing).toBe(6);
  });

  test("styles default-theme external hyperlinks so they are distinct from body text", () => {
    const globals = readStyle("./globals.css");
    const linkRules = declarationsForSelector(globals, ".ProseMirror a");
    const markdownLinkRules = declarationsForSelector(globals, ".markdown-content a");

    expect(linkRules).toMatch(/color\s*:\s*var\(--brand-green-text\)/);
    expect(linkRules).toMatch(/text-decoration\s*:\s*underline/);
    expect(markdownLinkRules).toMatch(/color\s*:\s*var\(--brand-green-text\)/);
    expect(markdownLinkRules).toMatch(/text-decoration\s*:\s*underline/);
  });

  test("keeps the rich-editor placeholder aligned with body typography", () => {
    const globals = readStyle("./globals.css");
    const placeholderRules = declarationsForSelector(
      globals,
      ".ProseMirror.edgeever-note-rich-editor p.is-empty::before",
    );

    expect(placeholderRules).toMatch(/font-size\s*:\s*inherit/);
    expect(placeholderRules).toMatch(/line-height\s*:\s*inherit/);
  });

  test("keeps bold and italic text visible across platform font fallbacks", () => {
    const globals = readStyle("./globals.css");
    const mobileEditor = readStyle("./mobile-markdown-editor.css");
    const defaultBoldRules = declarationsForSelector(globals, ".ProseMirror strong");
    const defaultItalicRules = declarationsForSelector(globals, ".ProseMirror em");
    const mobileBoldRules = declarationsForSelector(
      mobileEditor,
      ".edgeever-mobile-tiptap-content strong",
    );
    const mobileItalicRules = declarationsForSelector(
      mobileEditor,
      ".edgeever-mobile-tiptap-content em",
    );

    expect(defaultBoldRules).toMatch(/font-synthesis\s*:\s*weight style/);
    expect(defaultBoldRules).toMatch(/font-weight\s*:\s*800/);
    expect(defaultItalicRules).toMatch(/font-synthesis\s*:\s*weight style/);
    expect(defaultItalicRules).toMatch(/font-style\s*:\s*italic/);
    expect(mobileBoldRules).toMatch(/font-synthesis\s*:\s*weight style/);
    expect(mobileBoldRules).toMatch(/font-weight\s*:\s*800/);
    expect(mobileItalicRules).toMatch(/font-synthesis\s*:\s*weight style/);
    expect(mobileItalicRules).toMatch(/font-style\s*:\s*italic/);

    for (const filename of PRESET_THEME_FILES) {
      const source = readStyle(`./editor-themes/${filename}`);
      const boldRules = declarationsForSelector(source, ".ProseMirror strong");
      const weights = [...boldRules.matchAll(/font-weight\s*:\s*(\d+)/g)].map((match) => Number(match[1]));

      expect(weights.length).toBeGreaterThan(0);
      expect(Math.max(...weights)).toBeGreaterThanOrEqual(700);
    }
  });

  test("does not let preset themes override body rhythm", () => {
    for (const filename of PRESET_THEME_FILES.filter((filename) => filename !== "marxico.css")) {
      const source = readStyle(`./editor-themes/${filename}`);
      const editorRules = declarationsForSelector(source, ".ProseMirror");
      const paragraphRules = declarationsForSelector(source, ".ProseMirror p");
      const listRules = [
        declarationsForSelector(source, ".ProseMirror ul"),
        declarationsForSelector(source, ".ProseMirror ol"),
        declarationsForSelector(source, ".ProseMirror li"),
      ].join("\n");

      expect(editorRules).not.toMatch(/(?:font-size|line-height)\s*:/);
      expect(paragraphRules).not.toMatch(/(?:line-height|margin|padding)(?:-[a-z]+)?\s*:/);
      expect(listRules).not.toMatch(/(?:line-height|margin)(?:-[a-z]+)?\s*:/);
    }
  });

  test("keeps the Marxico preset aligned with the source theme", () => {
    const source = readStyle("./editor-themes/marxico.css");
    const themeRules = declarationsForSelector(source, '[data-editor-theme="marxico"]:not([data-editor-theme="default"])');
    const headingRules = declarationsForSelector(source, ".ProseMirror h1");
    const quoteRules = declarationsForSelector(source, ".ProseMirror blockquote");
    const inlineCodeRules = declarationsForSelector(source, ".ProseMirror code");
    const paragraphRules = declarationsForSelector(source, ".ProseMirror p");
    const preCodeRules = declarationsForSelector(source, ".ProseMirror pre code");
    const tableRules = declarationsForSelector(source, ".ProseMirror table");

    expect(themeRules).toMatch(/--editor-theme-text\s*:\s*#2c3f51/);
    expect(themeRules).toMatch(/--editor-theme-accent\s*:\s*#1980e6/);
    expect(headingRules).toMatch(/font-size\s*:\s*41\.6px/);
    expect(quoteRules).toMatch(/border-left\s*:\s*10px solid/);
    expect(inlineCodeRules).toMatch(/color\s*:\s*#c7254e/);
    expect(paragraphRules).toMatch(/font-size\s*:\s*16px/);
    expect(paragraphRules).toMatch(/margin\s*:\s*0 0 1\.1em/);
    expect(preCodeRules).toMatch(/background\s*:\s*#23241f/);
    expect(preCodeRules).toMatch(/padding\s*:\s*1\.3em 2em/);
    expect(tableRules).toMatch(/width\s*:\s*auto/);
    expect(tableRules).toMatch(/min-width\s*:\s*0 !important/);
  });
});
