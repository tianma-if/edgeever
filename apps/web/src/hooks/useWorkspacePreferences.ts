import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_MEMO_LIST_WIDTH_PX,
  clampMemoListWidth,
  readDesktopFocusModePreference,
  readEditorContentAlignmentPreference,
  readImageCompressionPreference,
  readMemoListWidthPreference,
  readShortcutSettingsPreference,
  writeDesktopFocusModePreference,
  writeEditorContentAlignmentPreference,
  writeImageCompressionPreference,
  writeMemoListWidthPreference,
  writeShortcutSettingsPreference,
  type ShortcutSettings,
  type EditorContentAlignment,
} from "@/lib/app-helpers";

export const useWorkspacePreferences = () => {
  const [imageCompressionEnabled, setImageCompressionEnabled] = useState(readImageCompressionPreference);
  const [desktopFocusMode, setDesktopFocusModeState] = useState(readDesktopFocusModePreference);
  const [editorContentAlignment, setEditorContentAlignmentState] = useState(readEditorContentAlignmentPreference);
  const [shortcutSettings, setShortcutSettings] = useState<ShortcutSettings>(readShortcutSettingsPreference);
  const [memoListWidth, setMemoListWidthState] = useState(readMemoListWidthPreference);

  useEffect(() => writeImageCompressionPreference(imageCompressionEnabled), [imageCompressionEnabled]);
  useEffect(() => writeShortcutSettingsPreference(shortcutSettings), [shortcutSettings]);

  const setDesktopFocusMode = useCallback((enabled: boolean) => {
    setDesktopFocusModeState(enabled);
    writeDesktopFocusModePreference(enabled);
  }, []);

  const setEditorContentAlignment = useCallback((alignment: EditorContentAlignment) => {
    setEditorContentAlignmentState(alignment);
    writeEditorContentAlignmentPreference(alignment);
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
    editorContentAlignment,
    imageCompressionEnabled,
    memoListWidth,
    resetMemoListWidth,
    setDesktopFocusMode,
    setEditorContentAlignment,
    setImageCompressionEnabled,
    setMemoListWidth,
    setShortcutSettings,
    shortcutSettings,
  };
};
