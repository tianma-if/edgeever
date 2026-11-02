import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
