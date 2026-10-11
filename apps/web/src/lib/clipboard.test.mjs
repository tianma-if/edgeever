import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { copyHtmlToClipboard, copyImageBlobToClipboard, copyImageUrlToClipboard, copyTextToClipboard } from "./clipboard.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalClipboardItem = Object.getOwnPropertyDescriptor(globalThis, "ClipboardItem");
const originalURL = Object.getOwnPropertyDescriptor(globalThis, "URL");
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");

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
  restoreGlobal("ClipboardItem", originalClipboardItem);
  restoreGlobal("URL", originalURL);
  restoreGlobal("fetch", originalFetch);
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

const installClipboardItem = () => {
  globalThis.ClipboardItem = class {
    constructor(data) {
      this.data = data;
    }
  };
};

describe("copyImageBlobToClipboard", () => {
  test("uses the native image clipboard bridge in the desktop app", async () => {
    const calls = [];
    const png = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    globalThis.window = {
      edgeeverDesktop: {
        isAvailable: true,
        copyImage: async (bytes) => {
          calls.push(bytes);
          return true;
        },
      },
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { write: () => { throw new Error("browser clipboard should not be used"); } } },
    });

    await expect(copyImageBlobToClipboard(png)).resolves.toBe(true);
    expect(calls).toEqual([new Uint8Array(await png.arrayBuffer())]);
  });

  test("does not report success when native image verification fails", async () => {
    globalThis.window = {
      edgeeverDesktop: {
        isAvailable: true,
        copyImage: async () => false,
      },
    };

    await expect(copyImageBlobToClipboard(new Blob([Uint8Array.from([1])], { type: "image/png" }))).resolves.toBe(false);
  });

  test("starts the browser image write during the click and converts jpeg inside the payload promise", async () => {
    const writes = [];
    const jpeg = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/jpeg" });
    const png = new Blob([Uint8Array.from([9])], { type: "image/png" });
    globalThis.window = {};
    installClipboardItem();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { write: async (items) => writes.push(items) } },
    });
    globalThis.document = {
      createElement: (tag) => {
        if (tag === "img") {
          const image = {
            naturalWidth: 1,
            naturalHeight: 1,
            set src(_value) {
              queueMicrotask(() => image.onload?.());
            },
          };
          return image;
        }
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage() {} }),
          toBlob: (callback) => callback(png),
        };
      },
    };
    globalThis.URL = {
      createObjectURL: () => "blob:image",
      revokeObjectURL() {},
    };

    const pending = copyImageBlobToClipboard(jpeg);
    expect(writes).toHaveLength(1);
    const payload = writes[0][0].data["image/png"];
    expect(payload).toBeInstanceOf(Promise);
    await expect(payload).resolves.toBe(png);
    await expect(pending).resolves.toBe(true);
  });

  test("starts the image-url write during the click, before the image response arrives", async () => {
    const writes = [];
    const jpeg = new Blob([Uint8Array.from([1, 2, 3])], { type: "image/jpeg" });
    const png = new Blob([Uint8Array.from([9])], { type: "image/png" });
    let resolveFetch = () => {};
    globalThis.window = {};
    installClipboardItem();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { write: async (items) => writes.push(items) } },
    });
    globalThis.fetch = () => new Promise((resolve) => {
      resolveFetch = () => resolve({ ok: true, blob: async () => jpeg });
    });
    globalThis.document = {
      createElement: (tag) => {
        if (tag === "img") {
          const image = {
            naturalWidth: 1,
            naturalHeight: 1,
            set src(_value) {
              queueMicrotask(() => image.onload?.());
            },
          };
          return image;
        }
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage() {} }),
          toBlob: (callback) => callback(png),
        };
      },
    };
    globalThis.URL = {
      createObjectURL: () => "blob:image",
      revokeObjectURL() {},
    };

    const pending = copyImageUrlToClipboard("/api/v1/resources/res_image/blob");
    expect(writes).toHaveLength(1);
    const payload = writes[0][0].data["image/png"];
    expect(payload).toBeInstanceOf(Promise);
    resolveFetch();
    await expect(payload).resolves.toBe(png);
    await expect(pending).resolves.toBe(true);
  });

  test("returns false when the browser refuses the image write", async () => {
    globalThis.window = {};
    installClipboardItem();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { write: async () => { throw new Error("NotAllowedError"); } } },
    });

    await expect(copyImageBlobToClipboard(new Blob([Uint8Array.from([1])], { type: "image/png" }))).resolves.toBe(false);
  });

  test("share image dialog surfaces the existing copy failure message", () => {
    const source = readFileSync(new URL("../components/dialogs/ShareNoteImageDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain('t("editor.imageShare.copyFailed")');
    expect(source).toContain('role="alert"');
  });
});
