/** Helpers for editor hyperlink click policy (desktop preference + mobile always-click). */

export type EditorLinkClick = {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
};

/**
 * Desktop preference:
 * - `modifier` (default): require Ctrl/⌘ + click to open (plain click places caret)
 * - `click`: plain primary click opens navigable links while editing
 *
 * Mobile always opens on primary click regardless of this preference.
 */
export type EditorLinkOpenMode = "click" | "modifier";

export const DEFAULT_EDITOR_LINK_OPEN_MODE: EditorLinkOpenMode = "modifier";

export const shouldShowEditorLinkOpenHint = (
  editable: boolean,
  isMobileViewport: boolean,
  mode: EditorLinkOpenMode
): boolean => editable && !isMobileViewport && mode === "modifier";

export const EDITOR_LINK_OPEN_MODE_STORAGE_KEY = "edgeever.editor.linkOpenMode";

export const EDITOR_LINK_OPEN_MODE_CHANGED_EVENT = "edgeever:editor-link-open-mode-changed";

export const resolveStoredEditorLinkOpenMode = (stored: string | null): EditorLinkOpenMode =>
  stored === "click" || stored === "modifier" ? stored : DEFAULT_EDITOR_LINK_OPEN_MODE;

const readLocalStorageItem = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

export const getStoredEditorLinkOpenMode = (): EditorLinkOpenMode => {
  const stored = readLocalStorageItem(EDITOR_LINK_OPEN_MODE_STORAGE_KEY);
  return resolveStoredEditorLinkOpenMode(stored);
};

export const writeEditorLinkOpenMode = (mode: EditorLinkOpenMode) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(EDITOR_LINK_OPEN_MODE_STORAGE_KEY, mode);
  } catch {
    // Private mode / blocked storage — preference is session-only via the event.
  }
  window.dispatchEvent(
    new CustomEvent(EDITOR_LINK_OPEN_MODE_CHANGED_EVENT, { detail: mode })
  );
};

export type ShouldOpenEditorLinkOptions = {
  /**
   * When true, plain click does not open while the document is editable —
   * Ctrl/⌘ is required. When false (default product behavior), plain click opens.
   */
  requireModifier?: boolean;
};

/** Internal note references are navigation controls, not editable web hyperlinks. */
export const shouldOpenInternalNoteLink = (
  event: EditorLinkClick,
  memoId: string | null
): boolean => Boolean(memoId) && event.button === 0;

/**
 * Decide whether a primary click should open a navigable editor link.
 * Read-only documents always open on primary click.
 */
export const shouldOpenEditorLink = (
  event: EditorLinkClick,
  editable: boolean,
  options?: ShouldOpenEditorLinkOptions
): boolean => {
  if (event.button !== 0) {
    return false;
  }

  if (!editable) {
    return true;
  }

  if (options?.requireModifier) {
    return event.ctrlKey || event.metaKey;
  }

  return true;
};

/** Desktop only: require Ctrl/⌘ when the stored preference is `modifier`. */
export const resolveEditorLinkRequireModifier = (isMobileViewport: boolean): boolean =>
  !isMobileViewport && getStoredEditorLinkOpenMode() === "modifier";
