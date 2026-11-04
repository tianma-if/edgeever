import { describe, expect, test } from "bun:test";
import { resolveNoteProse } from "@edgeever/shared";
import { DEFAULT_NOTE_PROSE_STYLE_PREFERENCES } from "./note-prose-style-preference.ts";
import { notePrintAppearanceCss, notePrintAppearanceFromProse } from "./note-print-appearance.ts";

describe("note print appearance", () => {
  test("print code follows a selected monospace face but keeps its own fallback for proportional prose", () => {
    for (const choice of ["maple-mono-cn", "jetbrains", "wenkai", "system"]) {
      const css = notePrintAppearanceCss(notePrintAppearanceFromProse(
        resolveNoteProse({}), "github-light", { choice, customFamily: "" },
      ));
      if (choice === "maple-mono-cn" || choice === "jetbrains") {
        expect(css).toContain("--editor-code-font-family:");
        expect(css).toContain(choice === "jetbrains" ? "EdgeEver Share JetBrains Mono" : "EdgeEver Share Maple Mono CN");
      } else expect(css).not.toContain("--editor-code-font-family:");
    }
  });
  test("keeps native prose on the editor neutrals and passes the account type size", () => {
    const appearance = notePrintAppearanceFromProse(resolveNoteProse({
      fontSize: 18,
      lineHeight: 1.5,
      palette: "native",
      customCss: "",
    }), "github-light", { choice: "system", customFamily: "" });
    const css = notePrintAppearanceCss(appearance);

    expect(appearance.mermaidTheme).toBe("zinc-light");
    expect(appearance.fontFamily).toBeNull();
    expect(css).toContain("--editor-body-font-size: 18px");
    expect(css).toContain("--editor-body-line-height: 1.5");
    expect(css).not.toContain("color: #");
  });

  test("print uses the selected body rhythm with any heading style", () => {
    for (const headingStyle of ["default", "bar", "numbered"]) {
      const appearance = notePrintAppearanceFromProse(resolveNoteProse({}), "github-light",
        { choice: "system", customFamily: "" },
        { ...DEFAULT_NOTE_PROSE_STYLE_PREFERENCES, headingStyle, paragraphSpacing: 16, textAlign: "justify", letterSpacing: "1px" });
      const css = notePrintAppearanceCss(appearance);
      expect(css).toContain("--editor-paragraph-spacing: 16px");
      expect(css).toContain("--editor-body-text-align: justify");
      expect(css).toContain("--editor-body-letter-spacing: 1px");
    }
  });

  test("tints links, bold, checked boxes, and tables with the account palette", () => {
    const css = notePrintAppearanceCss(notePrintAppearanceFromProse(resolveNoteProse({
      palette: "teal",
      customCss: "strong { color: #112233 }",
    }), "not-a-theme", { choice: "system", customFamily: "" }));

    expect(css).toContain("color: #14796E");
    expect(css).toContain("color: #20AD9D");
    expect(css).toContain("accent-color: #20AD9D");
    expect(css).toContain("background: #20AD9D;");
    expect(css).toContain("background: #f9fafb;");
    expect(css).not.toContain("border-color: #CDEFEA;");
    expect(css).toContain(".edgeever-editor .ProseMirror strong { color: #112233; }");
    expect(css).not.toContain("not-a-theme");
  });
});
