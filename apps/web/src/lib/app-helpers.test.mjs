import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import {
  DEFAULT_MEMO_TITLE,
  EDITOR_HEADING_LEVELS,
  IMAGE_COMPRESSION_STORAGE_KEY,
  MEMO_DRAG_MIME,
  MEMO_LIST_DENSITY_STORAGE_KEY,
  MEMO_SORT_STORAGE_KEY,
  NOTEBOOK_DRAG_MIME,
  buildNotebookTree,
  compareDateDesc,
  filterMemos,
  filterNotebookTree,
  focusNotebookTreeButton,
  getEditableMemoTitle,
  getExpandableNotebookIds,
  getMemoDragIds,
  getMemoFilterOptions,
  getMemoSortOptions,
  getMemoTitle,
  getNotebookAncestorIds,
  getNotebookDropPosition,
  getNotebookDropSortOrder,
  getNotebookMoveOptions,
  getNotebookSortOptions,
  hasEdgeEverDragData,
  hasMemoDragData,
  hasNotebookDragData,
  headingBlockValue,
  isDefaultMemoTitle,
  isTextEntryTarget,
  normalizeShortcutKey,
  notebookTreeContainsId,
  readImageCompressionPreference,
  readMemoListDensityPreference,
  readMemoSortPreference,
  resolvedShortcutModifiers,
  setMemoDragPreview,
  sortMemos,
  writeImageCompressionPreference,
  writeMemoListDensityPreference,
  writeMemoSortPreference,
  writeShortcutSettingsPreference,
} from "./app-helpers.ts";
import {
  DEFAULT_SHORTCUT_SETTINGS,
  DESKTOP_FOCUS_MODE_STORAGE_KEY,
  DESKTOP_READING_PROTECTION_STORAGE_KEY,
  NOTEBOOK_SIDEBAR_COLLAPSED_STORAGE_KEY,
  NOTEBOOK_SIDEBAR_WIDTH_STORAGE_KEY,
  DEFAULT_NOTEBOOK_SIDEBAR_WIDTH_PX,
  MIN_NOTEBOOK_SIDEBAR_WIDTH_PX,
  MAX_NOTEBOOK_SIDEBAR_WIDTH_PX,
  EDITOR_OUTLINE_COLLAPSED_STORAGE_KEY,
  EDITOR_CONTENT_ALIGNMENT_STORAGE_KEY,
  EDITOR_TOOLBAR_EXPANDED_STORAGE_KEY,
  EDITOR_PHONE_PREVIEW_STORAGE_KEY,
  EDITOR_PHONE_PREVIEW_FOLLOW_STORAGE_KEY,
  MEMO_LIST_WIDTH_STORAGE_KEY,
  DEFAULT_MEMO_LIST_WIDTH_PX,
  MIN_MEMO_LIST_WIDTH_PX,
  MAX_MEMO_LIST_WIDTH_PX,
  MIN_EDITOR_WIDTH_PX,
  NOTEBOOK_SORT_STORAGE_KEY,
  NOTEBOOK_SECTION_COLLAPSED_STORAGE_KEY,
  NOTEBOOK_TREE_COLLAPSED_IDS_STORAGE_KEY,
  SHORTCUT_SETTINGS_STORAGE_KEY,
  getSearchShortcutScope,
  getMaxMemoListWidthForViewport,
  getEditorPaneWidths,
  getCreateMemoNotebookId,
  formatShortcutBinding,
  getShortcutActionForEvent,
  getShortcutActionOptions,
  getDefaultShortcutSettings,
  isPrimaryModifierPressed,
  shortcutBindingFromKeyboardEvent,
  shortcutBindingsEqual,
  canToggleNotebookSidebar,
  clampMemoListWidth,
  clampNotebookSidebarWidth,
  getNotebookSortComparator,
  readEditorContentAlignmentPreference,
  readNotebookSortPreference,
  readNotebookSectionCollapsedPreference,
  readNotebookTreeCollapsedIdsPreference,
  readDesktopFocusModePreference,
  readDesktopReadingProtectionPreference,
  readNotebookSidebarCollapsedPreference,
  readNotebookSidebarWidthPreference,
  readMemoListWidthPreference,
  readEditorOutlineCollapsedPreference,
  readEditorToolbarExpandedPreference,
  readEditorPhonePreviewPreference,
  readEditorPhonePreviewFollowPreference,
  readShortcutSettingsPreference,
  writeEditorContentAlignmentPreference,
  writeNotebookSortPreference,
  writeNotebookSectionCollapsedPreference,
  writeNotebookTreeCollapsedIdsPreference,
  writeDesktopFocusModePreference,
  writeDesktopReadingProtectionPreference,
  writeNotebookSidebarCollapsedPreference,
  writeNotebookSidebarWidthPreference,
  writeMemoListWidthPreference,
  writeEditorOutlineCollapsedPreference,
  writeEditorToolbarExpandedPreference,
  writeEditorPhonePreviewPreference,
  writeEditorPhonePreviewFollowPreference,
  resolveSelectionMoveTargetNotebookId,
  getMemoIdsNeedingMove,
  getActiveBlockValue,
  parseHeadingBlockValue,
} from "./app-helpers.ts";

const originalWindow = globalThis.window;

test("a stale selected notebook cannot send a new note to the inbox", () => {
  const notebooks = [{ id: "nb_inbox" }, { id: "nb_remote" }];
  expect(getCreateMemoNotebookId("nb_local", notebooks, "nb_inbox")).toBeNull();
  expect(getCreateMemoNotebookId("nb_remote", notebooks, "nb_inbox")).toBe("nb_remote");
  expect(getCreateMemoNotebookId(null, notebooks, "nb_inbox")).toBe("nb_inbox");
});

const installLocalStorage = (initialValue = null) => {
  const values = new Map();
  if (initialValue !== null) {
    values.set(DESKTOP_FOCUS_MODE_STORAGE_KEY, initialValue);
  }

  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
  };

  return values;
};

afterEach(() => {
  if (originalWindow !== undefined) globalThis.window = originalWindow;
});

describe("search shortcut scope", () => {
  test("keeps Ctrl/Command+F within an open note regardless of viewport layout", () => {
    expect(getSearchShortcutScope("memo-1")).toBe("note");
  });

  test("uses memo-list search when no note is open", () => {
    expect(getSearchShortcutScope(null)).toBe("memo-list");
  });
});

describe("desktop focus mode preference", () => {
  test("defaults to disabled and only accepts an explicit true value", () => {
    installLocalStorage();
    expect(readDesktopFocusModePreference()).toBe(false);

    installLocalStorage("false");
    expect(readDesktopFocusModePreference()).toBe(false);

    installLocalStorage("true");
    expect(readDesktopFocusModePreference()).toBe(true);
  });

  test("persists enabled and disabled values", () => {
    const values = installLocalStorage();

    writeDesktopFocusModePreference(true);
    expect(values.get(DESKTOP_FOCUS_MODE_STORAGE_KEY)).toBe("true");

    writeDesktopFocusModePreference(false);
    expect(values.get(DESKTOP_FOCUS_MODE_STORAGE_KEY)).toBe("false");
  });

  test("fails closed when local storage is unavailable", () => {
    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    };

    expect(readDesktopFocusModePreference()).toBe(false);
    expect(() => writeDesktopFocusModePreference(true)).not.toThrow();
  });
});

