import { afterEach, describe, expect, test } from "bun:test";
import {
  AI_SPACE_SHORTCUT_STORAGE_KEY,
  readAiSpaceShortcutPreference,
  resolveStoredAiSpaceShortcutPreference,
  writeAiSpaceShortcutPreference,
} from "./ai-space-shortcut-preference.ts";

const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

const installWindow = () => {
  const values = new Map();
  const events = [];
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    dispatchEvent: (event) => {
      events.push(event);
      return true;
    },
  };
  return { events, values };
};

describe("AI Space shortcut preference", () => {
  test("defaults to enabled unless explicitly disabled", () => {
    expect(resolveStoredAiSpaceShortcutPreference(null)).toBe(true);
    expect(resolveStoredAiSpaceShortcutPreference("unsupported")).toBe(true);
    expect(resolveStoredAiSpaceShortcutPreference("true")).toBe(true);
    expect(resolveStoredAiSpaceShortcutPreference("false")).toBe(false);
  });

  test("persists changes and notifies the current document", () => {
    const { events, values } = installWindow();
    expect(readAiSpaceShortcutPreference()).toBe(true);

    writeAiSpaceShortcutPreference(false);
    expect(values.get(AI_SPACE_SHORTCUT_STORAGE_KEY)).toBe("false");
    expect(readAiSpaceShortcutPreference()).toBe(false);
    expect(events.at(-1)?.detail).toBe(false);

    writeAiSpaceShortcutPreference(true);
    expect(values.get(AI_SPACE_SHORTCUT_STORAGE_KEY)).toBe("true");
    expect(readAiSpaceShortcutPreference()).toBe(true);
    expect(events.at(-1)?.detail).toBe(true);
  });

  test("falls back to enabled when local storage is unavailable", () => {
    const events = [];
    globalThis.window = {
      localStorage: {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => { throw new Error("blocked"); },
      },
      dispatchEvent: (event) => {
        events.push(event);
        return true;
      },
    };

    expect(readAiSpaceShortcutPreference()).toBe(true);
    expect(() => writeAiSpaceShortcutPreference(false)).not.toThrow();
    expect(events.at(-1)?.detail).toBe(false);
  });
});
