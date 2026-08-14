import { afterEach, describe, expect, test } from "bun:test";
import {
  AI_STREAMING_STORAGE_KEY,
  readAiStreamingPreference,
  writeAiStreamingPreference,
} from "./ai-generation-preference.ts";

const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

const installLocalStorage = () => {
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
  };
  return values;
};

describe("AI streaming preference", () => {
  test("defaults to disabled and persists explicit changes", () => {
    const values = installLocalStorage();
    expect(readAiStreamingPreference()).toBe(false);

    writeAiStreamingPreference(true);
    expect(values.get(AI_STREAMING_STORAGE_KEY)).toBe("true");
    expect(readAiStreamingPreference()).toBe(true);

    writeAiStreamingPreference(false);
    expect(values.get(AI_STREAMING_STORAGE_KEY)).toBe("false");
    expect(readAiStreamingPreference()).toBe(false);
  });

  test("fails closed when local storage is unavailable", () => {
    globalThis.window = {
      localStorage: {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => { throw new Error("blocked"); },
      },
    };
    expect(readAiStreamingPreference()).toBe(false);
    expect(() => writeAiStreamingPreference(true)).not.toThrow();
  });
});
