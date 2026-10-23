import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { MEMO_CONTENT_STYLE } from "@edgeever/shared";

const PRESET_THEME_FILES = [
  "minimal-emerald.css",
  "outline-emerald.css",
  "wechat-green.css",
  "modern-mint.css",
];

const readStyle = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const declarationsForSelector = (source, selectorSuffix) =>
  [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(",").some((selector) => selector.trim().endsWith(selectorSuffix)))
    .map(([, , declarations]) => declarations)
    .join("\n");

describe("editor typography contract", () => {
  test("keeps the shared body rhythm compact", () => {
    expect(MEMO_CONTENT_STYLE.body.lineHeight / MEMO_CONTENT_STYLE.body.fontSize).toBe(1.625);
    expect(MEMO_CONTENT_STYLE.body.paragraphSpacing).toBe(8);
  });

  test("configures punctuation squeezing and overflow wrapping for body text", () => {
    const globals = readStyle("./globals.css");
    const editorRules = declarationsForSelector(globals, ".ProseMirror");
    const markdownRules = declarationsForSelector(globals, ".markdown-content");

    expect(editorRules).toMatch(/overflow-wrap\s*:\s*break-word/);
    expect(editorRules).toMatch(/font-feature-settings\s*:\s*["']chws["']\s*1/);
    expect(markdownRules).toMatch(/overflow-wrap\s*:\s*break-word/);
    expect(markdownRules).toMatch(/font-feature-settings\s*:\s*["']chws["']\s*1/);
  });

  test("keeps the native editor and applies account prose instead of paper themes", () => {
    const editorPane = readStyle("../components/EditorPane.tsx");
    const publishLayout = readStyle("./publish-layout.css");

    expect(editorPane).toContain('data-editor-theme="default"');
    expect(editorPane).toContain("data-note-palette={noteProse.palette}");
    expect(editorPane).toContain("noteProseCssVariables(noteProse)");
    expect(editorPane).not.toContain("isPaperEditorTheme");
    expect(editorPane).toContain("MEMO_CONTENT_STYLE.divider");
    expect(publishLayout).toContain('[data-editor-theme="letter"]');
    expect(publishLayout).toContain("[data-paper-theme]");
    expect(publishLayout).not.toContain("[data-publish-layout]");
  });

  test("styles default-theme external hyperlinks so they are distinct from body text", () => {
    const globals = readStyle("./globals.css");
    const linkRules = declarationsForSelector(globals, ".ProseMirror a");
    const markdownLinkRules = declarationsForSelector(globals, ".markdown-content a");

    expect(linkRules).toMatch(/color\s*:\s*rgb\(var\(--slate-700-rgb\)\)/);
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
    expect(placeholderRules).toMatch(/font-weight\s*:\s*inherit/);
    expect(placeholderRules).toMatch(/line-height\s*:\s*inherit/);
    expect(placeholderRules).toMatch(/color\s*:\s*#a8b5c4/);
  });

  test("paints bold text with the palette accent", () => {
    const prose = readStyle("./note-prose.css");
    const boldRules = declarationsForSelector(prose, ".ProseMirror strong");

    expect(boldRules).toMatch(/color:\s*var\(--note-palette-accent\)/);
    expect(prose).toMatch(/--note-palette-accent:\s*var\(--note-palette-dark-accent\)\s*!important/);
    expect(prose).not.toContain('data-note-palette="custom"');
  });

  test("named palettes recolor links, bold, inline code, and checked task boxes", () => {
    const prose = readStyle("./note-prose.css");

    expect(prose).toMatch(/color:\s*var\(--note-palette-link\)/);
    expect(prose).toMatch(/color:\s*var\(--note-palette-code-text\)/);
    expect(prose).toMatch(/background:\s*var\(--note-palette-code-bg\)/);
    expect(prose).toMatch(/color:\s*var\(--note-palette-accent\)/);
    expect(prose).toMatch(/accent-color:\s*var\(--note-palette-accent\)/);
    expect(prose).toMatch(/ul\[data-type="taskList"\] li\[data-checked\] > label input/);
    expect(prose).toMatch(/\.ProseMirror code/);
    expect(prose).toMatch(/\.ProseMirror pre code/);
    const globals = readStyle("./globals.css");
    expect(declarationsForSelector(globals, ".ProseMirror code")).toContain("color: #3d4450;");
    expect(prose).not.toMatch(/--note-palette-text/);
    expect(prose).not.toMatch(/--note-palette-surface/);
    expect(prose).not.toMatch(/--note-palette-muted/);
    expect(prose).not.toMatch(/--note-palette-divider/);
    expect(prose).not.toMatch(/blockquote/);
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
    for (const filename of PRESET_THEME_FILES) {
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

  test("does not let preset themes override table geometry", () => {
    const geometryPattern =
      /(?<![\w-])(?:padding|min-width|max-width|min-height|max-height|line-height|table-layout|width|height)(?:-[a-z]+)?\s*:/;

    for (const filename of ["base.css", ...PRESET_THEME_FILES]) {
      const source = readStyle(`./editor-themes/${filename}`);
      const tableRules = [
        declarationsForSelector(source, ".ProseMirror table"),
        declarationsForSelector(source, ".ProseMirror .tableWrapper"),
        declarationsForSelector(source, ".ProseMirror th"),
        declarationsForSelector(source, ".ProseMirror td"),
        declarationsForSelector(source, ".ProseMirror th p"),
        declarationsForSelector(source, ".ProseMirror td p"),
        declarationsForSelector(source, ".ProseMirror col"),
        declarationsForSelector(source, ".ProseMirror tr"),
      ].join("\n");

      expect(tableRules).not.toMatch(geometryPattern);
      expect(tableRules).not.toMatch(/--mobile-table-column-width\s*:/);
      expect(tableRules).not.toMatch(/\bborder\s*:/);
    }
  });

});
