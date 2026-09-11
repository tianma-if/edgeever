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
import { ruRU } from "./resources/ru-RU";

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
  "ru-RU": { translation: ruRU },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLocale(),
  fallbackLng: defaultLocale,
  supportedLngs: supportedLocales,
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

export const changeAppLocale = (locale: SupportedLocale) => {
  writeStoredLocale(locale);
  return i18n.changeLanguage(locale);
};

export const changeAppLocalePreference = (preference: AppLocalePreference) => {
  if (preference === "system") {
    clearStoredLocale();
    return i18n.changeLanguage(getBrowserLocale() ?? defaultLocale);
  }

  return changeAppLocale(preference);
};

export default i18n;
