import chineseHero from "../../../../assets/readme/edgeever-hero-v8.png";
import englishHero from "../../../../assets/readme/edgeever-hero-v8-en.png";
import type { SiteLocale } from "../i18n";

export const getHeroImage = (locale: SiteLocale) =>
  locale === "zh-CN" || locale === "zh-TW" ? chineseHero : englishHero;
