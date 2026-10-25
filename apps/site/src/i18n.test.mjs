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
    expect(getSiteLocale("/en")).toBe("en-US");
    expect(getSiteLocale("/en/privacy")).toBe("en-US");
    expect(getSiteLocale("/ja")).toBe("ja");
    expect(getSiteLocale("/ja/privacy")).toBe("ja");
    expect(getSiteLocale("/pl")).toBe("pl");
    expect(getSiteLocale("/pl/privacy")).toBe("pl");
    expect(getSiteLocale("/plan")).toBe("zh-CN");
  });

  test("builds localized paths without stacking prefixes", () => {
    expect(getLocalizedPath("zh-CN", "/en/privacy")).toBe("/privacy");
    expect(getLocalizedPath("en-US", "/privacy")).toBe("/en/privacy");
    expect(getLocalizedPath("ja", "/")).toBe("/ja/");
    expect(getLocalizedPath("ja", "/en/contact")).toBe("/ja/contact");
    expect(getLocalizedPath("en-US", "/ja/docker-deploy")).toBe("/en/docker-deploy");
    expect(getLocalizedPath("ja", "/blog/evernote-migration-guide")).toBe("/ja/blog/evernote-migration-guide");
    expect(stripSiteLocalePrefix("/ja/privacy")).toBe("/privacy");
    expect(stripSiteLocalePrefix("/ja/")).toBe("/");
    expect(getLocalizedPath("pl", "/")).toBe("/pl/");
    expect(getLocalizedPath("pl", "/ja/contact")).toBe("/pl/contact");
    expect(getLocalizedPath("ja", "/pl/docker-deploy")).toBe("/ja/docker-deploy");
    expect(getLocalizedPath("zh-CN", "/pl/privacy")).toBe("/privacy");
    expect(stripSiteLocalePrefix("/pl/privacy")).toBe("/privacy");
  });

  test("matches Japanese browser languages and treats prefixed paths as explicit", () => {
    expect(matchSiteLocale("ja-JP")).toBe("ja");
    expect(matchSiteLocale("ja")).toBe("ja");
    expect(matchSiteLocale("fr-FR")).toBeNull();
    expect(matchSiteLocale("ko-KR")).toBeNull();
    expect(isExplicitSiteLocalePath("/ja/privacy")).toBe(true);
    expect(isExplicitSiteLocalePath("/en/")).toBe(true);
    expect(isExplicitSiteLocalePath("/privacy")).toBe(false);
  });

  test("keeps Japanese marketing copy aligned with Chinese and English keys", () => {
    expect(siteLocales).toEqual(["zh-CN", "en-US", "ja", "pl"]);
    expect(collectKeys(siteCopy.ja)).toEqual(collectKeys(siteCopy["zh-CN"]));
    expect(collectKeys(siteCopy.ja)).toEqual(collectKeys(siteCopy["en-US"]));
    expect(collectKeys(alternativePageCopy.ja)).toEqual(collectKeys(alternativePageCopy["zh-CN"]));
    expect(siteCopy.ja.nav.backToBlog).toBe("ブログ一覧へ");
  });

  test("matches Polish browser languages and treats /pl/ paths as explicit", () => {
    expect(matchSiteLocale("pl-PL")).toBe("pl");
    expect(matchSiteLocale("pl")).toBe("pl");
    expect(isExplicitSiteLocalePath("/pl/privacy")).toBe(true);
    expect(isExplicitSiteLocalePath("/pl")).toBe(true);
    expect(isExplicitSiteLocalePath("/plan")).toBe(false);
  });

  test("keeps Polish marketing copy aligned with Chinese and English keys", () => {
    expect(collectKeys(siteCopy.pl)).toEqual(collectKeys(siteCopy["zh-CN"]));
    expect(collectKeys(siteCopy.pl)).toEqual(collectKeys(siteCopy["en-US"]));
    expect(collectKeys(alternativePageCopy.pl)).toEqual(collectKeys(alternativePageCopy["zh-CN"]));
    expect(siteCopy.pl.layout.ogLocale).toBe("pl_PL");
    expect(siteCopy.pl.nav.backToBlog).toBe("Wróć do bloga");
  });

  test("keeps best practices showcase copy and media counts aligned across locales", () => {
    for (const locale of siteLocales) {
      expect(collectKeys(bestPracticesPageCopy[locale])).toEqual(
        collectKeys(bestPracticesPageCopy["zh-CN"]),
      );
      const cases = bestPracticesPageCopy[locale].categories.flatMap((c) => c.cases);
      expect(cases).toHaveLength(17);
      for (const item of cases) {
        const assets = showcaseCaseAssets[item.id];
        expect(assets).toBeDefined();
        expect(item.media).toHaveLength(assets.images.length);
      }
    }
  });
});
