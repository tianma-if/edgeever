import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_MEMO_LIST_WIDTH_PX,
  clampMemoListWidth,
  readDesktopFocusModePreference,
  readImageCompressionPreference,
  readMemoListWidthPreference,
  readShortcutSettingsPreference,
  readSyncIntervalPreference,
  writeDesktopFocusModePreference,
  writeImageCompressionPreference,
  writeMemoListWidthPreference,
  writeShortcutSettingsPreference,
  writeSyncIntervalPreference,
  type ShortcutSettings,
} from "@/lib/app-helpers";

export type SyncIntervalPreference = "off" | "30s" | "5m" | "15m" | "30m" | "1h" | "2h";

export const syncIntervalMsToPreference = (intervalMs: number | null): SyncIntervalPreference => {
  switch (intervalMs) {
    case null: return "off";
    case 300_000: return "5m";
    case 900_000: return "15m";
    case 1_800_000: return "30m";
    case 3_600_000: return "1h";
    case 7_200_000: return "2h";
    default: return "30s";
  }
};

export const useWorkspacePreferences = () => {
  const [imageCompressionEnabled, setImageCompressionEnabled] = useState(readImageCompressionPreference);
  const [syncIntervalMs, setSyncIntervalMs] = useState(readSyncIntervalPreference);
  const [desktopFocusMode, setDesktopFocusModeState] = useState(readDesktopFocusModePreference);
  const [shortcutSettings, setShortcutSettings] = useState<ShortcutSettings>(readShortcutSettingsPreference);
  const [memoListWidth, setMemoListWidthState] = useState(readMemoListWidthPreference);

  useEffect(() => writeImageCompressionPreference(imageCompressionEnabled), [imageCompressionEnabled]);
  useEffect(() => writeSyncIntervalPreference(syncIntervalMsToPreference(syncIntervalMs)), [syncIntervalMs]);
  useEffect(() => writeShortcutSettingsPreference(shortcutSettings), [shortcutSettings]);

  const setDesktopFocusMode = useCallback((enabled: boolean) => {
    setDesktopFocusModeState(enabled);
    writeDesktopFocusModePreference(enabled);
  }, []);

  const setMemoListWidth = useCallback((width: number) => {
    const nextWidth = clampMemoListWidth(width);
    setMemoListWidthState(nextWidth);
    writeMemoListWidthPreference(nextWidth);
  }, []);

  const resetMemoListWidth = useCallback(() => {
    setMemoListWidth(DEFAULT_MEMO_LIST_WIDTH_PX);
  }, [setMemoListWidth]);

  return {
    desktopFocusMode,
    imageCompressionEnabled,
    memoListWidth,
    resetMemoListWidth,
    setDesktopFocusMode,
    setImageCompressionEnabled,
    setMemoListWidth,
    setShortcutSettings,
    setSyncIntervalMs,
    shortcutSettings,
    syncIntervalMs,
  };
};
