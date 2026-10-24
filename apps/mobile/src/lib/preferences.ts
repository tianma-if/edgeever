import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AI_ASSISTANT_LAST_ACTION_STORAGE_KEY,
  parseAiAssistantLastActionStore,
  serializeAiAssistantLastActionStore,
  type AiAssistantLastActionPreference,
  type AiAssistantLastActionScope,
} from "@edgeever/shared";

const MEMO_LIST_DENSITY_KEY = "edgeever.mobile.memoListDensity";
const IMAGE_COMPRESSION_KEY = "edgeever.mobile.imageCompressionEnabled";
const SHOW_DESCENDANT_NOTES_KEY = "edgeever.mobile.showDescendantNotes";
const LOCALE_PREFERENCE_KEY = "edgeever.mobile.localePreference";
const THEME_PREFERENCE_KEY = "edgeever.mobile.themePreference";

export type MobileMemoListDensity = "preview" | "compact";
export type MobileLocalePreference = "system" | "zh-CN" | "en-US" | "ja" | "pl" | "ru";
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

// Parent notebooks keep listing their sub-notebooks' notes unless turned off.
export const readMobileShowDescendantNotes = async () => {
  try {
    const value = await AsyncStorage.getItem(SHOW_DESCENDANT_NOTES_KEY);
    return value !== "false";
  } catch {
    // A display preference must not leave all note queries disabled.
    return true;
  }
};

export const writeMobileShowDescendantNotes = (enabled: boolean) => AsyncStorage.setItem(SHOW_DESCENDANT_NOTES_KEY, enabled ? "true" : "false");

// Resolves to the value that is actually stored, so the list never shows a scope
// that would silently revert on the next launch.
export const saveMobileShowDescendantNotes = async (enabled: boolean) => {
  try {
    await writeMobileShowDescendantNotes(enabled);
    return { value: enabled, saved: true };
  } catch {
    return { value: await readMobileShowDescendantNotes(), saved: false };
  }
};

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

const isMobileLocalePreference = (value: unknown): value is MobileLocalePreference =>
  value === "system" || value === "zh-CN" || value === "en-US" || value === "ja" || value === "pl" || value === "ru";

export const readMobileAiAssistantLastAction = async (
  scope: AiAssistantLastActionScope,
): Promise<AiAssistantLastActionPreference | null> => {
  try {
    return parseAiAssistantLastActionStore(await AsyncStorage.getItem(AI_ASSISTANT_LAST_ACTION_STORAGE_KEY))[scope] ?? null;
  } catch {
    return null;
  }
};

export const writeMobileAiAssistantLastAction = (
  scope: AiAssistantLastActionScope,
  preference: AiAssistantLastActionPreference,
) =>
  AsyncStorage.getItem(AI_ASSISTANT_LAST_ACTION_STORAGE_KEY)
    .then((raw) => {
      const current = parseAiAssistantLastActionStore(raw);
      return AsyncStorage.setItem(
        AI_ASSISTANT_LAST_ACTION_STORAGE_KEY,
        serializeAiAssistantLastActionStore({ ...current, [scope]: preference }),
      );
    })
    .catch(() => undefined);
