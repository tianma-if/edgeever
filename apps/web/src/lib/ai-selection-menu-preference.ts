export const AI_SELECTION_MENU_STORAGE_KEY = "edgeever.editor.aiSelectionMenuEnabled";

export const AI_SELECTION_MENU_CHANGED_EVENT = "edgeever:ai-selection-menu-changed";

export const resolveStoredAiSelectionMenuPreference = (stored: string | null): boolean =>
  stored !== "false";

export const readAiSelectionMenuPreference = (): boolean => {
  if (typeof window === "undefined") return true;
  try {
    return resolveStoredAiSelectionMenuPreference(
      window.localStorage?.getItem(AI_SELECTION_MENU_STORAGE_KEY) ?? null,
    );
  } catch {
    return true;
  }
};

export const writeAiSelectionMenuPreference = (enabled: boolean) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(AI_SELECTION_MENU_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Private mode / blocked storage — preference is session-only via the event.
  }
  window.dispatchEvent(
    new CustomEvent(AI_SELECTION_MENU_CHANGED_EVENT, { detail: enabled }),
  );
};
