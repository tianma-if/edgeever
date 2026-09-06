import { afterEach, describe, expect, test } from "bun:test";
import { copyHtmlToClipboard, copyTextToClipboard } from "./clipboard.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

const restoreGlobal = (name, descriptor) => {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
};

afterEach(() => {
  restoreGlobal("window", originalWindow);
  restoreGlobal("navigator", originalNavigator);
  restoreGlobal("document", originalDocument);
});

describe("copyTextToClipboard", () => {
  test("uses the verified native clipboard bridge in the desktop app", async () => {
    const calls = [];
    globalThis.window = {
      edgeeverDesktop: {
        isAvailable: true,
        copyText: async (value) => {
          calls.push(value);
          return true;
        },
      },
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText: () => { throw new Error("browser clipboard should not be used"); } } },
    });

    await expect(copyTextToClipboard("https://example.com/share/token")).resolves.toBe(true);
    expect(calls).toEqual(["https://example.com/share/token"]);
  });

  test("does not report success when native clipboard verification fails", async () => {
    globalThis.window = {
      edgeeverDesktop: {
        isAvailable: true,
        copyText: async () => false,
      },
    };

    await expect(copyTextToClipboard("new value")).resolves.toBe(false);
  });

  test("keeps the browser clipboard path outside the desktop app", async () => {
    const calls = [];
    globalThis.window = {};
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText: async (value) => calls.push(value) } },
    });

    await expect(copyTextToClipboard("browser value")).resolves.toBe(true);
    expect(calls).toEqual(["browser value"]);
  });
});

describe("copyHtmlToClipboard", () => {
  test("uses the native rich clipboard bridge in the desktop app", async () => {
    const calls = [];
    globalThis.window = {
      edgeeverDesktop: {
        isAvailable: true,
        copyHtml: async (...values) => {
          calls.push(values);
          return true;
        },
      },
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { write: () => { throw new Error("browser clipboard should not be used"); } } },
    });

    await expect(copyHtmlToClipboard("<strong>Hello</strong>", "Hello")).resolves.toBeUndefined();
    expect(calls).toEqual([["<strong>Hello</strong>", "Hello"]]);
  });

  test("fails when native rich clipboard verification fails", async () => {
    globalThis.window = {
      edgeeverDesktop: {
        isAvailable: true,
        copyHtml: async () => false,
      },
    };

    await expect(copyHtmlToClipboard("<strong>Hello</strong>", "Hello")).rejects.toThrow(
      "Native rich clipboard verification failed",
    );
  });
});
