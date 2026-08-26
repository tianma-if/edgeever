import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_SHORTCUT_SETTINGS,
  DEFAULT_SYNC_INTERVAL_MS,
  DESKTOP_FOCUS_MODE_STORAGE_KEY,
  DESKTOP_READING_PROTECTION_STORAGE_KEY,
  EDITOR_CONTENT_ALIGNMENT_STORAGE_KEY,
  NOTEBOOK_SORT_STORAGE_KEY,
  SHORTCUT_SETTINGS_STORAGE_KEY,
  SYNC_INTERVAL_STORAGE_KEY,
  getSearchShortcutScope,
  getShortcutActionForEvent,
  getNotebookSortComparator,
  readEditorContentAlignmentPreference,
  readNotebookSortPreference,
  readSyncIntervalPreference,
  readDesktopFocusModePreference,
  readDesktopReadingProtectionPreference,
  readShortcutSettingsPreference,
  writeEditorContentAlignmentPreference,
  writeNotebookSortPreference,
  writeSyncIntervalPreference,
  writeDesktopFocusModePreference,
  writeDesktopReadingProtectionPreference,
} from "./app-helpers.ts";

const originalWindow = globalThis.window;

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
  globalThis.window = originalWindow;
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

describe("automatic sync interval preference", () => {
  test("defaults to 30 seconds", () => {
    installLocalStorage();
    expect(readSyncIntervalPreference()).toBe(DEFAULT_SYNC_INTERVAL_MS);
    expect(DEFAULT_SYNC_INTERVAL_MS).toBe(30_000);
  });

  test("reads and writes sync intervals", () => {
    const values = installLocalStorage();

    writeSyncIntervalPreference("30s");
    expect(values.get(SYNC_INTERVAL_STORAGE_KEY)).toBe("30s");
    expect(readSyncIntervalPreference()).toBe(30_000);

    writeSyncIntervalPreference("5m");
    expect(values.get(SYNC_INTERVAL_STORAGE_KEY)).toBe("5m");
    expect(readSyncIntervalPreference()).toBe(300_000);
  });

  test("preserves the legacy preference stored under the old key", () => {
    const values = installLocalStorage();
    values.set("edgeever.autoSaveInterval", "15m");
    expect(readSyncIntervalPreference()).toBe(900_000);
  });

  test("migrates the former one-minute default to 30 seconds", () => {
    const values = installLocalStorage();
    values.set(SYNC_INTERVAL_STORAGE_KEY, "1m");
    expect(readSyncIntervalPreference()).toBe(30_000);
  });

  test("falls back to the default for unknown or unavailable storage", () => {
    const values = installLocalStorage();
    values.set(SYNC_INTERVAL_STORAGE_KEY, "unexpected");
    expect(readSyncIntervalPreference()).toBe(30_000);

    globalThis.window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    };
    expect(readSyncIntervalPreference()).toBe(30_000);
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

  test("recognizes Ctrl and Command variants for the new actions", () => {
    const keyboardEvent = (key, modifiers = {}) => ({
      key,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...modifiers,
    });

    expect(getShortcutActionForEvent(
      keyboardEvent("f", { metaKey: true, shiftKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
    )).toBe("focusGlobalSearch");
    expect(getShortcutActionForEvent(
      keyboardEvent("o", { ctrlKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
    )).toBe("openQuickSwitcher");
    expect(getShortcutActionForEvent(
      keyboardEvent("[", { metaKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
    )).toBe("openPreviousMemo");
    expect(getShortcutActionForEvent(
      keyboardEvent("]", { ctrlKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
    )).toBe("openNextMemo");
    expect(getShortcutActionForEvent(
      keyboardEvent("j", { metaKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
    )).toBe("openAiAssistant");
    expect(getShortcutActionForEvent(
      keyboardEvent("s", { ctrlKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
    )).toBe("saveAndSync");
    expect(getShortcutActionForEvent(
      keyboardEvent("e", { ctrlKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
    )).toBe("toggleReadingProtection");
    expect(getShortcutActionForEvent(
      keyboardEvent("/", { metaKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
    )).toBe("toggleEditorMode");
    expect(getShortcutActionForEvent(
      keyboardEvent("!", { code: "Digit1", ctrlKey: true, shiftKey: true }),
      DEFAULT_SHORTCUT_SETTINGS,
    )).toBe("toggleOutline");
  });
});
