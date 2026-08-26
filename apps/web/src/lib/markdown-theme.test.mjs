import { describe, expect, test } from "bun:test";
import {
  MARKDOWN_THEME_NAMES,
  MARKDOWN_THEME_PREFERENCES,
  resolveMarkdownTheme,
} from "../components/ThemeProvider";
import { CODE_MIRROR_THEME_MAP } from "../components/editor/MarkdownSourceEditor";

describe("markdown theme contracts", () => {
  test("automatic Markdown themes follow the resolved appearance", () => {
    expect(resolveMarkdownTheme("auto", "light")).toBe("github-light");
    expect(resolveMarkdownTheme("auto", "dark")).toBe("tokyo-night");
    expect(resolveMarkdownTheme("dracula", "light")).toBe("dracula");
    expect(resolveMarkdownTheme("nord", "dark")).toBe("nord");
    expect(resolveMarkdownTheme("tokyo-night", "light")).toBe("tokyo-night");
  });

  test("all markdown theme preferences are correctly defined", () => {
    expect(MARKDOWN_THEME_PREFERENCES[0]).toBe("auto");
    for (const theme of MARKDOWN_THEME_NAMES) {
      expect(MARKDOWN_THEME_PREFERENCES).toContain(theme);
    }
  });

  test("every supported markdown theme has a CodeMirror extension mapped", () => {
    for (const theme of MARKDOWN_THEME_NAMES) {
      const extension = CODE_MIRROR_THEME_MAP[theme];
      expect(extension).toBeDefined();
    }
  });
});
