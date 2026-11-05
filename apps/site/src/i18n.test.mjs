import { describe, expect, test } from "bun:test";
import { bestPracticesPageCopy, showcaseCaseAssets } from "./data/best-practices.ts";
import { alternativePageCopy } from "./data/self-hosted-evernote-alternative.ts";
import {
  getLocalizedPath,
  getSiteLocale,
  isExplicitSiteLocalePath,
  matchSiteLocale,
  siteCopy,
  siteLocales,
  stripSiteLocalePrefix,
} from "./i18n.ts";

const collectKeys = (value, prefix = "") => {
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === "object")) {
      return value.flatMap((item, index) => collectKeys(item, `${prefix}[${index}]`));
    }

    return [`${prefix}#${value.length}`];
  }

  if (!value || typeof value !== "object") {
    return [prefix];
  }

  return Object.keys(value).flatMap((key) => collectKeys(value[key], prefix ? `${prefix}.${key}` : key));
};

describe("site locale routing", () => {
  test("reads locale from the path prefix", () => {
    expect(getSiteLocale("/")).toBe("zh-CN");
    expect(getSiteLocale("/privacy")).toBe("zh-CN");
    expect(getSiteLocale("/zh-tw")).toBe("zh-TW");
    expect(getSiteLocale("/zh-tw/privacy")).toBe("zh-TW");
    expect(getSiteLocale("/en")).toBe("en-US");
    expect(getSiteLocale("/en/privacy")).toBe("en-US");
    expect(getSiteLocale("/es")).toBe("es");
    expect(getSiteLocale("/es/privacy")).toBe("es");
    expect(getSiteLocale("/de")).toBe("de");
    expect(getSiteLocale("/de/privacy")).toBe("de");
    expect(getSiteLocale("/fr")).toBe("fr");
    expect(getSiteLocale("/fr/privacy")).toBe("fr");
    expect(getSiteLocale("/ja")).toBe("ja");
    expect(getSiteLocale("/ja/privacy")).toBe("ja");
    expect(getSiteLocale("/pl")).toBe("pl");
    expect(getSiteLocale("/pl/privacy")).toBe("pl");
    expect(getSiteLocale("/ru")).toBe("ru");
    expect(getSiteLocale("/ru/privacy")).toBe("ru");
    expect(getSiteLocale("/plan")).toBe("zh-CN");
  });

  test("builds localized paths without stacking prefixes", () => {
    expect(getLocalizedPath("zh-CN", "/en/privacy")).toBe("/privacy");
    expect(getLocalizedPath("en-US", "/privacy")).toBe("/en/privacy");
    expect(getLocalizedPath("zh-TW", "/")).toBe("/zh-tw/");
    expect(getLocalizedPath("zh-TW", "/en/contact")).toBe("/zh-tw/contact");
    expect(getLocalizedPath("es", "/de/docker-deploy")).toBe("/es/docker-deploy");
    expect(getLocalizedPath("de", "/fr/contact")).toBe("/de/contact");
    expect(getLocalizedPath("fr", "/ru/privacy")).toBe("/fr/privacy");
    expect(getLocalizedPath("ru", "/zh-tw/contact")).toBe("/ru/contact");
    expect(getLocalizedPath("ja", "/")).toBe("/ja/");
    expect(getLocalizedPath("ja", "/en/contact")).toBe("/ja/contact");
    expect(getLocalizedPath("en-US", "/ja/docker-deploy")).toBe("/en/docker-deploy");
    expect(getLocalizedPath("ja", "/blog/evernote-migration-guide")).toBe("/ja/blog/evernote-migration-guide");
    expect(stripSiteLocalePrefix("/ja/privacy")).toBe("/privacy");
    expect(stripSiteLocalePrefix("/ja/")).toBe("/");
    expect(stripSiteLocalePrefix("/zh-tw/privacy")).toBe("/privacy");
    expect(stripSiteLocalePrefix("/es/privacy")).toBe("/privacy");
    expect(stripSiteLocalePrefix("/de/privacy")).toBe("/privacy");
    expect(stripSiteLocalePrefix("/fr/privacy")).toBe("/privacy");
    expect(stripSiteLocalePrefix("/ru/privacy")).toBe("/privacy");
    expect(getLocalizedPath("pl", "/")).toBe("/pl/");
    expect(getLocalizedPath("pl", "/ja/contact")).toBe("/pl/contact");
    expect(getLocalizedPath("ja", "/pl/docker-deploy")).toBe("/ja/docker-deploy");
    expect(getLocalizedPath("zh-CN", "/pl/privacy")).toBe("/privacy");
    expect(stripSiteLocalePrefix("/pl/privacy")).toBe("/privacy");
  });

  test("matches browser languages and treats prefixed paths as explicit", () => {
    expect(matchSiteLocale("zh-TW")).toBe("zh-TW");
    expect(matchSiteLocale("zh-Hant-TW")).toBe("zh-TW");
    expect(matchSiteLocale("zh-HK")).toBe("zh-TW");
    expect(matchSiteLocale("zh-CN")).toBe("zh-CN");
    expect(matchSiteLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(matchSiteLocale("zh")).toBe("zh-CN");
    expect(matchSiteLocale("en-US")).toBe("en-US");
    expect(matchSiteLocale("en")).toBe("en-US");
    expect(matchSiteLocale("es-ES")).toBe("es");
    expect(matchSiteLocale("es")).toBe("es");
    expect(matchSiteLocale("de-DE")).toBe("de");
    expect(matchSiteLocale("de")).toBe("de");
    expect(matchSiteLocale("fr-FR")).toBe("fr");
    expect(matchSiteLocale("fr")).toBe("fr");
    expect(matchSiteLocale("ja-JP")).toBe("ja");
    expect(matchSiteLocale("ja")).toBe("ja");
    expect(matchSiteLocale("pl-PL")).toBe("pl");
    expect(matchSiteLocale("pl")).toBe("pl");
    expect(matchSiteLocale("ru-RU")).toBe("ru");
    expect(matchSiteLocale("ru")).toBe("ru");
    expect(matchSiteLocale("ko-KR")).toBeNull();
    expect(matchSiteLocale("it-IT")).toBeNull();

    expect(isExplicitSiteLocalePath("/zh-tw/privacy")).toBe(true);
    expect(isExplicitSiteLocalePath("/es/privacy")).toBe(true);
    expect(isExplicitSiteLocalePath("/de/privacy")).toBe(true);
    expect(isExplicitSiteLocalePath("/fr/privacy")).toBe(true);
    expect(isExplicitSiteLocalePath("/ja/privacy")).toBe(true);
    expect(isExplicitSiteLocalePath("/pl/privacy")).toBe(true);
    expect(isExplicitSiteLocalePath("/ru/privacy")).toBe(true);
    expect(isExplicitSiteLocalePath("/en/")).toBe(true);
    expect(isExplicitSiteLocalePath("/privacy")).toBe(false);
  });

  test("verifies all 9 siteLocales and keeps copy aligned across all locales", () => {
    expect(siteLocales).toEqual([
      "zh-CN",
      "zh-TW",
      "en-US",
      "es",
      "de",
      "fr",
      "ja",
      "pl",
      "ru",
    ]);

    const baseKeys = collectKeys(siteCopy["zh-CN"]);
    const enKeys = collectKeys(siteCopy["en-US"]);
    const baseAltKeys = collectKeys(alternativePageCopy["zh-CN"]);

    for (const locale of siteLocales) {
      expect(collectKeys(siteCopy[locale])).toEqual(baseKeys);
      expect(collectKeys(siteCopy[locale])).toEqual(enKeys);
      expect(collectKeys(alternativePageCopy[locale])).toEqual(baseAltKeys);
    }

    expect(siteCopy["zh-TW"].layout.ogLocale).toBe("zh_TW");
    expect(siteCopy.es.layout.ogLocale).toBe("es_ES");
    expect(siteCopy.de.layout.ogLocale).toBe("de_DE");
    expect(siteCopy.fr.layout.ogLocale).toBe("fr_FR");
    expect(siteCopy.ja.layout.ogLocale).toBe("ja_JP");
    expect(siteCopy.pl.layout.ogLocale).toBe("pl_PL");
    expect(siteCopy.ru.layout.ogLocale).toBe("ru_RU");
  });

  test("keeps best practices showcase copy and media counts aligned across locales", () => {
    for (const locale of siteLocales) {
      expect(collectKeys(bestPracticesPageCopy[locale])).toEqual(
        collectKeys(bestPracticesPageCopy["zh-CN"]),
      );
      const cases = bestPracticesPageCopy[locale].categories.flatMap((c) => c.cases);
      // Every configured showcase appears exactly once in each locale.
      expect(cases.map((item) => item.id).sort()).toEqual(Object.keys(showcaseCaseAssets).sort());
      for (const item of cases) {
        const assets = showcaseCaseAssets[item.id];
        expect(assets).toBeDefined();
        expect(item.media).toHaveLength(assets.images.length);
      }
    }
  });
});
