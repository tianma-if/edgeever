import {
  defaultLocale as sharedDefaultLocale,
  matchSupportedLocale,
  resolveSupportedLocaleFromCandidates,
  supportedLocales as sharedSupportedLocales,
  type SupportedLocale as SharedSupportedLocale,
} from "@edgeever/shared/i18n/locales";

export const supportedLocales = sharedSupportedLocales;

export type SupportedLocale = SharedSupportedLocale;
export type AppLocalePreference = "system" | SupportedLocale;

export const defaultLocale: SupportedLocale = sharedDefaultLocale;

export const localeStorageKey = "edgeever.locale.preference";
const legacyLocaleStorageKey = "edgeever.locale";

export const localeLabels: Record<SupportedLocale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
  ja: "日本語",
  pl: "Polski",
  ru: "Русский",
};

export const normalizeLocale = (locale: string | null | undefined): SupportedLocale | null =>
  matchSupportedLocale(locale);

export const readStoredLocale = (): SupportedLocale | null => {
  try {
    if (typeof window === "undefined") {
      return null;
    }

    return normalizeLocale(window.localStorage.getItem(localeStorageKey));
  } catch {
    return null;
  }
};

export const writeStoredLocale = (locale: SupportedLocale) => {
  try {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(localeStorageKey, locale);
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const clearStoredLocale = () => {
  try {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.removeItem(localeStorageKey);
    window.localStorage.removeItem(legacyLocaleStorageKey);
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const getAppLocalePreference = (): AppLocalePreference => readStoredLocale() ?? "system";

/** Returns null only when the browser exposes no language list; unmatched languages become English. */
export const getBrowserLocale = (): SupportedLocale | null => {
  if (typeof navigator === "undefined") {
    return null;
  }

  const browserLocales = navigator.languages?.length ? navigator.languages : [navigator.language];

  if (!browserLocales.some((locale) => locale?.trim())) {
    return null;
  }

  return resolveSupportedLocaleFromCandidates(browserLocales);
};

export const getInitialLocale = () => readStoredLocale() ?? getBrowserLocale() ?? defaultLocale;
