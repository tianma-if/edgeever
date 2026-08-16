import { afterEach, describe, expect, test } from "bun:test";
import {
  AI_SELECTION_MENU_STORAGE_KEY,
  readAiSelectionMenuPreference,
  resolveStoredAiSelectionMenuPreference,
  writeAiSelectionMenuPreference,
} from "./ai-selection-menu-preference.ts";

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

describe("AI selection menu preference", () => {
  test("defaults to enabled unless explicitly disabled", () => {
    expect(resolveStoredAiSelectionMenuPreference(null)).toBe(true);
    expect(resolveStoredAiSelectionMenuPreference("unsupported")).toBe(true);
    expect(resolveStoredAiSelectionMenuPreference("true")).toBe(true);
    expect(resolveStoredAiSelectionMenuPreference("false")).toBe(false);
  });

  test("persists changes and notifies the current document", () => {
    const { events, values } = installWindow();
    expect(readAiSelectionMenuPreference()).toBe(true);

    writeAiSelectionMenuPreference(false);
    expect(values.get(AI_SELECTION_MENU_STORAGE_KEY)).toBe("false");
    expect(readAiSelectionMenuPreference()).toBe(false);
    expect(events.at(-1)?.detail).toBe(false);

    writeAiSelectionMenuPreference(true);
    expect(values.get(AI_SELECTION_MENU_STORAGE_KEY)).toBe("true");
    expect(readAiSelectionMenuPreference()).toBe(true);
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

    expect(readAiSelectionMenuPreference()).toBe(true);
    expect(() => writeAiSelectionMenuPreference(false)).not.toThrow();
    expect(events.at(-1)?.detail).toBe(false);
  });
});
