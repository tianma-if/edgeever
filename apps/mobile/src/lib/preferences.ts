import AsyncStorage from "@react-native-async-storage/async-storage";

const MEMO_LIST_DENSITY_KEY = "edgeever.mobile.memoListDensity";
const IMAGE_COMPRESSION_KEY = "edgeever.mobile.imageCompressionEnabled";
const LOCALE_PREFERENCE_KEY = "edgeever.mobile.localePreference";
const THEME_PREFERENCE_KEY = "edgeever.mobile.themePreference";

export type MobileMemoListDensity = "preview" | "compact";
export type MobileLocalePreference = "system" | "zh-CN" | "en-US";
export type MobileThemePreference = "system" | "light" | "dark";

export const readMobileMemoListDensity = async (): Promise<MobileMemoListDensity> => {
  const value = await AsyncStorage.getItem(MEMO_LIST_DENSITY_KEY);
  return value === "compact" ? "compact" : "preview";
};

export const writeMobileMemoListDensity = (density: MobileMemoListDensity) => AsyncStorage.setItem(MEMO_LIST_DENSITY_KEY, density);

export const readMobileImageCompressionEnabled = async () => {
  const value = await AsyncStorage.getItem(IMAGE_COMPRESSION_KEY);
  return value !== "false";
};

export const writeMobileImageCompressionEnabled = (enabled: boolean) => AsyncStorage.setItem(IMAGE_COMPRESSION_KEY, enabled ? "true" : "false");

export const readMobileLocalePreference = async (): Promise<MobileLocalePreference> => {
  const value = await AsyncStorage.getItem(LOCALE_PREFERENCE_KEY);
  return isMobileLocalePreference(value) ? value : "system";
};

export const writeMobileLocalePreference = (locale: MobileLocalePreference) => AsyncStorage.setItem(LOCALE_PREFERENCE_KEY, locale);

export const readMobileThemePreference = async (): Promise<MobileThemePreference> => {
  const value = await AsyncStorage.getItem(THEME_PREFERENCE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
};

export const writeMobileThemePreference = (theme: MobileThemePreference) => AsyncStorage.setItem(THEME_PREFERENCE_KEY, theme);

const isMobileLocalePreference = (value: unknown): value is MobileLocalePreference => value === "system" || value === "zh-CN" || value === "en-US";
