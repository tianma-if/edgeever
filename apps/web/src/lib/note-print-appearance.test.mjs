import { describe, expect, test } from "bun:test";
import { resolveNoteProse } from "@edgeever/shared";
import { notePrintAppearanceCss, notePrintAppearanceFromProse } from "./note-print-appearance.ts";

describe("note print appearance", () => {
  test("keeps native prose on the editor neutrals and passes the account type size", () => {
    const appearance = notePrintAppearanceFromProse(resolveNoteProse({
      fontSize: 18,
      lineHeight: 1.5,
      palette: "native",
      customCss: "",
    }), "github-light", { choice: "system", customFamily: "" });
    const css = notePrintAppearanceCss(appearance);

    expect(appearance.mermaidTheme).toBe("github-light");
    expect(appearance.fontFamily).toBeNull();
    expect(css).toContain("--editor-body-font-size: 18px");
    expect(css).toContain("--editor-body-line-height: 1.5");
    expect(css).not.toContain("color: #");
  });

  test("tints links, bold, checked boxes, and tables with the account palette", () => {
    const css = notePrintAppearanceCss(notePrintAppearanceFromProse(resolveNoteProse({
      palette: "teal",
      customCss: "strong { color: #112233 }",
    }), "not-a-theme", { choice: "system", customFamily: "" }));

    expect(css).toContain("color: #14796E");
    expect(css).toContain("color: #20AD9D");
    expect(css).toContain("accent-color: #20AD9D");
    expect(css).toContain("background: #F2FBFA;");
    expect(css).not.toContain("border-color: #CDEFEA;");
    expect(css).toContain(".edgeever-editor .ProseMirror strong { color: #112233; }");
    expect(css).not.toContain("not-a-theme");
  });
});