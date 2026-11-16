import { FONT_IDS, FONT_CATALOG } from "@edgeever/shared/font-catalog-data";
import { afterEach, describe, expect, test } from "bun:test";
import {
  UI_FONT_CUSTOM_STORAGE_KEY,
  UI_FONT_STORAGE_KEY,
  applyUiFontPreference,
  readUiFontPreference,
  writeUiFontPreference,
} from "./ui-font.ts";

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

describe("interface font preference", () => {
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
  });

  test("defaults to the system face and ignores unknown choices", () => {
    const values = installLocalStorage();
    expect(readUiFontPreference()).toEqual({ choice: "system", customFamily: "" });

    values.set(UI_FONT_STORAGE_KEY, "comic-sans");
    expect(readUiFontPreference().choice).toBe("system");
  });

  test("persists a bundled face and a custom family independently of note text", () => {
    const values = installLocalStorage();
    writeUiFontPreference({ choice: "wenkai", customFamily: "霞鹜文楷" });
    expect(values.get(UI_FONT_STORAGE_KEY)).toBe("wenkai");
    expect(values.get(UI_FONT_CUSTOM_STORAGE_KEY)).toBe("霞鹜文楷");
    expect(values.has("edgeever.editorBodyFont")).toBe(false);
    expect(readUiFontPreference()).toEqual({ choice: "wenkai", customFamily: "霞鹜文楷" });
  });

  test("restores every catalog face and keeps old UI choices readable", () => {
    const values = installLocalStorage();
    for (const choice of [...FONT_IDS, "wenkai-screen", "neo-zhi-song", "source-serif"]) {
      // Read values written by the previous selector using the existing storage key.
      values.set(UI_FONT_STORAGE_KEY, choice);
      expect(readUiFontPreference()).toEqual({ choice, customFamily: "" });
      writeUiFontPreference(readUiFontPreference());
      expect(readUiFontPreference().choice).toBe(choice);
    }
    expect(values.has("edgeever.editorBodyFont")).toBe(false);
  });

  test("applies a catalog face restored from storage only to the interface", () => {
    const values = installLocalStorage();
    values.set(UI_FONT_STORAGE_KEY, "inter");
    const style = new Map();
    globalThis.document = {
      documentElement: {
        dataset: {},
        style: {
          setProperty: (key, value) => style.set(key, value),
          removeProperty: (key) => style.delete(key),
        },
      },
    };
    applyUiFontPreference();
    expect(globalThis.document.documentElement.dataset.uiFont).toBe("inter");
    expect(style.get("--ui-font-family")).toContain(FONT_CATALOG.inter.family);
    expect(style.has("--editor-body-font-family")).toBe(false);
  });

  test("falls back when local storage is unavailable", () => {
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
    expect(readUiFontPreference()).toEqual({ choice: "system", customFamily: "" });
    expect(() => writeUiFontPreference({ choice: "source-han-sans", customFamily: "" })).not.toThrow();
  });

  test("publishes the resolved stack on the document and clears it for the system face", () => {
    installLocalStorage();
    const style = new Map();
    const dataset = {};
    globalThis.document = {
      documentElement: {
        dataset,
        style: {
          setProperty: (key, value) => style.set(key, value),
          removeProperty: (key) => style.delete(key),
        },
      },
    };

    applyUiFontPreference({ choice: "custom", customFamily: "Songti SC" });
    expect(dataset.uiFont).toBe("custom");
    expect(style.get("--ui-font-family")).toContain("Songti SC");
    expect(style.get("--ui-font-family")).toContain("PingFang SC");

    applyUiFontPreference({ choice: "custom", customFamily: "bad; family" });
    expect(dataset.uiFont).toBeUndefined();
    expect(style.has("--ui-font-family")).toBe(false);

    applyUiFontPreference({ choice: "system", customFamily: "" });
    expect(dataset.uiFont).toBeUndefined();
    expect(style.has("--ui-font-family")).toBe(false);
  });
});
