import { describe, expect, test } from "bun:test";
import { matchSupportedLocale } from "../../../../packages/shared/src/i18n/locales.ts";
import {
  desktopDialogCopy,
  desktopDialogCopyByLocale,
  desktopLocales,
  formatDesktopCopy,
  resolveDesktopLocale,
} from "./desktop-copy.mjs";

const english = desktopDialogCopyByLocale["en-US"];
const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort();

describe("desktop dialog copy", () => {
  test("covers every desktop locale", () => {
    expect(Object.keys(desktopDialogCopyByLocale).sort()).toEqual([...desktopLocales].sort());
  });

  test("every locale has exactly the English keys and no empty strings", () => {
    const keys = Object.keys(english).sort();
    for (const [locale, copy] of Object.entries(desktopDialogCopyByLocale)) {
      expect({ locale, keys: Object.keys(copy).sort() }).toEqual({ locale, keys });
      for (const [key, value] of Object.entries(copy)) {
        expect({ locale, key, empty: typeof value !== "string" || value.trim() === "" }).toEqual({ locale, key, empty: false });
      }
    }
  });

  test("every locale keeps the English placeholders", () => {
    for (const [locale, copy] of Object.entries(desktopDialogCopyByLocale)) {
      for (const [key, value] of Object.entries(english)) {
        expect({ locale, key, placeholders: placeholders(copy[key]) }).toEqual({ locale, key, placeholders: placeholders(value) });
      }
    }
    expect(placeholders(english.updateReadyMessage)).toEqual(["{version}"]);
    expect(placeholders(english.screenshotTitle)).toEqual(["{stamp}"]);
  });
});

describe("resolveDesktopLocale", () => {
  test("agrees with the shared matchSupportedLocale", () => {
    const tags = ["zh-CN", "zh-TW", "zh_Hant", "en", "en-GB", "ja-JP", "pl", "pl-PL", "ru-RU", "RU", "es-ES", "de-DE", "fr-FR", "", undefined, "plx"];
    for (const tag of tags) {
      expect({ tag, locale: resolveDesktopLocale(tag) }).toEqual({ tag, locale: matchSupportedLocale(tag) ?? "en-US" });
    }
  });

  test("falls back to English for unsupported tags", () => {
    for (const tag of ["it-IT", "", undefined, "plx"]) expect(resolveDesktopLocale(tag)).toBe("en-US");
    expect(desktopDialogCopy("plx")).toBe(english);
  });

  test("maps regional variants onto the catalog locale", () => {
    expect(resolveDesktopLocale("zh_Hant")).toBe("zh-TW");
    expect(resolveDesktopLocale("pl-PL")).toBe("pl");
    expect(resolveDesktopLocale("RU")).toBe("ru");
    expect(resolveDesktopLocale("es-ES")).toBe("es");
    expect(resolveDesktopLocale("de-DE")).toBe("de");
    expect(resolveDesktopLocale("fr-FR")).toBe("fr");
    expect(desktopDialogCopy("ja-JP").reload).toBe("再読み込み");
    expect(desktopDialogCopy("fr-FR").reload).toBe("Recharger");
  });
});

describe("formatDesktopCopy", () => {
  test("replaces known placeholders and leaves unknown ones", () => {
    expect(formatDesktopCopy("EdgeEver v{version}", { version: "1.2.3" })).toBe("EdgeEver v1.2.3");
    expect(formatDesktopCopy("{stamp} {missing}", { stamp: 7 })).toBe("7 {missing}");
    expect(formatDesktopCopy("no placeholders", {})).toBe("no placeholders");
  });
});
