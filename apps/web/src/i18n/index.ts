import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  clearStoredLocale,
  defaultLocale,
  getBrowserLocale,
  getInitialLocale,
  supportedLocales,
  writeStoredLocale,
  type AppLocalePreference,
  type SupportedLocale,
} from "./locales";
import { enUS } from "./resources/en-US";
import { zhCN } from "./resources/zh-CN";

export {
  defaultLocale,
  getAppLocalePreference,
  localeLabels,
  supportedLocales,
  type AppLocalePreference,
  type SupportedLocale,
} from "./locales";

export const resources = {
  "zh-CN": { translation: zhCN },
  "en-US": { translation: enUS },
} as const;

type OptionalLocale = Exclude<SupportedLocale, keyof typeof resources>;

const isOptionalLocale = (locale: SupportedLocale): locale is OptionalLocale =>
  locale === "ja" || locale === "pl" || locale === "ru";

const loadOptionalCatalog = async (locale: OptionalLocale) => {
  if (locale === "ja") {
    return (await import("./resources/ja")).ja;
  }
  if (locale === "pl") {
    return (await import("./resources/pl")).pl;
  }
  return (await import("./resources/ru")).ru;
};

const ensureLocaleCatalog = async (locale: SupportedLocale) => {
  if (!isOptionalLocale(locale) || i18n.hasResourceBundle(locale, "translation")) {
    return;
  }

  i18n.addResourceBundle(locale, "translation", await loadOptionalCatalog(locale), true, true);
};

void i18n.use(initReactI18next).init({
  resources,
  lng: isOptionalLocale(getInitialLocale()) ? "en-US" : getInitialLocale(),
  fallbackLng: {
    ja: ["en-US"],
    pl: ["en-US"],
    ru: ["en-US"],
    default: [defaultLocale],
  },
  supportedLngs: supportedLocales,
  partialBundledLanguages: true,
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

i18n.on("languageChanged", (locale) => {
  const supported = supportedLocales.find((item) => item === locale);

  if (supported) {
    document.documentElement.lang = supported;
  }
});

document.documentElement.lang = i18n.resolvedLanguage ?? i18n.language ?? defaultLocale;

export const bootstrapI18n = async () => {
  const locale = getInitialLocale();
  if (!isOptionalLocale(locale)) {
    return;
  }

  await ensureLocaleCatalog(locale);
  await i18n.changeLanguage(locale);
};

export const changeAppLocale = async (locale: SupportedLocale) => {
  writeStoredLocale(locale);
  await ensureLocaleCatalog(locale);
  return i18n.changeLanguage(locale);
};

export const changeAppLocalePreference = async (preference: AppLocalePreference) => {
  if (preference === "system") {
    clearStoredLocale();
    const locale = getBrowserLocale() ?? defaultLocale;
    await ensureLocaleCatalog(locale);
    return i18n.changeLanguage(locale);
  }

  return changeAppLocale(preference);
};

export default i18n;
