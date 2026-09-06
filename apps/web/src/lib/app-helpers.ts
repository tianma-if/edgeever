import type { MemoSummary, Notebook, TiptapDoc } from "@edgeever/shared";
import { DEFAULT_MEMO_TITLE } from "@edgeever/shared";
import { getMobileNotebookSearchVisibleIds } from "@edgeever/shared/mobile-ui";
import type { MemoFilterMode, MemoSortMode } from "@edgeever/client";
import { buildNotebookTree, type NotebookNode, type NotebookNodeComparator } from "./utils";
import * as React from "react";
import type { ReactNode } from "react";
import type { TFunction } from "i18next";

export type Pane = "notebooks" | "memos" | "editor";
export type MemoView = "notebook" | "trash";
export type { MemoFilterMode, MemoSortMode } from "@edgeever/client";
export type NotebookSortMode = "custom" | "name-asc" | "memo-count-desc" | "updated-desc";
export type EditorContentAlignment = "start" | "center";
export type MemoListDensity = "preview" | "compact";
export type ShortcutAction =
  | "createMemo"
  | "createNotebook"
  | "focusSearch"
  | "focusGlobalSearch"
  | "focusReplace"
  | "openQuickSwitcher"
  | "openPreviousMemo"
  | "openNextMemo"
  | "openAiAssistant"
  | "saveAndSync"
  | "toggleReadingProtection"
  | "toggleEditorMode"
  | "toggleOutline";
export type ShortcutBinding = {
  key: string;
  ctrlOrMeta: boolean;
  shift: boolean;
  alt: boolean;
};
export type ShortcutSettings = Record<ShortcutAction, ShortcutBinding>;
export type MobileBottomNavItem = "home" | "search" | "templates" | "settings" | "companion";
export type MemoContextMenuState = { memo: MemoSummary; x: number; y: number };
export type MemoDocumentAction =
  | "share"
  | "export-markdown"
  | "export-html"
  | "export-pdf"
  | "share-image"
  | "save-as-template";
export type MemoDocumentActionRequest = {
  id: number;
  memoId: string;
  action: MemoDocumentAction;
  printWindow?: Window | null;
};
export type MemoSelectionContextMenuState = { x: number; y: number };
export type NotebookContextMenuState = { notebook: NotebookNode; x: number; y: number };
export type MemoDeleteConfirmation = { kind: "single" | "bulk"; memoIds: string[]; permanent: boolean };

export type NotebookNameDialogState =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; notebook: Notebook };

export type AppNoticeDialogState = { title: string; description: string };

export const isTextEntryTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], .ProseMirror"));

export const getSearchShortcutScope = (selectedMemoId: string | null): "note" | "memo-list" =>
  selectedMemoId ? "note" : "memo-list";

export const getNotebookAncestorIds = (nodes: NotebookNode[], targetNotebookId: string) => {
  const walk = (items: NotebookNode[], ancestors: string[]): string[] | null => {
    for (const node of items) {
      if (node.id === targetNotebookId) {
        return node.children.length > 0 ? [...ancestors, node.id] : ancestors;
      }

      const result = walk(node.children, [...ancestors, node.id]);

      if (result) {
        return result;
      }
    }

    return null;
  };

  return walk(nodes, []) ?? [];
};

