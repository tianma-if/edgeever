import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const darkTheme = readFileSync(new URL("./code-highlight-dark.css", import.meta.url), "utf8");

describe("rich-text code highlight themes", () => {
  test("loads the light palette before the scoped dark override", () => {
    const lightImport = '@import "highlight.js/styles/github.css";';
    const darkImport = '@import "./code-highlight-dark.css";';

    expect(globals).toContain(lightImport);
    expect(globals).toContain(darkImport);
    expect(globals.indexOf(darkImport)).toBeGreaterThan(globals.indexOf(lightImport));
  });

  test("scopes GitHub Dark token colors to dark rich-text code blocks", () => {
    expect(darkTheme).toContain(":root.dark .ProseMirror .edgeever-code-block .hljs");
    expect(darkTheme).toContain("background: transparent;");

    for (const token of [
      "keyword",
      "title",
      "number",
      "string",
      "built_in",
      "comment",
      "selector-tag",
      "subst",
      "section",
      "bullet",
      "addition",
      "deletion",
    ]) {
      expect(darkTheme).toContain(`.edgeever-code-block .hljs-${token}`);
    }
  });
});
