import { matchSupportedLocale } from "@edgeever/shared/i18n/locales";

/**
 * Some bundled content (docs, demo notebooks, sample audio, sample syntax, poster typography)
 * ships only in Simplified Chinese and English. Chinese UI reads the Chinese variant; every
 * other UI locale reads the English one.
 */
export type BilingualContentLocale = "zh-CN" | "en-US";

export const bilingualContentLocale = (locale: string | null | undefined): BilingualContentLocale =>
  matchSupportedLocale(locale) === "zh-CN" || matchSupportedLocale(locale) === "zh-TW" ? "zh-CN" : "en-US";

export const prefersChineseContent = (locale: string | null | undefined) =>
  bilingualContentLocale(locale) === "zh-CN";