export const getExpandableNotebookIds = (nodes: NotebookNode[]) => {
  const ids: string[] = [];
  const walk = (items: NotebookNode[]) => {
    for (const node of items) {
      if (node.children.length > 0) {
        ids.push(node.id);
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return ids;
};

export const filterNotebookTree = (nodes: NotebookNode[], search: string): NotebookNode[] => {
  if (!search.trim()) {
    return nodes;
  }

  const notebooks: Notebook[] = [];
  const collectNotebooks = (items: NotebookNode[]) => {
    for (const node of items) {
      notebooks.push(node);
      collectNotebooks(node.children);
    }
  };
  collectNotebooks(nodes);
  const visibleIds = getMobileNotebookSearchVisibleIds(notebooks, search);

  const walk = (items: NotebookNode[]): NotebookNode[] => {
    return items
      .filter((node) => visibleIds.has(node.id))
      .map((node) => ({ ...node, children: walk(node.children) }));
  };

  return walk(nodes);
};

export { buildNotebookTree, type NotebookNode };
export { DEFAULT_MEMO_TITLE };

export const IMAGE_COMPRESSION_STORAGE_KEY = "edgeever.imageCompressionEnabled";
export const DESKTOP_FOCUS_MODE_STORAGE_KEY = "edgeever.desktopFocusMode";
export const DESKTOP_READING_PROTECTION_STORAGE_KEY = "edgeever.desktopReadingProtection";
export const EDITOR_OUTLINE_COLLAPSED_STORAGE_KEY = "edgeever.editorOutlineCollapsed";
export const EDITOR_CONTENT_ALIGNMENT_STORAGE_KEY = "edgeever.editorContentAlignment";
export const EDITOR_TOOLBAR_EXPANDED_STORAGE_KEY = "edgeever.editorToolbarExpanded";
export const MEMO_LIST_DENSITY_STORAGE_KEY = "edgeever.memoListDensity";
export const MEMO_LIST_WIDTH_STORAGE_KEY = "edgeever.memoListWidth";
export const NOTEBOOK_SORT_STORAGE_KEY = "edgeever.notebookSort";
export const SHORTCUT_SETTINGS_STORAGE_KEY = "edgeever.shortcutSettings";
export const DEFAULT_MEMO_LIST_WIDTH_PX = 360;
export const MIN_MEMO_LIST_WIDTH_PX = 300;
export const MAX_MEMO_LIST_WIDTH_PX = 540;
export const EDITOR_LOCAL_SAVE_DELAY_MS = 1_200;

export const MEMO_DRAG_MIME = "application/x-edgeever-memos";
export const NOTEBOOK_DRAG_MIME = "application/x-edgeever-notebook";

export const getMemoSortOptions = (t: TFunction): Array<{ value: MemoSortMode; label: string }> => [
  { value: "updated-desc", label: t("options.memoSort.updatedDesc") },
  { value: "created-desc", label: t("options.memoSort.createdDesc") },
  { value: "title-asc", label: t("options.memoSort.titleAsc") },
];

const NOTEBOOK_SORT_VALUES: NotebookSortMode[] = ["custom", "name-asc", "memo-count-desc", "updated-desc"];

export const getNotebookSortOptions = (t: TFunction): Array<{ value: NotebookSortMode; label: string }> => [
  { value: "custom", label: t("options.notebookSort.custom") },
  { value: "name-asc", label: t("options.notebookSort.nameAsc") },
  { value: "memo-count-desc", label: t("options.notebookSort.memoCountDesc") },
  { value: "updated-desc", label: t("options.notebookSort.updatedDesc") },
];

export const getMemoFilterOptions = (t: TFunction): Array<{ value: MemoFilterMode; label: string }> => [
  { value: "all", label: t("options.memoFilter.all") },
  { value: "pinned", label: t("options.memoFilter.pinned") },
  { value: "tagged", label: t("options.memoFilter.tagged") },
  { value: "untagged", label: t("options.memoFilter.untagged") },
];

export const getShortcutActionOptions = (
  t: TFunction
): Array<{ value: ShortcutAction; label: string; description: string }> => [
  {
    value: "createMemo",
    label: t("shortcuts.actions.createMemo.label"),
    description: t("shortcuts.actions.createMemo.description"),
  },
  {
    value: "createNotebook",
    label: t("shortcuts.actions.createNotebook.label"),
    description: t("shortcuts.actions.createNotebook.description"),
  },
  {
    value: "focusSearch",
    label: t("shortcuts.actions.focusSearch.label"),
    description: t("shortcuts.actions.focusSearch.description"),
  },
  {
    value: "focusGlobalSearch",
    label: t("shortcuts.actions.focusGlobalSearch.label"),
    description: t("shortcuts.actions.focusGlobalSearch.description"),
  },
  {
    value: "focusReplace",
    label: t("shortcuts.actions.focusReplace.label"),
    description: t("shortcuts.actions.focusReplace.description"),
  },
  {
    value: "openQuickSwitcher",
    label: t("shortcuts.actions.openQuickSwitcher.label"),
    description: t("shortcuts.actions.openQuickSwitcher.description"),
  },
  {
    value: "openPreviousMemo",
    label: t("shortcuts.actions.openPreviousMemo.label"),
    description: t("shortcuts.actions.openPreviousMemo.description"),
  },
  {
    value: "openNextMemo",
    label: t("shortcuts.actions.openNextMemo.label"),
    description: t("shortcuts.actions.openNextMemo.description"),
  },
  {
    value: "openAiAssistant",
    label: t("shortcuts.actions.openAiAssistant.label"),
    description: t("shortcuts.actions.openAiAssistant.description"),
  },
  {
    value: "saveAndSync",
    label: t("shortcuts.actions.saveAndSync.label"),
    description: t("shortcuts.actions.saveAndSync.description"),
  },
  {
    value: "toggleReadingProtection",
    label: t("shortcuts.actions.toggleReadingProtection.label"),
    description: t("shortcuts.actions.toggleReadingProtection.description"),
  },
  {
    value: "toggleEditorMode",
    label: t("shortcuts.actions.toggleEditorMode.label"),
    description: t("shortcuts.actions.toggleEditorMode.description"),
  },
  {
    value: "toggleOutline",
    label: t("shortcuts.actions.toggleOutline.label"),
    description: t("shortcuts.actions.toggleOutline.description"),
  },
];

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = {
  createMemo: { key: "n", ctrlOrMeta: true, shift: false, alt: false },
  createNotebook: { key: "n", ctrlOrMeta: true, shift: true, alt: false },
  focusSearch: { key: "f", ctrlOrMeta: true, shift: false, alt: false },
  focusGlobalSearch: { key: "f", ctrlOrMeta: true, shift: true, alt: false },
  focusReplace: { key: "h", ctrlOrMeta: true, shift: false, alt: false },
  openQuickSwitcher: { key: "o", ctrlOrMeta: true, shift: false, alt: false },
  openPreviousMemo: { key: "[", ctrlOrMeta: true, shift: false, alt: false },
  openNextMemo: { key: "]", ctrlOrMeta: true, shift: false, alt: false },
  openAiAssistant: { key: "j", ctrlOrMeta: true, shift: false, alt: false },
  saveAndSync: { key: "s", ctrlOrMeta: true, shift: false, alt: false },
  toggleReadingProtection: { key: "e", ctrlOrMeta: true, shift: false, alt: false },
  toggleEditorMode: { key: "/", ctrlOrMeta: true, shift: false, alt: false },
  toggleOutline: { key: "1", ctrlOrMeta: true, shift: true, alt: false },
};

const LEGACY_READING_PROTECTION_SHORTCUT: ShortcutBinding = {
  key: "l",
  ctrlOrMeta: true,
  shift: true,
  alt: false,
};

const SHORTCUT_ALIASES: Partial<Record<ShortcutAction, ShortcutBinding[]>> = {
  focusReplace: [{ key: "h", ctrlOrMeta: true, shift: true, alt: false }],
};

const SHORTCUT_ACTION_VALUES: ShortcutAction[] = [
  "createMemo",
  "createNotebook",
  "focusSearch",
  "focusGlobalSearch",
  "focusReplace",
  "openQuickSwitcher",
  "openPreviousMemo",
  "openNextMemo",
  "openAiAssistant",
  "saveAndSync",
  "toggleReadingProtection",
  "toggleEditorMode",
  "toggleOutline",
];

export const isDefaultMemoTitle = (title: string | null | undefined) => title?.trim() === DEFAULT_MEMO_TITLE;

export const getEditableMemoTitle = (title: string | null | undefined) =>
  isDefaultMemoTitle(title) ? "" : title?.trim() || "";

export const getMemoTitle = (title: string | null | undefined) => title?.trim() || DEFAULT_MEMO_TITLE;

export const getActiveBlockValue = (editor: any): string => {
  if (!editor || editor.isDestroyed || !editor.extensionManager) {
    return "paragraph";
  }

  try {
    if (editor.isActive("heading", { level: 1 })) {
      return "heading-1";
    }
    if (editor.isActive("heading", { level: 2 })) {
      return "heading-2";
    }
    if (editor.isActive("heading", { level: 3 })) {
      return "heading-3";
    }
  } catch {
    return "paragraph";
  }
  return "paragraph";
};

export const readImageCompressionPreference = () => {
  try {
    return window.localStorage.getItem(IMAGE_COMPRESSION_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
};

export const writeImageCompressionPreference = (enabled: boolean) => {
  try {
    window.localStorage.setItem(IMAGE_COMPRESSION_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const readDesktopFocusModePreference = () => {
  try {
    return window.localStorage.getItem(DESKTOP_FOCUS_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const writeDesktopFocusModePreference = (enabled: boolean) => {
  try {
    window.localStorage.setItem(DESKTOP_FOCUS_MODE_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const readDesktopReadingProtectionPreference = () => {
  try {
    return window.localStorage.getItem(DESKTOP_READING_PROTECTION_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const writeDesktopReadingProtectionPreference = (enabled: boolean) => {
  try {
    window.localStorage.setItem(DESKTOP_READING_PROTECTION_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const readEditorOutlineCollapsedPreference = () => {
  try {
    return window.localStorage.getItem(EDITOR_OUTLINE_COLLAPSED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
};

export const writeEditorOutlineCollapsedPreference = (collapsed: boolean) => {
  try {
    window.localStorage.setItem(EDITOR_OUTLINE_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const readEditorContentAlignmentPreference = (): EditorContentAlignment => {
  try {
    return window.localStorage.getItem(EDITOR_CONTENT_ALIGNMENT_STORAGE_KEY) === "center" ? "center" : "start";
  } catch {
    return "start";
  }
};

export const writeEditorContentAlignmentPreference = (alignment: EditorContentAlignment) => {
  try {
    window.localStorage.setItem(EDITOR_CONTENT_ALIGNMENT_STORAGE_KEY, alignment);
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const readEditorToolbarExpandedPreference = () => {
  try {
    return window.localStorage.getItem(EDITOR_TOOLBAR_EXPANDED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const writeEditorToolbarExpandedPreference = (expanded: boolean) => {
  try {
    window.localStorage.setItem(EDITOR_TOOLBAR_EXPANDED_STORAGE_KEY, expanded ? "true" : "false");
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const readMemoListDensityPreference = (): MemoListDensity => {
  try {
    const density = window.localStorage.getItem(MEMO_LIST_DENSITY_STORAGE_KEY);
    return density === "compact" ? "compact" : "preview";
  } catch {
    return "preview";
  }
};

export const writeMemoListDensityPreference = (density: MemoListDensity) => {
  try {
    window.localStorage.setItem(MEMO_LIST_DENSITY_STORAGE_KEY, density);
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const clampMemoListWidth = (width: number) =>
  Math.min(MAX_MEMO_LIST_WIDTH_PX, Math.max(MIN_MEMO_LIST_WIDTH_PX, Math.round(width)));

export const readMemoListWidthPreference = () => {
  try {
    const width = Number(window.localStorage.getItem(MEMO_LIST_WIDTH_STORAGE_KEY));
    return Number.isFinite(width) ? clampMemoListWidth(width) : DEFAULT_MEMO_LIST_WIDTH_PX;
  } catch {
    return DEFAULT_MEMO_LIST_WIDTH_PX;
  }
};

export const writeMemoListWidthPreference = (width: number) => {
  try {
    window.localStorage.setItem(MEMO_LIST_WIDTH_STORAGE_KEY, String(clampMemoListWidth(width)));
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const readNotebookSortPreference = (): NotebookSortMode => {
  try {
    const sortMode = window.localStorage.getItem(NOTEBOOK_SORT_STORAGE_KEY);
    return NOTEBOOK_SORT_VALUES.includes(sortMode as NotebookSortMode) ? (sortMode as NotebookSortMode) : "name-asc";
  } catch {
    return "name-asc";
  }
};

export const writeNotebookSortPreference = (sortMode: NotebookSortMode) => {
  try {
    window.localStorage.setItem(NOTEBOOK_SORT_STORAGE_KEY, sortMode);
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const normalizeShortcutKey = (key: string) => {
  if (key === " ") {
    return "space";
  }

  return key.toLowerCase();
};

const isShortcutBinding = (value: unknown): value is ShortcutBinding => {
  const binding = value as ShortcutBinding;
  return (
    Boolean(binding) &&
    typeof binding.key === "string" &&
    binding.key.trim().length > 0 &&
    typeof binding.ctrlOrMeta === "boolean" &&
    typeof binding.shift === "boolean" &&
    typeof binding.alt === "boolean"
  );
};

export const readShortcutSettingsPreference = (): ShortcutSettings => {
  try {
    const rawValue = window.localStorage.getItem(SHORTCUT_SETTINGS_STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_SHORTCUT_SETTINGS;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<ShortcutSettings>;
    return SHORTCUT_ACTION_VALUES.reduce<ShortcutSettings>((settings, action) => {
      const storedBinding = parsedValue[action];
      const normalizedBinding = isShortcutBinding(storedBinding)
        ? { ...storedBinding, key: normalizeShortcutKey(storedBinding.key) }
        : DEFAULT_SHORTCUT_SETTINGS[action];
      const binding = action === "toggleReadingProtection"
        && shortcutBindingsEqual(normalizedBinding, LEGACY_READING_PROTECTION_SHORTCUT)
          ? DEFAULT_SHORTCUT_SETTINGS.toggleReadingProtection
          : normalizedBinding;

      return { ...settings, [action]: binding };
    }, { ...DEFAULT_SHORTCUT_SETTINGS });
  } catch {
    return DEFAULT_SHORTCUT_SETTINGS;
  }
};

export const writeShortcutSettingsPreference = (settings: ShortcutSettings) => {
  try {
    window.localStorage.setItem(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
};

export const formatShortcutBinding = (binding: ShortcutBinding) => {
  const isMac = /mac|iphone|ipad|ipod/i.test(window.navigator.platform);
  const parts = [
    binding.ctrlOrMeta ? (isMac ? "⌘" : "Ctrl") : null,
    binding.alt ? (isMac ? "⌥" : "Alt") : null,
    binding.shift ? (isMac ? "⇧" : "Shift") : null,
    binding.key === "space" ? "Space" : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key,
  ].filter(Boolean);

  return parts.join(isMac ? "" : " + ");
};

export const shortcutBindingFromKeyboardEvent = (event: KeyboardEvent): ShortcutBinding | null => {
  const digitKey = typeof event.code === "string" ? /^Digit([0-9])$/.exec(event.code)?.[1] : undefined;
  const key = digitKey ?? normalizeShortcutKey(event.key);

  if (["control", "meta", "shift", "alt", "escape"].includes(key)) {
    return null;
  }

  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    return null;
  }

  return {
    key,
    ctrlOrMeta: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
};

export const shortcutBindingsEqual = (first: ShortcutBinding, second: ShortcutBinding) =>
  first.key === second.key &&
  first.ctrlOrMeta === second.ctrlOrMeta &&
  first.shift === second.shift &&
  first.alt === second.alt;

export const getShortcutActionForEvent = (event: KeyboardEvent, settings: ShortcutSettings): ShortcutAction | null => {
  const eventBinding = shortcutBindingFromKeyboardEvent(event);

  if (!eventBinding) {
    return null;
  }

  return SHORTCUT_ACTION_VALUES.find((action) =>
    shortcutBindingsEqual(settings[action], eventBinding) ||
    (SHORTCUT_ALIASES[action] ?? []).some((binding) => shortcutBindingsEqual(binding, eventBinding))
  ) ?? null;
};

export const compareDateDesc = (first: string, second: string) => {
  const firstTime = Date.parse(first);
  const secondTime = Date.parse(second);

  if (Number.isNaN(firstTime) && Number.isNaN(secondTime)) {
    return 0;
  }

  if (Number.isNaN(firstTime)) {
    return 1;
  }

  if (Number.isNaN(secondTime)) {
    return -1;
  }

  return secondTime - firstTime;
};

const compareNotebookNameAsc = (first: Notebook, second: Notebook) =>
  first.name.localeCompare(second.name, "zh-CN", { numeric: true, sensitivity: "base" });

const compareNotebookUpdatedDesc = (first: Notebook, second: Notebook) => {
  const dateCompare = compareDateDesc(first.lastMemoUpdatedAt ?? first.updatedAt, second.lastMemoUpdatedAt ?? second.updatedAt);
  return dateCompare !== 0 ? dateCompare : compareNotebookNameAsc(first, second);
};

export const getNotebookSortComparator = (sortMode: NotebookSortMode): NotebookNodeComparator => {
  if (sortMode === "custom") {
    return (first, second) => first.sortOrder - second.sortOrder || compareNotebookNameAsc(first, second);
  }

  if (sortMode === "memo-count-desc") {
    return (first, second) => second.memoCount - first.memoCount || compareNotebookNameAsc(first, second);
  }

  if (sortMode === "updated-desc") {
    return compareNotebookUpdatedDesc;
  }

  return compareNotebookNameAsc;
};

export const sortMemos = (memos: MemoSummary[], sortMode: MemoSortMode, prioritizePinned = true) =>
  [...memos].sort((first, second) => {
    if (prioritizePinned && first.isPinned !== second.isPinned) {
      return first.isPinned ? -1 : 1;
    }

    if (sortMode === "title-asc") {
      const titleCompare = getMemoTitle(first.title).localeCompare(getMemoTitle(second.title), "zh-CN", {
        numeric: true,
        sensitivity: "base",
      });

      if (titleCompare !== 0) {
        return titleCompare;
      }

      return compareDateDesc(first.updatedAt, second.updatedAt);
    }

    if (sortMode === "created-desc") {
      return compareDateDesc(first.createdAt, second.createdAt);
    }

    return compareDateDesc(first.updatedAt, second.updatedAt);
  });

export const filterMemos = (memos: MemoSummary[], filterMode: MemoFilterMode) => {
  if (filterMode === "tagged") {
    return memos.filter((memo) => memo.tags.length > 0);
  }

  if (filterMode === "untagged") {
    return memos.filter((memo) => memo.tags.length === 0);
  }

  if (filterMode === "pinned") {
    return memos.filter((memo) => memo.isPinned);
  }

  return memos;
};

export type NotebookMoveOption = { id: string; name: string; selectLabel: string; slug: string | null; depth: number };

export const getNotebookMoveOptions = (notebooks: Notebook[]) => {
  const options: NotebookMoveOption[] = [];
  const walk = (nodes: NotebookNode[], depth: number) => {
    for (const node of nodes) {
      options.push({
        id: node.id,
        name: node.name,
        selectLabel: `${"\u00A0\u00A0".repeat(depth)}${depth > 0 ? "└ " : ""}${node.name}`,
        slug: node.slug,
        depth,
      });
      walk(node.children, depth + 1);
    }
  };

  walk(buildNotebookTree(notebooks), 0);
  return options;
};

export const hasMemoDragData = (dataTransfer: DataTransfer) => Array.from(dataTransfer.types).includes(MEMO_DRAG_MIME);
export const hasNotebookDragData = (dataTransfer: DataTransfer) => Array.from(dataTransfer.types).includes(NOTEBOOK_DRAG_MIME);
export const hasEdgeEverDragData = (dataTransfer: DataTransfer) => hasMemoDragData(dataTransfer) || hasNotebookDragData(dataTransfer);

export const getMemoDragIds = (dataTransfer: DataTransfer) => {
  if (!hasMemoDragData(dataTransfer)) {
    return [];
  }

  try {
    const parsed = JSON.parse(dataTransfer.getData(MEMO_DRAG_MIME)) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  } catch {
    return [];
  }
};

export type NotebookDropPosition = "before" | "inside" | "after";

export const getNotebookDropPosition = (event: React.DragEvent<HTMLElement> | DragEvent): NotebookDropPosition => {
  const currentTarget = event.currentTarget as HTMLElement;
  const rect = currentTarget.getBoundingClientRect();
  const offset = event.clientY - rect.top;

  if (offset < rect.height * 0.28) {
    return "before";
  }

  if (offset > rect.height * 0.72) {
    return "after";
  }

  return "inside";
};

export const getNotebookDropSortOrder = (
  notebooks: Notebook[],
  target: Notebook,
  position: Exclude<NotebookDropPosition, "inside">
) => {
  const siblings = notebooks
    .filter((notebook) => notebook.parentId === target.parentId)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
  const targetIndex = siblings.findIndex((notebook) => notebook.id === target.id);
  const insertionIndex = targetIndex < 0 ? siblings.length : position === "before" ? targetIndex : targetIndex + 1;
  const previous = siblings[insertionIndex - 1];
  const next = siblings[insertionIndex];

  if (!previous && !next) {
    return target.sortOrder + (position === "before" ? -1000 : 1000);
  }

  if (!previous) {
    return next.sortOrder - 1000;
  }

  if (!next) {
    return previous.sortOrder + 1000;
  }

  return Math.floor((previous.sortOrder + next.sortOrder) / 2);
};

export const focusNotebookTreeButton = (
  currentButton: HTMLButtonElement,
  direction: "next" | "previous" | "first" | "last"
) => {
  const tree = currentButton.closest<HTMLElement>("[data-notebook-tree]");

  if (!tree) {
    return;
  }

  const buttons = Array.from(tree.querySelectorAll<HTMLButtonElement>("[data-notebook-tree-button]")).filter(
    (button) => !button.disabled
  );
  const currentIndex = buttons.indexOf(currentButton);

  if (currentIndex < 0 || buttons.length === 0) {
    return;
  }

  const nextIndex =
    direction === "first"
      ? 0
      : direction === "last"
        ? buttons.length - 1
        : direction === "next"
          ? Math.min(currentIndex + 1, buttons.length - 1)
          : Math.max(currentIndex - 1, 0);
  const nextButton = buttons[nextIndex];

  if (!nextButton || nextButton === currentButton) {
    return;
  }

  nextButton.focus({ preventScroll: true });
  nextButton.scrollIntoView({ block: "nearest" });
};

export const notebookTreeContainsId = (nodes: NotebookNode[], targetNotebookId: string): boolean => {
  for (const node of nodes) {
    if (node.id === targetNotebookId || notebookTreeContainsId(node.children, targetNotebookId)) {
      return true;
    }
  }

  return false;
};

export const setMemoDragPreview = (dataTransfer: DataTransfer, label: string) => {
  const dragImage = document.createElement("div");

  dragImage.innerHTML = `
    <svg style="width: 15px; height: 15px; color: var(--brand-green); flex-shrink: 0;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"></path>
    </svg>
    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">${label}</span>
  `;

  Object.assign(dragImage.style, {
    position: "fixed",
    top: "-9999px",
    left: "-9999px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    maxWidth: "240px",
    border: "1px solid rgba(98, 127, 88, 0.28)",
    borderRadius: "8px",
    background: "rgba(244, 248, 243, 0.9)",
    backdropFilter: "blur(10px)",
    webkitBackdropFilter: "blur(10px)",
    boxShadow: "0 12px 24px -4px rgba(98, 127, 88, 0.15), 0 4px 12px -2px rgba(15, 23, 42, 0.05)",
    color: "#2c3b28",
    font: "13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: "8px 12px",
    pointerEvents: "none",
    zIndex: "9999",
  });

  document.body.appendChild(dragImage);
  dataTransfer.setDragImage(dragImage, 16, 18);
  window.setTimeout(() => dragImage.remove(), 0);
};
