import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NOTE_IMAGE_BACKGROUND_COLORS, NOTE_IMAGE_THEME_OPTIONS } from "@edgeever/shared/note-image-card";
import { resolveMobileThemeStyles } from "./mobile-theme-colors";

// Exercise the actual native style declarations without loading React Native in Bun.
const source = readFileSync(new URL("../screens/WorkspaceMemoDetail.tsx", import.meta.url), "utf8");
const readStyles = (name: string) => {
  const declaration = source.match(new RegExp(`const ${name} = StyleSheet.create\\((\\{[\\s\\S]*?\\n\\})\\);`));
  if (!declaration) throw new Error(`Missing ${name}`);
  return new Function("StyleSheet", `return (${declaration[1]});`)({ absoluteFill: {} });
};
const share = readStyles("baseImageShareStyles");
const detail = readStyles("baseDetailLayoutStyles");

const luminance = (hex: string) => {
  const rgb = hex.slice(1).match(/../g)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
};
const contrast = (foreground: string, background: string) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
};

describe("note detail and image share theme", () => {
  test("template names remain readable against their fixed preview backgrounds", () => {
    const expression = source.match(/imageShareStyles.themeLabel, \{ color: (.*?) \}/)?.[1];
    if (!expression) throw new Error("Missing template label color");
    const labelColor = new Function("item", `return (${expression});`);
    for (const id of NOTE_IMAGE_THEME_OPTIONS) {
      expect(contrast(labelColor({ id }), NOTE_IMAGE_BACKGROUND_COLORS[id])).toBeGreaterThanOrEqual(4.5);
    }
  });
  for (const theme of ["light", "dark"] as const) {
    test(`${theme}: labels remain readable on settings, choices and preview surfaces`, () => {
      const s = resolveMobileThemeStyles(share, theme);
      const d = resolveMobileThemeStyles(detail, theme);
      const surface = theme === "dark" ? "#0f172a" : "#ffffff";
      for (const [foreground, background] of [
        [s.optionLabel.color, surface],
        [s.choiceText.color, surface],
        [s.choiceText.color, s.choice.backgroundColor],
        [s.choiceTextActive.color, s.choiceActive.backgroundColor],
        [s.fontSelectorValue.color, s.fontSelector.backgroundColor],
        [s.previewTitle.color, s.previewHeader.backgroundColor],
        [s.previewSecondaryButtonText.color, s.previewActions.backgroundColor],
        [s.previewWarning.color, s.previewWarning.backgroundColor],
        [d.headerTitle.color, surface],
      ]) {
        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
      expect(s.shareButton.backgroundColor).toBe(share.shareButton.backgroundColor);
      expect(s.shareButtonText.color).toBe("#ffffff");
    });
  }
});
