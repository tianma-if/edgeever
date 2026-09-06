import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("editor content alignment preference", () => {
  test("is configured from settings instead of the per-note toolbar", () => {
    const preferenceCard = readFileSync(new URL("./PreferenceCard.tsx", import.meta.url), "utf8");
    const editorPane = readFileSync(new URL("../EditorPane.tsx", import.meta.url), "utf8");

    expect(preferenceCard).toContain('t("settings.editorContentAlignmentTitle")');
    expect(preferenceCard).toContain('onEditorContentAlignmentChange(value as EditorContentAlignment)');
    expect(editorPane).not.toContain("onToggleEditorContentAlignment");
  });
});

describe("custom editor theme portability", () => {
  test("offers import and export while keeping contrast as a warning", () => {
    const dialog = readFileSync(new URL("./CustomEditorThemeDialog.tsx", import.meta.url), "utf8");

    expect(dialog).toContain('t("settings.customEditorTheme.import")');
    expect(dialog).toContain('t("settings.customEditorTheme.export")');
    expect(dialog).toContain("activeContrastIssues.length > 0");
    expect(dialog).not.toContain("hasAccessibleContrast(draft.light)");
  });
});
