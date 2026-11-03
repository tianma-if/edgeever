import i18n, { type i18n as I18n } from "i18next";
import { errorScreensEnUS } from "@edgeever/shared/i18n/error-screens-en-US";

export type ErrorScreenKey = keyof typeof errorScreensEnUS;

/**
 * Text for screens shown after a render failure. They can appear before
 * i18next is ready or outside React, so they read the app language from the
 * shared i18next instance and fall back to English.
 */
export const errorScreenText = (key: ErrorScreenKey, instance: I18n = i18n): string => {
  const path = `errorScreens.${key}`;
  const text = instance.isInitialized ? instance.t(path) : "";
  return text && text !== path ? text : errorScreensEnUS[key];
};