describe("notebook sidebar collapsed preference", () => {
  test("defaults to expanded and only accepts an explicit true value", () => {
    installLocalStorage();
    expect(readNotebookSidebarCollapsedPreference()).toBe(false);

    const values = installLocalStorage();
    values.set(NOTEBOOK_SIDEBAR_COLLAPSED_STORAGE_KEY, "false");
    expect(readNotebookSidebarCollapsedPreference()).toBe(false);

    values.set(NOTEBOOK_SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    expect(readNotebookSidebarCollapsedPreference()).toBe(true);
  });

  test("persists collapsed and expanded values", () => {
    const values = installLocalStorage();

    writeNotebookSidebarCollapsedPreference(true);
    expect(values.get(NOTEBOOK_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("true");

    writeNotebookSidebarCollapsedPreference(false);
    expect(values.get(NOTEBOOK_SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("false");
  });

  test("fails closed when local storage is unavailable", () => {
    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    };

    expect(readNotebookSidebarCollapsedPreference()).toBe(false);
    expect(() => writeNotebookSidebarCollapsedPreference(true)).not.toThrow();
  });
});

describe("notebook sidebar width preference", () => {
  test("defaults to the standard width and clamps stored values", () => {
    const values = installLocalStorage();
    expect(readNotebookSidebarWidthPreference()).toBe(DEFAULT_NOTEBOOK_SIDEBAR_WIDTH_PX);

    values.set(NOTEBOOK_SIDEBAR_WIDTH_STORAGE_KEY, String(MIN_NOTEBOOK_SIDEBAR_WIDTH_PX - 100));
    expect(readNotebookSidebarWidthPreference()).toBe(MIN_NOTEBOOK_SIDEBAR_WIDTH_PX);

    values.set(NOTEBOOK_SIDEBAR_WIDTH_STORAGE_KEY, String(MAX_NOTEBOOK_SIDEBAR_WIDTH_PX + 100));
    expect(readNotebookSidebarWidthPreference()).toBe(MAX_NOTEBOOK_SIDEBAR_WIDTH_PX);

    values.set(NOTEBOOK_SIDEBAR_WIDTH_STORAGE_KEY, "invalid");
    expect(readNotebookSidebarWidthPreference()).toBe(DEFAULT_NOTEBOOK_SIDEBAR_WIDTH_PX);
  });

  test("rounds, clamps, and persists widths", () => {
    const values = installLocalStorage();
    expect(clampNotebookSidebarWidth(253.6)).toBe(254);

    writeNotebookSidebarWidthPreference(253.6);
    expect(values.get(NOTEBOOK_SIDEBAR_WIDTH_STORAGE_KEY)).toBe("254");

    writeNotebookSidebarWidthPreference(MAX_NOTEBOOK_SIDEBAR_WIDTH_PX + 100);
    expect(values.get(NOTEBOOK_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(MAX_NOTEBOOK_SIDEBAR_WIDTH_PX));
  });

  test("falls back safely when local storage is unavailable", () => {
    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    };

    expect(readNotebookSidebarWidthPreference()).toBe(DEFAULT_NOTEBOOK_SIDEBAR_WIDTH_PX);
    expect(() => writeNotebookSidebarWidthPreference(280)).not.toThrow();
  });
});

describe("memo list width preference", () => {
  test("uses the responsive-layout default when no width was stored", () => {
    const values = installLocalStorage();
    expect(readMemoListWidthPreference()).toBe(DEFAULT_MEMO_LIST_WIDTH_PX);

    values.set(MEMO_LIST_WIDTH_STORAGE_KEY, "invalid");
    expect(readMemoListWidthPreference()).toBe(DEFAULT_MEMO_LIST_WIDTH_PX);
  });

  test("allows a wider note list while clamping and persisting safe values", () => {
    const values = installLocalStorage();
    expect(clampMemoListWidth(MIN_MEMO_LIST_WIDTH_PX - 100)).toBe(MIN_MEMO_LIST_WIDTH_PX);
    expect(clampMemoListWidth(720)).toBe(720);
    expect(clampMemoListWidth(MAX_MEMO_LIST_WIDTH_PX + 100)).toBe(MAX_MEMO_LIST_WIDTH_PX);

    writeMemoListWidthPreference(720);
    expect(values.get(MEMO_LIST_WIDTH_STORAGE_KEY)).toBe("720");
  });

  test("keeps enough room for the editor header while resizing the note list", () => {
    expect(getMaxMemoListWidthForViewport(1692, 240)).toBe(800);
    expect(getMaxMemoListWidthForViewport(1280, 240)).toBe(400);
    expect(getMaxMemoListWidthForViewport(1024, 240)).toBe(144);
    expect(1280 - 240 - getMaxMemoListWidthForViewport(1280, 240)).toBe(MIN_EDITOR_WIDTH_PX);
  });

  test("uses the same actual widths and resize limits across desktop sizes", () => {
    for (const viewport of [1024, 1120, 1280, 1692, 1920]) {
      for (const sidebar of [56, 180, 240, 420]) {
        for (const preference of [300, 360, 800]) {
          const widths = getEditorPaneWidths(viewport, sidebar, preference);
          expect(viewport - widths.sidebar - widths.list).toBeGreaterThanOrEqual(MIN_EDITOR_WIDTH_PX);
          expect(widths.list).toBeGreaterThanOrEqual(widths.minimum);
          expect(widths.list).toBeLessThanOrEqual(widths.maximum);
          expect(widths.list).toBeGreaterThanOrEqual(180);
        }
      }
    }
    expect(getEditorPaneWidths(1024, 420, 800)).toEqual({ sidebar: 204, minimum: 180, maximum: 180, list: 180 });
    expect(getEditorPaneWidths(1920, 420, 800).list).toBe(800);
  });
});

describe("editor toolbar expanded preference", () => {
  test("defaults to collapsed and only accepts an explicit true value", () => {
    const values = installLocalStorage();
    expect(readEditorToolbarExpandedPreference()).toBe(false);

    values.set(EDITOR_TOOLBAR_EXPANDED_STORAGE_KEY, "false");
    expect(readEditorToolbarExpandedPreference()).toBe(false);

    values.set(EDITOR_TOOLBAR_EXPANDED_STORAGE_KEY, "true");
    expect(readEditorToolbarExpandedPreference()).toBe(true);
  });

  test("persists expanded and collapsed values", () => {
    const values = installLocalStorage();

    writeEditorToolbarExpandedPreference(true);
    expect(values.get(EDITOR_TOOLBAR_EXPANDED_STORAGE_KEY)).toBe("true");

    writeEditorToolbarExpandedPreference(false);
    expect(values.get(EDITOR_TOOLBAR_EXPANDED_STORAGE_KEY)).toBe("false");
  });
});

describe("editor phone preview preference", () => {
  test("defaults to hidden and only accepts an explicit true value", () => {
    const values = installLocalStorage();
    expect(readEditorPhonePreviewPreference()).toBe(false);

    values.set(EDITOR_PHONE_PREVIEW_STORAGE_KEY, "false");
    expect(readEditorPhonePreviewPreference()).toBe(false);

    values.set(EDITOR_PHONE_PREVIEW_STORAGE_KEY, "true");
    expect(readEditorPhonePreviewPreference()).toBe(true);
  });

  test("persists phone preview visibility", () => {
    const values = installLocalStorage();

    writeEditorPhonePreviewPreference(true);
    expect(values.get(EDITOR_PHONE_PREVIEW_STORAGE_KEY)).toBe("true");

    writeEditorPhonePreviewPreference(false);
    expect(values.get(EDITOR_PHONE_PREVIEW_STORAGE_KEY)).toBe("false");
  });

  test("defaults phone preview scroll following to on", () => {
    const values = installLocalStorage();
    expect(readEditorPhonePreviewFollowPreference()).toBe(true);

    values.set(EDITOR_PHONE_PREVIEW_FOLLOW_STORAGE_KEY, "false");
    expect(readEditorPhonePreviewFollowPreference()).toBe(false);

    values.set(EDITOR_PHONE_PREVIEW_FOLLOW_STORAGE_KEY, "true");
    expect(readEditorPhonePreviewFollowPreference()).toBe(true);
  });

  test("persists phone preview scroll following", () => {
    const values = installLocalStorage();

    writeEditorPhonePreviewFollowPreference(false);
    expect(values.get(EDITOR_PHONE_PREVIEW_FOLLOW_STORAGE_KEY)).toBe("false");

    writeEditorPhonePreviewFollowPreference(true);
    expect(values.get(EDITOR_PHONE_PREVIEW_FOLLOW_STORAGE_KEY)).toBe("true");
  });
});

describe("desktop reading protection preference", () => {
  test("defaults to editing and only accepts an explicit true value", () => {
    const values = installLocalStorage();
    expect(readDesktopReadingProtectionPreference()).toBe(false);

    values.set(DESKTOP_READING_PROTECTION_STORAGE_KEY, "false");
    expect(readDesktopReadingProtectionPreference()).toBe(false);

    values.set(DESKTOP_READING_PROTECTION_STORAGE_KEY, "true");
    expect(readDesktopReadingProtectionPreference()).toBe(true);
  });

  test("persists protected and editable modes", () => {
    const values = installLocalStorage();

    writeDesktopReadingProtectionPreference(true);
    expect(values.get(DESKTOP_READING_PROTECTION_STORAGE_KEY)).toBe("true");

    writeDesktopReadingProtectionPreference(false);
    expect(values.get(DESKTOP_READING_PROTECTION_STORAGE_KEY)).toBe("false");
  });

  test("fails open when local storage is unavailable", () => {
    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    };

    expect(readDesktopReadingProtectionPreference()).toBe(false);
    expect(() => writeDesktopReadingProtectionPreference(true)).not.toThrow();
  });
});

describe("editor outline preference", () => {
  test("defaults to collapsed and only expands for an explicit false value", () => {
    const values = installLocalStorage();
    expect(readEditorOutlineCollapsedPreference()).toBe(true);
    expect(readEditorOutlineCollapsedPreference({ defaultCollapsed: false })).toBe(false);
    expect(readEditorOutlineCollapsedPreference({ defaultCollapsed: true })).toBe(true);

    values.set(EDITOR_OUTLINE_COLLAPSED_STORAGE_KEY, "true");
    expect(readEditorOutlineCollapsedPreference()).toBe(true);
    expect(readEditorOutlineCollapsedPreference({ defaultCollapsed: false })).toBe(true);

    values.set(EDITOR_OUTLINE_COLLAPSED_STORAGE_KEY, "false");
    expect(readEditorOutlineCollapsedPreference()).toBe(false);
    expect(readEditorOutlineCollapsedPreference({ defaultCollapsed: true })).toBe(false);
  });

  test("persists collapsed and expanded states", () => {
    const values = installLocalStorage();

    writeEditorOutlineCollapsedPreference(false);
    expect(values.get(EDITOR_OUTLINE_COLLAPSED_STORAGE_KEY)).toBe("false");

    writeEditorOutlineCollapsedPreference(true);
    expect(values.get(EDITOR_OUTLINE_COLLAPSED_STORAGE_KEY)).toBe("true");
  });

  test("falls back to collapsed when local storage is unavailable", () => {
    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    };

    expect(readEditorOutlineCollapsedPreference()).toBe(true);
    expect(() => writeEditorOutlineCollapsedPreference(false)).not.toThrow();
  });
});

describe("editor content alignment preference", () => {
  test("defaults to left aligned and persists both supported alignments", () => {
    const values = installLocalStorage();
    expect(readEditorContentAlignmentPreference()).toBe("start");

    writeEditorContentAlignmentPreference("start");
    expect(values.get(EDITOR_CONTENT_ALIGNMENT_STORAGE_KEY)).toBe("start");
    expect(readEditorContentAlignmentPreference()).toBe("start");

    writeEditorContentAlignmentPreference("center");
    expect(values.get(EDITOR_CONTENT_ALIGNMENT_STORAGE_KEY)).toBe("center");
    expect(readEditorContentAlignmentPreference()).toBe("center");
  });

  test("falls back to left aligned for unknown or unavailable storage", () => {
    const values = installLocalStorage();
    values.set(EDITOR_CONTENT_ALIGNMENT_STORAGE_KEY, "unexpected");
    expect(readEditorContentAlignmentPreference()).toBe("start");

    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    };
    expect(readEditorContentAlignmentPreference()).toBe("start");
  });
});

describe("custom notebook sorting", () => {
  test("persists the custom sort mode", () => {
    const values = installLocalStorage();
    writeNotebookSortPreference("custom");
    expect(values.get(NOTEBOOK_SORT_STORAGE_KEY)).toBe("custom");
    expect(readNotebookSortPreference()).toBe("custom");
  });

  test("orders notebooks by persisted sort order with a stable name fallback", () => {
    const compare = getNotebookSortComparator("custom");
    const base = {
      parentId: null,
      slug: null,
      icon: null,
      color: null,
      memoCount: 0,
      lastMemoUpdatedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const notebooks = [
      { ...base, id: "third", name: "C", sortOrder: 30 },
      { ...base, id: "second", name: "B", sortOrder: 20 },
      { ...base, id: "first", name: "A", sortOrder: 20 },
    ];

    expect(notebooks.sort(compare).map((item) => item.id)).toEqual(["first", "second", "third"]);
  });
});

describe("notebook tree collapsed preference", () => {
  test("round-trips the user's collapsed notebook branches", () => {
    const values = installLocalStorage();

    writeNotebookTreeCollapsedIdsPreference(["notebook-2", "notebook-1", "notebook-2"]);

    expect(values.get(NOTEBOOK_TREE_COLLAPSED_IDS_STORAGE_KEY)).toBe('["notebook-2","notebook-1"]');
    expect(readNotebookTreeCollapsedIdsPreference()).toEqual(new Set(["notebook-2", "notebook-1"]));
  });

  test("ignores malformed and invalid stored values", () => {
    const values = installLocalStorage();

    values.set(NOTEBOOK_TREE_COLLAPSED_IDS_STORAGE_KEY, "{");
    expect(readNotebookTreeCollapsedIdsPreference()).toEqual(new Set());

    values.set(NOTEBOOK_TREE_COLLAPSED_IDS_STORAGE_KEY, JSON.stringify(["notebook-1", "", null, 2]));
    expect(readNotebookTreeCollapsedIdsPreference()).toEqual(new Set(["notebook-1"]));
  });

  test("falls back to expanded when local storage is unavailable", () => {
    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    };

    expect(readNotebookTreeCollapsedIdsPreference()).toEqual(new Set());
    expect(() => writeNotebookTreeCollapsedIdsPreference(["notebook-1"])).not.toThrow();
  });

  test("remembers whether the notebook section itself is collapsed", () => {
    const values = installLocalStorage();

    expect(readNotebookSectionCollapsedPreference()).toBe(false);

    writeNotebookSectionCollapsedPreference(true);
    expect(values.get(NOTEBOOK_SECTION_COLLAPSED_STORAGE_KEY)).toBe("true");
    expect(readNotebookSectionCollapsedPreference()).toBe(true);

    writeNotebookSectionCollapsedPreference(false);
    expect(readNotebookSectionCollapsedPreference()).toBe(false);
  });
});

describe("workspace shortcut preferences", () => {
  test("provides navigation, AI, save, reading protection, and editor mode defaults", () => {
    expect(DEFAULT_SHORTCUT_SETTINGS.focusGlobalSearch).toEqual({
      key: "f",
      ctrlOrMeta: true,
      shift: true,
      alt: false,
    });
    expect(DEFAULT_SHORTCUT_SETTINGS.openQuickSwitcher).toEqual({
      key: "o",
      ctrlOrMeta: true,
      shift: false,
      alt: false,
    });
    expect(DEFAULT_SHORTCUT_SETTINGS.openPreviousMemo.key).toBe("[");
    expect(DEFAULT_SHORTCUT_SETTINGS.openNextMemo.key).toBe("]");
    expect(DEFAULT_SHORTCUT_SETTINGS.openAiAssistant).toEqual({
      key: "j",
      ctrlOrMeta: true,
      shift: false,
      alt: false,
    });
    expect(DEFAULT_SHORTCUT_SETTINGS.saveAndSync).toEqual({
      key: "s",
      ctrlOrMeta: true,
      shift: false,
      alt: false,
    });
    expect(DEFAULT_SHORTCUT_SETTINGS.toggleEditorMode).toEqual({
      key: "/",
      ctrlOrMeta: true,
      shift: false,
      alt: false,
    });
    expect(DEFAULT_SHORTCUT_SETTINGS.toggleReadingProtection).toEqual({
      key: "e",
      ctrlOrMeta: true,
      shift: false,
      alt: false,
    });
    expect(DEFAULT_SHORTCUT_SETTINGS.toggleOutline).toEqual({
      key: "1",
      ctrlOrMeta: true,
      shift: true,
      alt: false,
    });
    expect(DEFAULT_SHORTCUT_SETTINGS.toggleSidebar).toEqual({
      key: "\\",
      ctrlOrMeta: true,
      shift: false,
      alt: false,
    });
  });

  test("migrates the unreleased reading protection shortcut without replacing custom bindings", () => {
    const values = installLocalStorage();
    values.set(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify({
      toggleReadingProtection: { key: "l", ctrlOrMeta: true, shift: true, alt: false },
    }));
    expect(readShortcutSettingsPreference().toggleReadingProtection).toEqual(
      DEFAULT_SHORTCUT_SETTINGS.toggleReadingProtection,
    );

    values.set(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify({
      toggleReadingProtection: { key: "r", ctrlOrMeta: true, shift: true, alt: false },
    }));
    expect(readShortcutSettingsPreference().toggleReadingProtection).toEqual({
      key: "r",
      ctrlOrMeta: true,
      shift: true,
      alt: false,
    });
  });

  test("fills new shortcut actions into legacy stored settings", () => {
    const values = installLocalStorage();
    values.set(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify({
      createMemo: { key: "m", ctrlOrMeta: true, shift: false, alt: false },
    }));

    const settings = readShortcutSettingsPreference();
    expect(settings.createMemo.key).toBe("m");
    expect(settings.openAiAssistant).toEqual(DEFAULT_SHORTCUT_SETTINGS.openAiAssistant);
    expect(settings.focusGlobalSearch).toEqual(DEFAULT_SHORTCUT_SETTINGS.focusGlobalSearch);
    expect(settings.openQuickSwitcher).toEqual(DEFAULT_SHORTCUT_SETTINGS.openQuickSwitcher);
    expect(settings.openPreviousMemo).toEqual(DEFAULT_SHORTCUT_SETTINGS.openPreviousMemo);
    expect(settings.openNextMemo).toEqual(DEFAULT_SHORTCUT_SETTINGS.openNextMemo);
    expect(settings.saveAndSync).toEqual(DEFAULT_SHORTCUT_SETTINGS.saveAndSync);
    expect(settings.toggleReadingProtection).toEqual(DEFAULT_SHORTCUT_SETTINGS.toggleReadingProtection);
    expect(settings.toggleEditorMode).toEqual(DEFAULT_SHORTCUT_SETTINGS.toggleEditorMode);
    expect(settings.toggleOutline).toEqual(DEFAULT_SHORTCUT_SETTINGS.toggleOutline);
  });

  test("uses Control for default shortcuts on Windows and Linux", () => {
    const keyboardEvent = (key, modifiers = {}) => ({
      key,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...modifiers,
    });

    expect(getShortcutActionForEvent(
      keyboardEvent("f", { ctrlKey: true, shiftKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "Win32",
    )).toBe("focusGlobalSearch");
    expect(getShortcutActionForEvent(
      keyboardEvent("o", { ctrlKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "Linux",
    )).toBe("openQuickSwitcher");
    expect(getShortcutActionForEvent(
      keyboardEvent("]", { ctrlKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "Win32",
    )).toBe("openNextMemo");
    expect(getShortcutActionForEvent(
      keyboardEvent("s", { ctrlKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "Win32",
    )).toBe("saveAndSync");
    expect(getShortcutActionForEvent(
      keyboardEvent("e", { ctrlKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "Win32",
    )).toBe("toggleReadingProtection");
    expect(getShortcutActionForEvent(
      keyboardEvent("!", { code: "Digit1", ctrlKey: true, shiftKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "Win32",
    )).toBe("toggleOutline");
    expect(getShortcutActionForEvent(
      keyboardEvent("f", { metaKey: true, shiftKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "Win32",
    )).toBeNull();
    expect(formatShortcutBinding(DEFAULT_SHORTCUT_SETTINGS.focusSearch, "Win32")).toBe("Ctrl + F");
  });

  test("keeps Command defaults on macOS and leaves Control for text movement", () => {
    const keyboardEvent = (key, modifiers = {}) => ({
      key,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...modifiers,
    });
    const mac = "MacIntel";

    expect(getShortcutActionForEvent(
      keyboardEvent("f", { metaKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      mac,
    )).toBe("focusSearch");
    expect(getShortcutActionForEvent(
      keyboardEvent("n", { metaKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      mac,
    )).toBe("createMemo");
    expect(getShortcutActionForEvent(
      keyboardEvent("f", { metaKey: true, shiftKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      mac,
    )).toBe("focusGlobalSearch");
    expect(getShortcutActionForEvent(
      keyboardEvent("[", { metaKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      mac,
    )).toBe("openPreviousMemo");
    expect(getShortcutActionForEvent(
      keyboardEvent("j", { metaKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      mac,
    )).toBe("openAiAssistant");
    expect(getShortcutActionForEvent(
      keyboardEvent("/", { metaKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      mac,
    )).toBe("toggleEditorMode");
    expect(getShortcutActionForEvent(
      keyboardEvent("\\", { metaKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      mac,
    )).toBe("toggleSidebar");

    for (const key of ["f", "n", "e", "h", "o"]) {
      expect(getShortcutActionForEvent(
        keyboardEvent(key, { ctrlKey: true }),
        DEFAULT_SHORTCUT_SETTINGS,
        mac,
      )).toBeNull();
    }
    expect(getShortcutActionForEvent(
      keyboardEvent("f", { ctrlKey: true, metaKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      mac,
    )).toBeNull();
    expect(formatShortcutBinding(DEFAULT_SHORTCUT_SETTINGS.focusSearch, mac)).toBe("⌘F");
    expect(formatShortcutBinding(DEFAULT_SHORTCUT_SETTINGS.createMemo, mac)).toBe("⌘N");
  });

  test("records Command and Control separately and keeps an older combined shortcut on the displayed key", () => {
    const keyboardEvent = (key, modifiers = {}) => ({
      key,
      code: "KeyF",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...modifiers,
    });

    expect(shortcutBindingFromKeyboardEvent(
      keyboardEvent("f", { metaKey: true, altKey: true }),
      "MacIntel",
    )).toEqual({
      key: "f",
      ctrlOrMeta: true,
      ctrl: false,
      meta: true,
      shift: false,
      alt: true,
    });
    expect(shortcutBindingFromKeyboardEvent(
      keyboardEvent("f", { ctrlKey: true, altKey: true }),
      "MacIntel",
    )).toEqual({
      key: "f",
      ctrlOrMeta: false,
      ctrl: true,
      meta: false,
      shift: false,
      alt: true,
    });
    expect(formatShortcutBinding({
      key: "f",
      ctrlOrMeta: false,
      ctrl: true,
      meta: false,
      shift: false,
      alt: true,
    }, "MacIntel")).toBe("⌃⌥F");

    const recordedSearch = shortcutBindingFromKeyboardEvent(
      keyboardEvent("f", { metaKey: true, altKey: true }),
      "MacIntel",
    );
    expect(getShortcutActionForEvent(
      keyboardEvent("f", { metaKey: true, altKey: true }),
      { ...DEFAULT_SHORTCUT_SETTINGS, focusSearch: recordedSearch },
      "MacIntel",
    )).toBe("focusSearch");
    expect(getShortcutActionForEvent(
      keyboardEvent("f", { ctrlKey: true, altKey: true }),
      { ...DEFAULT_SHORTCUT_SETTINGS, focusSearch: recordedSearch },
      "MacIntel",
    )).toBeNull();
    expect(shortcutBindingsEqual(DEFAULT_SHORTCUT_SETTINGS.focusSearch, {
      key: "f",
      ctrlOrMeta: true,
      ctrl: false,
      meta: true,
      shift: false,
      alt: false,
    }, "MacIntel")).toBe(true);
    expect(shortcutBindingsEqual(DEFAULT_SHORTCUT_SETTINGS.focusSearch, {
      key: "f",
      ctrlOrMeta: false,
      ctrl: true,
      meta: false,
      shift: false,
      alt: false,
    }, "MacIntel")).toBe(false);

    const values = installLocalStorage();
    values.set(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify({
      focusSearch: { key: "f", ctrlOrMeta: true, shift: false, alt: true },
    }));
    const settings = readShortcutSettingsPreference();
    expect(getShortcutActionForEvent(
      keyboardEvent("f", { metaKey: true, altKey: true }),
      settings,
      "MacIntel",
    )).toBe("focusSearch");
    expect(getShortcutActionForEvent(
      keyboardEvent("f", { ctrlKey: true, altKey: true }),
      settings,
      "MacIntel",
    )).toBeNull();
    expect(getShortcutActionForEvent(
      keyboardEvent("f", { ctrlKey: true, altKey: true }),
      settings,
      "Win32",
    )).toBe("focusSearch");
    expect(getShortcutActionForEvent(
      keyboardEvent("f", { metaKey: true, altKey: true }),
      settings,
      "Win32",
    )).toBeNull();
    expect(isPrimaryModifierPressed({ ctrlKey: true }, "MacIntel")).toBe(false);
    expect(isPrimaryModifierPressed({ metaKey: true }, "MacIntel")).toBe(true);
    expect(isPrimaryModifierPressed({ ctrlKey: true }, "Win32")).toBe(true);
    expect(isPrimaryModifierPressed({ ctrlKey: true, metaKey: true }, "Win32")).toBe(false);
  });

  test("toggles the sidebar only when it is visible", () => {
    expect(canToggleNotebookSidebar({ isDesktop: true, focusModeActive: false })).toBe(true);
    // Focus Mode hides the sidebar, so the shortcut must not change its saved state.
    expect(canToggleNotebookSidebar({ isDesktop: true, focusModeActive: true })).toBe(false);
    expect(canToggleNotebookSidebar({ isDesktop: false, focusModeActive: false })).toBe(false);
    expect(canToggleNotebookSidebar({ isDesktop: false, focusModeActive: true })).toBe(false);
    // The workspace checks the same flag that hides the sidebar in its layout.
    const workspaceSource = readFileSync(new URL("../components/WorkspaceApp.tsx", import.meta.url), "utf8");
    expect(workspaceSource).toContain("canToggleNotebookSidebar({ isDesktop, focusModeActive: desktopFocusModeActive })");
  });

  test("focuses the note title and body with Primary+Alt+T and Primary+Alt+B", () => {
    const keyboardEvent = (key, code, modifiers = {}) => ({
      key,
      code,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...modifiers,
    });

    expect(DEFAULT_SHORTCUT_SETTINGS.focusTitle).toEqual({ key: "t", ctrlOrMeta: true, shift: false, alt: true });
    expect(DEFAULT_SHORTCUT_SETTINGS.focusBody).toEqual({ key: "b", ctrlOrMeta: true, shift: false, alt: true });
    expect(formatShortcutBinding(DEFAULT_SHORTCUT_SETTINGS.focusTitle, "Win32")).toBe("Ctrl + Alt + T");
    expect(formatShortcutBinding(DEFAULT_SHORTCUT_SETTINGS.focusBody, "MacIntel")).toBe("⌘⌥B");

    expect(getShortcutActionForEvent(
      keyboardEvent("t", "KeyT", { ctrlKey: true, altKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "Win32",
    )).toBe("focusTitle");
    expect(getShortcutActionForEvent(
      keyboardEvent("b", "KeyB", { ctrlKey: true, altKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "Linux",
    )).toBe("focusBody");
    // macOS reports the Option character, not the letter, for ⌘⌥T and ⌘⌥B.
    expect(getShortcutActionForEvent(
      keyboardEvent("†", "KeyT", { metaKey: true, altKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "MacIntel",
    )).toBe("focusTitle");
    expect(getShortcutActionForEvent(
      keyboardEvent("∫", "KeyB", { metaKey: true, altKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "MacIntel",
    )).toBe("focusBody");
    // On Windows Ctrl+Alt is AltGr: a layout that types "{" there keeps typing it.
    expect(getShortcutActionForEvent(
      keyboardEvent("{", "KeyB", { ctrlKey: true, altKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "Win32",
    )).toBeNull();
    // Tiptap keeps Mod-Shift-B for blockquotes.
    expect(getShortcutActionForEvent(
      keyboardEvent("b", "KeyB", { ctrlKey: true, shiftKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
      "Win32",
    )).toBeNull();
  });

  test("adds Shift to the Linux title default because Ctrl+Alt+T opens a terminal there", () => {
    const keyboardEvent = (key, modifiers = {}) => ({ key, code: `Key${key.toUpperCase()}`, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers });
    const linux = getDefaultShortcutSettings("Linux x86_64");
    expect(linux.focusTitle).toEqual({ key: "t", ctrlOrMeta: true, shift: true, alt: true });
    expect(linux.focusBody).toEqual(DEFAULT_SHORTCUT_SETTINGS.focusBody);
    expect(formatShortcutBinding(linux.focusTitle, "Linux x86_64")).toBe("Ctrl + Alt + Shift + T");
    expect(getShortcutActionForEvent(keyboardEvent("T", { ctrlKey: true, altKey: true, shiftKey: true }), linux, "Linux x86_64")).toBe("focusTitle");
    expect(getShortcutActionForEvent(keyboardEvent("t", { ctrlKey: true, altKey: true }), linux, "Linux x86_64")).toBeNull();
    expect(getDefaultShortcutSettings("CrOS x86_64").focusTitle).toEqual(linux.focusTitle);
    for (const platform of ["Win32", "MacIntel", "Linux armv8l Android"]) {
      expect(getDefaultShortcutSettings(platform)).toEqual(DEFAULT_SHORTCUT_SETTINGS);
    }
  });

  test("reads Linux defaults for actions that were never customized", () => {
    const values = installLocalStorage();
    const platform = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { value: { platform: "Linux x86_64" }, configurable: true });
    try {
      expect(readShortcutSettingsPreference().focusTitle).toEqual(getDefaultShortcutSettings("Linux x86_64").focusTitle);
      values.set(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify({ createMemo: { key: "m", ctrlOrMeta: true, shift: false, alt: false } }));
      expect(readShortcutSettingsPreference().focusTitle).toEqual(getDefaultShortcutSettings("Linux x86_64").focusTitle);
    } finally {
      if (platform) Object.defineProperty(globalThis, "navigator", platform); else delete globalThis.navigator;
    }
  });

  test("adds the focus actions to legacy settings and lists them in Settings", () => {
    const values = installLocalStorage();
    values.set(SHORTCUT_SETTINGS_STORAGE_KEY, JSON.stringify({
      toggleSidebar: { key: "b", ctrlOrMeta: true, shift: false, alt: false },
    }));
    const settings = readShortcutSettingsPreference();
    expect(settings.focusTitle).toEqual(getDefaultShortcutSettings().focusTitle);
    expect(settings.focusBody).toEqual(DEFAULT_SHORTCUT_SETTINGS.focusBody);
    expect(getShortcutActionOptions((key) => key).map((option) => option.value)).toEqual(Object.keys(DEFAULT_SHORTCUT_SETTINGS));
  });

  test("routes the focus shortcuts to the note editor in both windows", () => {
    const workspaceSource = readFileSync(new URL("../components/WorkspaceApp.tsx", import.meta.url), "utf8");
    const noteWindowSource = readFileSync(new URL("../components/NoteWindowApp.tsx", import.meta.url), "utf8");
    const editorSource = readFileSync(new URL("../components/EditorPane.tsx", import.meta.url), "utf8");
    expect(workspaceSource).toContain("titleFocusToken={noteTitleFocusToken}");
    expect(workspaceSource).toContain("bodyFocusToken={noteBodyFocusToken}");
    expect(noteWindowSource).toContain("titleFocusToken={tokens.title}");
    expect(noteWindowSource).toContain("bodyFocusToken={tokens.body}");
    expect(editorSource).toContain("ref={titleInputRef}");
    expect(editorSource).toContain("markdownSourceEditorRef.current?.focus()");
  });
});

describe("selection move target", () => {
  test("keeps a valid user-chosen notebook instead of snapping back to the current notebook", () => {
    expect(resolveSelectionMoveTargetNotebookId("target-2", ["inbox", "target-2"], "inbox")).toBe("target-2");
  });

  test("falls back to the current notebook only when the stored target is missing or invalid", () => {
    expect(resolveSelectionMoveTargetNotebookId("", ["inbox", "archive"], "inbox")).toBe("inbox");
    expect(resolveSelectionMoveTargetNotebookId("deleted", ["inbox", "archive"], "inbox")).toBe("inbox");
    expect(resolveSelectionMoveTargetNotebookId("", ["inbox", "archive"], null)).toBe("inbox");
  });

  test("moves only notes that are not already in the target notebook", () => {
    const memos = [
      { id: "memo-1", notebookId: "inbox" },
      { id: "memo-2", notebookId: "archive" },
      { id: "memo-3", notebookId: "inbox" },
    ];

    expect(getMemoIdsNeedingMove(memos, ["memo-1", "memo-2", "memo-3"], "archive")).toEqual(["memo-1", "memo-3"]);
    expect(getMemoIdsNeedingMove(memos, ["memo-2"], "archive")).toEqual([]);
    expect(getMemoIdsNeedingMove(memos, ["memo-1"], "")).toEqual([]);
  });
});

describe("editor heading block value", () => {
  test("parses heading-1 through heading-6 and rejects other values", () => {
    expect(parseHeadingBlockValue("heading-1")).toBe(1);
    expect(parseHeadingBlockValue("heading-6")).toBe(6);
    expect(parseHeadingBlockValue("heading-7")).toBe(null);
    expect(parseHeadingBlockValue("paragraph")).toBe(null);
  });

  test("reports the active heading level including 4 through 6", () => {
    const editor = {
      isDestroyed: false,
      extensionManager: {},
      isActive: (name, attrs) => name === "heading" && attrs.level === 5,
    };

    expect(getActiveBlockValue(editor)).toBe("heading-5");
    expect(getActiveBlockValue({
      isDestroyed: false,
      extensionManager: {},
      isActive: (name, attrs) => name === "heading" && attrs.level === 3,
    })).toBe("heading-3");
    expect(getActiveBlockValue({
      isDestroyed: false,
      extensionManager: {},
      isActive: () => false,
    })).toBe("paragraph");
  });
});

const notebookBase = {
  parentId: null,
  slug: null,
  icon: null,
  color: null,
  memoCount: 0,
  sortOrder: 0,
  lastMemoUpdatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const makeNotebook = (id, overrides = {}) => ({ ...notebookBase, id, name: id, ...overrides });

const memoBase = {
  title: "",
  notebookId: "inbox",
  tags: [],
  isPinned: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const makeMemo = (id, overrides = {}) => ({ ...memoBase, id, ...overrides });

const translate = (key) => `t:${key}`;

const installThrowingLocalStorage = () => {
  globalThis.window = {
    localStorage: {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    },
  };
};

// A small notebook tree: work > (projects > alpha), work > beta, personal.
const notebookTreeFixture = () => buildNotebookTree([
  makeNotebook("work", { name: "Work", sortOrder: 1 }),
  makeNotebook("projects", { name: "Projects", parentId: "work", sortOrder: 1 }),
  makeNotebook("alpha", { name: "Alpha", parentId: "projects", sortOrder: 1 }),
  makeNotebook("beta", { name: "Beta", parentId: "work", sortOrder: 2 }),
  makeNotebook("personal", { name: "Personal", sortOrder: 2 }),
]);

describe("memo titles", () => {
  test("treats the default title as empty for editing", () => {
    expect(isDefaultMemoTitle(DEFAULT_MEMO_TITLE)).toBe(true);
    expect(isDefaultMemoTitle(`  ${DEFAULT_MEMO_TITLE}  `)).toBe(true);
    expect(isDefaultMemoTitle("Plan")).toBe(false);
    expect(isDefaultMemoTitle(null)).toBe(false);

    expect(getEditableMemoTitle(DEFAULT_MEMO_TITLE)).toBe("");
    expect(getEditableMemoTitle("  Plan  ")).toBe("Plan");
    expect(getEditableMemoTitle(undefined)).toBe("");
  });

  test("falls back to the default title for blank titles", () => {
    expect(getMemoTitle("  Plan ")).toBe("Plan");
    expect(getMemoTitle("   ")).toBe(DEFAULT_MEMO_TITLE);
    expect(getMemoTitle(null)).toBe(DEFAULT_MEMO_TITLE);
  });

  test("builds heading block values", () => {
    expect(EDITOR_HEADING_LEVELS.map(headingBlockValue)).toEqual([
      "heading-1", "heading-2", "heading-3", "heading-4", "heading-5", "heading-6",
    ]);
  });
});

describe("active block value without a usable editor", () => {
  test("reports a paragraph for missing, destroyed or uninitialised editors", () => {
    expect(getActiveBlockValue(null)).toBe("paragraph");
    expect(getActiveBlockValue({ isDestroyed: true, extensionManager: {}, isActive: () => true })).toBe("paragraph");
    expect(getActiveBlockValue({ isDestroyed: false, isActive: () => true })).toBe("paragraph");
  });

  test("reports a paragraph when the editor throws while reading state", () => {
    expect(getActiveBlockValue({
      isDestroyed: false,
      extensionManager: {},
      isActive: () => {
        throw new Error("view detached");
      },
    })).toBe("paragraph");
  });
});

describe("translated option lists", () => {
  test("lists memo sort, notebook sort and memo filter options in order", () => {
    expect(getMemoSortOptions(translate)).toEqual([
      { value: "updated-desc", label: "t:options.memoSort.updatedDesc" },
      { value: "created-desc", label: "t:options.memoSort.createdDesc" },
      { value: "title-asc", label: "t:options.memoSort.titleAsc" },
      { value: "title-desc", label: "t:options.memoSort.titleDesc" },
    ]);
    expect(getNotebookSortOptions(translate).map((option) => option.value)).toEqual([
      "custom", "name-asc", "memo-count-desc", "updated-desc",
    ]);
    expect(getNotebookSortOptions(translate)[2].label).toBe("t:options.notebookSort.memoCountDesc");
    expect(getMemoFilterOptions(translate)).toEqual([
      { value: "all", label: "t:options.memoFilter.all" },
      { value: "pinned", label: "t:options.memoFilter.pinned" },
      { value: "tagged", label: "t:options.memoFilter.tagged" },
      { value: "untagged", label: "t:options.memoFilter.untagged" },
    ]);
  });
});

describe("image compression preference", () => {
  test("defaults to enabled and only disables on an explicit false", () => {
    const values = installLocalStorage();
    expect(readImageCompressionPreference()).toBe(true);

    writeImageCompressionPreference(false);
    expect(values.get(IMAGE_COMPRESSION_STORAGE_KEY)).toBe("false");
    expect(readImageCompressionPreference()).toBe(false);

    writeImageCompressionPreference(true);
    expect(values.get(IMAGE_COMPRESSION_STORAGE_KEY)).toBe("true");
    expect(readImageCompressionPreference()).toBe(true);
  });

  test("stays enabled when local storage is unavailable", () => {
    installThrowingLocalStorage();
    expect(readImageCompressionPreference()).toBe(true);
    expect(() => writeImageCompressionPreference(false)).not.toThrow();
  });
});

describe("memo list density preference", () => {
  test("accepts compact and falls back to preview for anything else", () => {
    const values = installLocalStorage();
    expect(readMemoListDensityPreference()).toBe("preview");

    writeMemoListDensityPreference("compact");
    expect(values.get(MEMO_LIST_DENSITY_STORAGE_KEY)).toBe("compact");
    expect(readMemoListDensityPreference()).toBe("compact");

    values.set(MEMO_LIST_DENSITY_STORAGE_KEY, "dense");
    expect(readMemoListDensityPreference()).toBe("preview");
  });

  test("falls back to preview when local storage is unavailable", () => {
    installThrowingLocalStorage();
    expect(readMemoListDensityPreference()).toBe("preview");
    expect(() => writeMemoListDensityPreference("compact")).not.toThrow();
  });
});

describe("memo sort preference", () => {
  test("round-trips supported sort modes and rejects unknown ones", () => {
    const values = installLocalStorage();
    expect(readMemoSortPreference()).toBe("updated-desc");

    writeMemoSortPreference("title-asc");
    expect(values.get(MEMO_SORT_STORAGE_KEY)).toBe("title-asc");
    expect(readMemoSortPreference()).toBe("title-asc");

    values.set(MEMO_SORT_STORAGE_KEY, "random");
    expect(readMemoSortPreference()).toBe("updated-desc");
  });

  test("falls back to the default when local storage is unavailable", () => {
    installThrowingLocalStorage();
    expect(readMemoSortPreference()).toBe("updated-desc");
    expect(() => writeMemoSortPreference("title-desc")).not.toThrow();
  });
});

describe("preferences when local storage is unavailable", () => {
  test("every reader returns its safe default and every writer stays silent", () => {
    installThrowingLocalStorage();

    expect(readNotebookSidebarCollapsedPreference()).toBe(false);
    expect(readNotebookSidebarWidthPreference()).toBe(DEFAULT_NOTEBOOK_SIDEBAR_WIDTH_PX);
    expect(readDesktopReadingProtectionPreference()).toBe(false);
    expect(readEditorOutlineCollapsedPreference()).toBe(true);
    expect(readEditorOutlineCollapsedPreference({ defaultCollapsed: false })).toBe(false);
    expect(readEditorContentAlignmentPreference()).toBe("start");
    expect(readEditorToolbarExpandedPreference()).toBe(false);
    expect(readEditorPhonePreviewPreference()).toBe(false);
    expect(readEditorPhonePreviewFollowPreference()).toBe(true);
    expect(readMemoListWidthPreference()).toBe(DEFAULT_MEMO_LIST_WIDTH_PX);
    expect(readNotebookSortPreference()).toBe("name-asc");
    expect(readNotebookTreeCollapsedIdsPreference()).toEqual(new Set());
    expect(readNotebookSectionCollapsedPreference()).toBe(false);

    expect(() => {
      writeNotebookSidebarCollapsedPreference(true);
      writeNotebookSidebarWidthPreference(300);
      writeDesktopReadingProtectionPreference(true);
      writeEditorOutlineCollapsedPreference(false);
      writeEditorContentAlignmentPreference("center");
      writeEditorToolbarExpandedPreference(true);
      writeEditorPhonePreviewPreference(true);
      writeEditorPhonePreviewFollowPreference(false);
      writeMemoListWidthPreference(400);
      writeNotebookSortPreference("custom");
      writeNotebookTreeCollapsedIdsPreference(["a"]);
      writeNotebookSectionCollapsedPreference(true);
      writeShortcutSettingsPreference(DEFAULT_SHORTCUT_SETTINGS);
    }).not.toThrow();
  });

  test("rejects a stored notebook sort mode that is not supported", () => {
    const values = installLocalStorage();
    values.set(NOTEBOOK_SORT_STORAGE_KEY, "random");
    expect(readNotebookSortPreference()).toBe("name-asc");
  });

  test("ignores a non-array collapsed notebook list", () => {
    const values = installLocalStorage();
    values.set(NOTEBOOK_TREE_COLLAPSED_IDS_STORAGE_KEY, JSON.stringify({ a: true }));
    expect(readNotebookTreeCollapsedIdsPreference()).toEqual(new Set());
  });

  test("ignores a non-numeric memo list width", () => {
    const values = installLocalStorage();
    values.set(MEMO_LIST_WIDTH_STORAGE_KEY, "wide");
    expect(readMemoListWidthPreference()).toBe(DEFAULT_MEMO_LIST_WIDTH_PX);
  });

  test("persists shortcut settings as JSON", () => {
    const values = installLocalStorage();
    writeShortcutSettingsPreference(DEFAULT_SHORTCUT_SETTINGS);
    expect(JSON.parse(values.get(SHORTCUT_SETTINGS_STORAGE_KEY))).toEqual(DEFAULT_SHORTCUT_SETTINGS);
  });

  test("falls back to default shortcuts when the stored value is not JSON", () => {
    const values = installLocalStorage();
    values.set(SHORTCUT_SETTINGS_STORAGE_KEY, "{not json");
    expect(readShortcutSettingsPreference()).toEqual(getDefaultShortcutSettings());
  });
});

describe("normalizeShortcutKey", () => {
  test("names the space bar and lowercases other keys", () => {
    expect(normalizeShortcutKey(" ")).toBe("space");
    expect(normalizeShortcutKey("K")).toBe("k");
    expect(normalizeShortcutKey("ArrowUp")).toBe("arrowup");
  });
});

describe("shortcut edge cases", () => {
  test("bindings without a primary modifier resolve to no modifiers on any platform", () => {
    const binding = { key: "k", ctrlOrMeta: false, shift: false, alt: true };
    expect(resolvedShortcutModifiers(binding, "MacIntel")).toEqual({ ctrl: false, meta: false });
    expect(resolvedShortcutModifiers(binding, "Win32")).toEqual({ ctrl: false, meta: false });
  });

  test("ignores bare modifier keys and unmodified key presses", () => {
    const event = { key: "Shift", code: "ShiftLeft", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true };
    expect(shortcutBindingFromKeyboardEvent(event, "Win32")).toBeNull();
    expect(shortcutBindingFromKeyboardEvent({ ...event, key: "k", code: "KeyK", ctrlKey: false }, "Win32")).toBeNull();
    expect(getShortcutActionForEvent({ ...event, key: "k", code: "KeyK", ctrlKey: false }, DEFAULT_SHORTCUT_SETTINGS, "Win32")).toBeNull();
  });
});

describe("notebook tree helpers", () => {
  test("returns expandable ancestors of a notebook, including itself when it has children", () => {
    const tree = notebookTreeFixture();
    expect(getNotebookAncestorIds(tree, "alpha")).toEqual(["work", "projects"]);
    expect(getNotebookAncestorIds(tree, "projects")).toEqual(["work", "projects"]);
    expect(getNotebookAncestorIds(tree, "personal")).toEqual([]);
    expect(getNotebookAncestorIds(tree, "missing")).toEqual([]);
  });

  test("lists every notebook that has children", () => {
    expect(getExpandableNotebookIds(notebookTreeFixture())).toEqual(["work", "projects"]);
    expect(getExpandableNotebookIds([])).toEqual([]);
  });

  test("detects whether a notebook is anywhere in the tree", () => {
    const tree = notebookTreeFixture();
    expect(notebookTreeContainsId(tree, "alpha")).toBe(true);
    expect(notebookTreeContainsId(tree, "personal")).toBe(true);
    expect(notebookTreeContainsId(tree, "missing")).toBe(false);
  });

  test("filters the tree to matches and keeps their ancestors", () => {
    const tree = notebookTreeFixture();
    expect(filterNotebookTree(tree, "   ")).toBe(tree);

    const filtered = filterNotebookTree(tree, "alp");
    const flatten = (nodes) => nodes.flatMap((node) => [node.id, ...flatten(node.children)]);
    expect(flatten(filtered)).toEqual(["work", "projects", "alpha"]);
    // Filtering does not mutate the original tree.
    expect(flatten(tree)).toEqual(["work", "projects", "alpha", "beta", "personal"]);

    expect(filterNotebookTree(tree, "zzz")).toEqual([]);
  });

  test("builds indented move options in tree order", () => {
    const options = getNotebookMoveOptions([
      makeNotebook("work", { name: "Work", slug: "work", sortOrder: 1 }),
      makeNotebook("projects", { name: "Projects", parentId: "work" }),
      makeNotebook("alpha", { name: "Alpha", parentId: "projects" }),
      makeNotebook("personal", { name: "Personal", sortOrder: 2 }),
    ]);
    expect(options).toEqual([
      { id: "work", name: "Work", selectLabel: "Work", slug: "work", depth: 0 },
      { id: "projects", name: "Projects", selectLabel: "  └ Projects", slug: null, depth: 1 },
      { id: "alpha", name: "Alpha", selectLabel: "    └ Alpha", slug: null, depth: 2 },
      { id: "personal", name: "Personal", selectLabel: "Personal", slug: null, depth: 0 },
    ]);
  });
});

describe("date and notebook comparators", () => {
  test("orders dates newest first and pushes invalid dates last", () => {
    expect(compareDateDesc("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z")).toBeGreaterThan(0);
    expect(compareDateDesc("2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBeLessThan(0);
    expect(compareDateDesc("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(0);
    expect(compareDateDesc("invalid", "2026-01-01T00:00:00.000Z")).toBe(1);
    expect(compareDateDesc("2026-01-01T00:00:00.000Z", "invalid")).toBe(-1);
    expect(compareDateDesc("invalid", "also invalid")).toBe(0);
  });

  test("sorts notebooks by name with numeric awareness", () => {
    const notebooks = [
      makeNotebook("n10", { name: "Note 10" }),
      makeNotebook("n2", { name: "Note 2" }),
      makeNotebook("a", { name: "apple" }),
    ];
    expect([...notebooks].sort(getNotebookSortComparator("name-asc")).map((item) => item.id)).toEqual(["a", "n2", "n10"]);
  });

  test("sorts notebooks by memo count, then name", () => {
    const notebooks = [
      makeNotebook("b", { name: "B", memoCount: 2 }),
      makeNotebook("a", { name: "A", memoCount: 2 }),
      makeNotebook("c", { name: "C", memoCount: 9 }),
    ];
    expect([...notebooks].sort(getNotebookSortComparator("memo-count-desc")).map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  test("sorts notebooks by latest memo activity, falling back to notebook updates and name", () => {
    const notebooks = [
      makeNotebook("old", { name: "Old", updatedAt: "2026-01-01T00:00:00.000Z" }),
      makeNotebook("recent-memo", { name: "Z", lastMemoUpdatedAt: "2026-03-01T00:00:00.000Z" }),
      makeNotebook("tie-b", { name: "B", updatedAt: "2026-02-01T00:00:00.000Z" }),
      makeNotebook("tie-a", { name: "A", updatedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect([...notebooks].sort(getNotebookSortComparator("updated-desc")).map((item) => item.id)).toEqual([
      "recent-memo", "tie-a", "tie-b", "old",
    ]);
  });
});

describe("memo sorting and filtering", () => {
  const memos = [
    makeMemo("b", { title: "Beta", updatedAt: "2026-01-03T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" }),
    makeMemo("a", { title: "alpha", updatedAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-03T00:00:00.000Z", tags: ["x"] }),
    makeMemo("pinned", { title: "Zulu", isPinned: true, updatedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z" }),
    makeMemo("a2", { title: "Alpha", updatedAt: "2026-01-04T00:00:00.000Z", createdAt: "2026-01-04T00:00:00.000Z" }),
  ];
  const ids = (items) => items.map((memo) => memo.id);

  test("keeps pinned memos first and orders the rest by last update", () => {
    expect(ids(sortMemos(memos, "updated-desc"))).toEqual(["pinned", "a2", "b", "a"]);
    expect(ids(sortMemos(memos, "updated-desc", false))).toEqual(["a2", "b", "a", "pinned"]);
  });

  test("orders by creation date", () => {
    expect(ids(sortMemos(memos, "created-desc", false))).toEqual(["a2", "a", "pinned", "b"]);
  });

  test("orders by title case-insensitively with newest first among equal titles", () => {
    expect(ids(sortMemos(memos, "title-asc", false))).toEqual(["a2", "a", "b", "pinned"]);
    expect(ids(sortMemos(memos, "title-desc", false))).toEqual(["pinned", "b", "a2", "a"]);
  });

  test("does not mutate the input list", () => {
    const before = ids(memos);
    sortMemos(memos, "title-asc");
    expect(ids(memos)).toEqual(before);
  });

  test("filters by tags and pins", () => {
    expect(ids(filterMemos(memos, "tagged"))).toEqual(["a"]);
    expect(ids(filterMemos(memos, "untagged"))).toEqual(["b", "pinned", "a2"]);
    expect(ids(filterMemos(memos, "pinned"))).toEqual(["pinned"]);
    expect(filterMemos(memos, "all")).toBe(memos);
  });
});

describe("drag and drop helpers", () => {
  const dataTransfer = (data) => ({
    types: Object.keys(data),
    getData: (type) => data[type] ?? "",
  });

  test("recognises EdgeEver drag payloads", () => {
    const memoDrag = dataTransfer({ [MEMO_DRAG_MIME]: "[]" });
    const notebookDrag = dataTransfer({ [NOTEBOOK_DRAG_MIME]: "nb" });
    const fileDrag = dataTransfer({ Files: "" });

    expect(hasMemoDragData(memoDrag)).toBe(true);
    expect(hasNotebookDragData(memoDrag)).toBe(false);
    expect(hasNotebookDragData(notebookDrag)).toBe(true);
    expect(hasEdgeEverDragData(memoDrag)).toBe(true);
    expect(hasEdgeEverDragData(notebookDrag)).toBe(true);
    expect(hasEdgeEverDragData(fileDrag)).toBe(false);
  });

  test("reads only non-blank string memo ids from the drag payload", () => {
    expect(getMemoDragIds(dataTransfer({ [MEMO_DRAG_MIME]: JSON.stringify(["m1", "", "  ", 3, null, "m2"]) }))).toEqual(["m1", "m2"]);
    expect(getMemoDragIds(dataTransfer({ [MEMO_DRAG_MIME]: JSON.stringify({ id: "m1" }) }))).toEqual([]);
    expect(getMemoDragIds(dataTransfer({ [MEMO_DRAG_MIME]: "{broken" }))).toEqual([]);
    expect(getMemoDragIds(dataTransfer({ "text/plain": JSON.stringify(["m1"]) }))).toEqual([]);
  });

  test("splits a notebook row into before, inside and after drop zones", () => {
    const event = (clientY) => ({
      clientY,
      currentTarget: { getBoundingClientRect: () => ({ top: 100, height: 100 }) },
    });
    expect(getNotebookDropPosition(event(110))).toBe("before");
    expect(getNotebookDropPosition(event(130))).toBe("inside");
    expect(getNotebookDropPosition(event(150))).toBe("inside");
    expect(getNotebookDropPosition(event(170))).toBe("inside");
    expect(getNotebookDropPosition(event(190))).toBe("after");
  });

  test("computes a sort order between the neighbouring siblings", () => {
    const notebooks = [
      makeNotebook("a", { sortOrder: 1000 }),
      makeNotebook("b", { sortOrder: 2000 }),
      makeNotebook("c", { sortOrder: 4001 }),
      makeNotebook("child", { parentId: "a", sortOrder: 50 }),
    ];
    const [a, b, c, child] = notebooks;

    expect(getNotebookDropSortOrder(notebooks, b, "before")).toBe(1500);
    expect(getNotebookDropSortOrder(notebooks, b, "after")).toBe(3000);
    expect(getNotebookDropSortOrder(notebooks, c, "before")).toBe(3000);
    expect(getNotebookDropSortOrder(notebooks, a, "before")).toBe(0);
    expect(getNotebookDropSortOrder(notebooks, c, "after")).toBe(5001);
    // A lone child has no siblings to fit between.
    expect(getNotebookDropSortOrder(notebooks, child, "before")).toBe(-950);
    expect(getNotebookDropSortOrder(notebooks, child, "after")).toBe(1050);
  });

  test("appends after the last sibling when the target is not among the siblings", () => {
    const notebooks = [makeNotebook("a", { sortOrder: 10 }), makeNotebook("b", { sortOrder: 20 })];
    const stranger = makeNotebook("x", { sortOrder: 0 });
    expect(getNotebookDropSortOrder(notebooks, stranger, "before")).toBe(1020);
  });

  test("offsets from the target itself when it has no siblings at all", () => {
    const orphan = makeNotebook("orphan", { parentId: "gone", sortOrder: 500 });
    expect(getNotebookDropSortOrder([], orphan, "before")).toBe(-500);
    expect(getNotebookDropSortOrder([], orphan, "after")).toBe(1500);
  });
});

describe("DOM helpers", () => {
  // linkedom's window forwards writes to globalThis, so the fake setTimeout
  // below replaces the real one; restore it after every test.
  const domKeys = ["window", "document", "HTMLElement", "setTimeout"];
  let saved;
  const restore = () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };

  beforeAll(() => {
    saved = new Map(domKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  });

  afterEach(restore);
  afterAll(restore);

  const installDom = (html = "") => {
    const dom = parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`);
    const timers = [];
    dom.setTimeout = (callback) => {
      timers.push(callback);
      return timers.length;
    };
    globalThis.window = dom;
    globalThis.document = dom.document;
    globalThis.HTMLElement = dom.HTMLElement;
    return { document: dom.document, timers };
  };

  test("recognises text entry targets", () => {
    const { document: doc } = installDom(`
      <input id="input"><textarea id="textarea"></textarea><select id="select"></select>
      <div contenteditable="true"><span id="editable-child"></span></div>
      <div role="textbox" id="textbox"></div>
      <div class="ProseMirror"><p id="prose"></p></div>
      <button id="button"></button>
    `);
    for (const id of ["input", "textarea", "select", "editable-child", "textbox", "prose"]) {
      expect(isTextEntryTarget(doc.getElementById(id))).toBe(true);
    }
    expect(isTextEntryTarget(doc.getElementById("button"))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget({ closest: () => true })).toBe(false);
  });

  test("moves focus between enabled notebook tree buttons", () => {
    const { document: doc } = installDom(`
      <div data-notebook-tree>
        <button data-notebook-tree-button id="b1"></button>
        <button data-notebook-tree-button id="b2" disabled></button>
        <button data-notebook-tree-button id="b3"></button>
        <button data-notebook-tree-button id="b4"></button>
      </div>
      <button data-notebook-tree-button id="outside"></button>
    `);
    const calls = [];
    for (const button of doc.querySelectorAll("button")) {
      button.focus = (options) => calls.push({ focus: button.id, options });
      button.scrollIntoView = (options) => calls.push({ scroll: button.id, options });
    }
    const button = (id) => doc.getElementById(id);

    focusNotebookTreeButton(button("b1"), "next");
    expect(calls).toEqual([
      { focus: "b3", options: { preventScroll: true } },
      { scroll: "b3", options: { block: "nearest" } },
    ]);

    calls.length = 0;
    focusNotebookTreeButton(button("b3"), "previous");
    focusNotebookTreeButton(button("b1"), "last");
    focusNotebookTreeButton(button("b4"), "first");
    expect(calls.filter((call) => call.focus).map((call) => call.focus)).toEqual(["b1", "b4", "b1"]);

    calls.length = 0;
    // Already at the edge, a disabled current button, or a button outside a tree.
    focusNotebookTreeButton(button("b4"), "next");
    focusNotebookTreeButton(button("b1"), "previous");
    focusNotebookTreeButton(button("b1"), "first");
    focusNotebookTreeButton(button("b2"), "next");
    focusNotebookTreeButton(button("outside"), "next");
    expect(calls).toEqual([]);
  });

  test("builds a temporary drag preview with the label as text", () => {
    const { document: doc, timers } = installDom();
    const dragImages = [];
    const transfer = { setDragImage: (element, x, y) => dragImages.push({ element, x, y }) };

    setMemoDragPreview(transfer, '<img src=x onerror="alert(1)"> 2 notes');

    expect(dragImages).toHaveLength(1);
    const { element, x, y } = dragImages[0];
    expect({ x, y }).toEqual({ x: 16, y: 18 });
    expect(element.parentNode).toBe(doc.body);
    expect(element.querySelector("span").textContent).toBe('<img src=x onerror="alert(1)"> 2 notes');
    expect(element.querySelector("img")).toBeNull();
    expect(element.querySelector("svg")).not.toBeNull();
    expect(element.style.position).toBe("fixed");
    expect(element.style.pointerEvents).toBe("none");

    expect(timers).toHaveLength(1);
    timers[0]();
    expect(element.parentNode).toBeNull();
  });
});
