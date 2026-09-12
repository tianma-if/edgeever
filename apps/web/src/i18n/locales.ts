export const supportedLocales = ["zh-CN", "en-US", "ru-RU"] as const;

export type SupportedLocale = (typeof supportedLocales)[number];
export type AppLocalePreference = "system" | SupportedLocale;

export const defaultLocale: SupportedLocale = "zh-CN";

export const localeStorageKey = "edgeever.locale.preference";
const legacyLocaleStorageKey = "edgeever.locale";

export const localeLabels: Record<SupportedLocale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
  "ru-RU": "Русский",
};

export const normalizeLocale = (locale: string | null | undefined): SupportedLocale | null => {
  if (!locale) {
    return null;
  }

  const normalized = locale.toLowerCase();

  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return "zh-CN";
  }

  if (normalized === "en" || normalized === "en-us" || normalized.startsWith("en-")) {
    return "en-US";
  }

  if (normalized === "ru" || normalized.startsWith("ru-")) {
    return "ru-RU";
  }

  return null;
};

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

export const getBrowserLocale = (): SupportedLocale | null => {
  if (typeof navigator === "undefined") {
    return null;
  }

  const browserLocales = navigator.languages?.length ? navigator.languages : [navigator.language];

  for (const locale of browserLocales) {
    const supported = normalizeLocale(locale);

    if (supported) {
      return supported;
    }
  }

  return null;
};

export const getInitialLocale = () => readStoredLocale() ?? getBrowserLocale() ?? defaultLocale;
