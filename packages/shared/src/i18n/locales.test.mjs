import { describe, expect, test } from "bun:test";
import {
  defaultLocale,
  matchSupportedLocale,
  parseAcceptLanguage,
  resolveSupportedLocale,
  resolveSupportedLocaleFromCandidates,
  unmatchedLocale,
} from "./locales.ts";

describe("supported locale matching", () => {
  test("maps Chinese, English, and Japanese families onto the shipped locales", () => {
    expect(matchSupportedLocale("zh")).toBe("zh-CN");
    expect(matchSupportedLocale("zh-CN")).toBe("zh-CN");
    expect(matchSupportedLocale("zh_TW")).toBe("zh-CN");
    expect(matchSupportedLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(matchSupportedLocale("en")).toBe("en-US");
    expect(matchSupportedLocale("en-GB")).toBe("en-US");
    expect(matchSupportedLocale("en_US")).toBe("en-US");
    expect(matchSupportedLocale("ja")).toBe("ja");
    expect(matchSupportedLocale("ja-JP")).toBe("ja");
    expect(matchSupportedLocale("ja_JP")).toBe("ja");
    expect(matchSupportedLocale("pl")).toBe("pl");
    expect(matchSupportedLocale("pl-PL")).toBe("pl");
    expect(matchSupportedLocale("pl_PL")).toBe("pl");
    expect(matchSupportedLocale("ru")).toBe("ru");
    expect(matchSupportedLocale("ru-RU")).toBe("ru");
    expect(matchSupportedLocale("ru_RU")).toBe("ru");
  });

  test("does not treat unrelated tags as a shipped locale", () => {
    expect(matchSupportedLocale("fr-FR")).toBeNull();
    expect(matchSupportedLocale("ko-KR")).toBeNull();
    expect(matchSupportedLocale("pt-BR")).toBeNull();
    expect(matchSupportedLocale("english")).toBeNull();
    expect(matchSupportedLocale(null)).toBeNull();
  });
});

describe("supported locale resolution", () => {
  test("keeps Chinese as the empty default and English as the unmatched fallback", () => {
    expect(defaultLocale).toBe("zh-CN");
    expect(unmatchedLocale).toBe("en-US");
    expect(resolveSupportedLocale(null)).toBe("zh-CN");
    expect(resolveSupportedLocale("")).toBe("zh-CN");
    expect(resolveSupportedLocale("ja-JP")).toBe("ja");
    expect(resolveSupportedLocale("ko")).toBe("en-US");
    expect(resolveSupportedLocale("de-DE")).toBe("en-US");
  });

  test("walks browser or Accept-Language candidate lists in preference order", () => {
    expect(parseAcceptLanguage("ja-JP,ja;q=0.9,en-US;q=0.8")).toEqual(["ja-JP", "ja", "en-US"]);
    expect(resolveSupportedLocaleFromCandidates(["ja-JP", "en-US"])).toBe("ja");
    expect(resolveSupportedLocaleFromCandidates(["fr-FR", "ja-JP"])).toBe("ja");
    expect(resolveSupportedLocaleFromCandidates(["fr-FR", "de-DE"])).toBe("en-US");
    expect(resolveSupportedLocale("ja-JP,zh-CN;q=0.8")).toBe("ja");
    expect(resolveSupportedLocale("fr-FR,fr;q=0.9")).toBe("en-US");
    expect(resolveSupportedLocale("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh-CN");
  });
});
