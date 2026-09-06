import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const editorPaneSource = readFileSync(new URL("./EditorPane.tsx", import.meta.url), "utf8");
const settingsPaneSource = readFileSync(new URL("./SettingsPane.tsx", import.meta.url), "utf8");

describe("system information access", () => {
  test("keeps a compact-workspace entry in the editor overflow menu", () => {
    expect(editorPaneSource).toMatch(
      /<DropdownMenuItem[\s\S]*?min-\[1600px\]:hidden[\s\S]*?setSystemInfoOpen\(true\)[\s\S]*?systemInfo\.title[\s\S]*?<\/DropdownMenuItem>/,
    );
  });

  test("keeps an entry in the desktop settings layout", () => {
    const desktopSettings = settingsPaneSource.match(/桌面端布局：双栏[\s\S]*?移动端布局/)?.[0];

    expect(desktopSettings).toContain("setSystemInfoOpen(true)");
    expect(desktopSettings).toContain('t("systemInfo.title")');
  });
});
