export const AI_SPACE_SHORTCUT_STORAGE_KEY = "edgeever.editor.aiSpaceShortcutEnabled";

export const AI_SPACE_SHORTCUT_CHANGED_EVENT = "edgeever:ai-space-shortcut-changed";

export const resolveStoredAiSpaceShortcutPreference = (stored: string | null): boolean =>
  stored !== "false";

export const readAiSpaceShortcutPreference = (): boolean => {
  if (typeof window === "undefined") return true;
  try {
    return resolveStoredAiSpaceShortcutPreference(
      window.localStorage?.getItem(AI_SPACE_SHORTCUT_STORAGE_KEY) ?? null,
    );
  } catch {
    return true;
  }
};

export const writeAiSpaceShortcutPreference = (enabled: boolean) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(AI_SPACE_SHORTCUT_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Private mode / blocked storage — preference is session-only via the event.
  }
  window.dispatchEvent(
    new CustomEvent(AI_SPACE_SHORTCUT_CHANGED_EVENT, { detail: enabled }),
  );
};
