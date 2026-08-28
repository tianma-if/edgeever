import { describe, expect, test } from "bun:test";
import {
  RENDERER_RECOVERY_STORAGE_KEY,
  clearRendererRecoveryRequired,
  isRendererRecoveryRequired,
  markRendererRecoveryRequired,
} from "./renderer-recovery.ts";

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

describe("renderer recovery marker", () => {
  test("persists recovery until the user leaves safe mode", () => {
    const storage = createStorage();

    expect(isRendererRecoveryRequired(storage)).toBe(false);
    markRendererRecoveryRequired(storage);
    expect(storage.getItem(RENDERER_RECOVERY_STORAGE_KEY)).toBe("1");
    expect(isRendererRecoveryRequired(storage)).toBe(true);

    clearRendererRecoveryRequired(storage);
    expect(isRendererRecoveryRequired(storage)).toBe(false);
  });

  test("never throws when browser storage is unavailable", () => {
    const unavailableStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    };

    expect(isRendererRecoveryRequired(unavailableStorage)).toBe(false);
    expect(() => markRendererRecoveryRequired(unavailableStorage)).not.toThrow();
    expect(() => clearRendererRecoveryRequired(unavailableStorage)).not.toThrow();
  });
});
