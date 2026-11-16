import { watchUiCatalogFont } from "./editor-catalog-fonts";
import { isRemoteNoteImageFont } from "@edgeever/shared/font-catalog-data";
import { LEGACY_BODY_FONTS } from "@edgeever/shared/font-defaults";
import type { BodyFontId } from "@edgeever/shared/font-loader";
import {
  type EditorBodyFontChoice,
  type EditorBodyFontPreference,
  isEditorBodyFontChoice,
  resolveEditorBodyFontStack,
} from "./editor-body-font";

export const UI_FONT_STORAGE_KEY = "edgeever.uiFont";
export const UI_FONT_CUSTOM_STORAGE_KEY = "edgeever.uiFontCustom";

export type UiFontChoice = EditorBodyFontChoice;
export type UiFontPreference = EditorBodyFontPreference;

const DEFAULT_PREFERENCE: UiFontPreference = {
  choice: "system",
  customFamily: "",
};

const readStorage = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const readUiFontPreference = (): UiFontPreference => {
  const storedChoice = readStorage(UI_FONT_STORAGE_KEY);
  const customFamily = readStorage(UI_FONT_CUSTOM_STORAGE_KEY) ?? "";
  if (!isEditorBodyFontChoice(storedChoice)) return { ...DEFAULT_PREFERENCE, customFamily };
  return { choice: storedChoice, customFamily };
};

export const writeUiFontPreference = (preference: UiFontPreference) => {
  writeStorage(UI_FONT_STORAGE_KEY, preference.choice);
  writeStorage(UI_FONT_CUSTOM_STORAGE_KEY, preference.customFamily.slice(0, 200));
};

export const applyUiFontPreference = (preference = readUiFontPreference()) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  watchUiCatalogFont(isRemoteNoteImageFont(preference.choice) || preference.choice in LEGACY_BODY_FONTS ? preference.choice as BodyFontId : undefined);
  const stack = resolveEditorBodyFontStack(preference);
  if (!stack) {
    delete root.dataset.uiFont;
    root.style.removeProperty("--ui-font-family");
    return;
  }
  root.dataset.uiFont = preference.choice;
  root.style.setProperty("--ui-font-family", stack);
};
