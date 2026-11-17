import { describe, expect, test } from "bun:test";
import { createAppWindowOpenHandler, isAllowedPrintPreviewUrl, isResourceDownloadUrl } from "./window-open-policy.mjs";

test("resource downloads require a safe resource ID and explicit download filename", () => {
  for (const url of ["edgeever-resource://resource/note?download=note.html", "edgeever-staged://pending?download=note.txt"]) {
    expect(isResourceDownloadUrl(url)).toBe(true);
  }
  for (const url of ["edgeever-resource://resource/note", "edgeever-staged://pending", "https://example.org/note?download=note.html", "edgeever-resource://user@resource/note?download=note.html", "edgeever-resource://resource/%2e%2e?download=note.html", "edgeever-staged://pending?download=%00"]) {
    expect(isResourceDownloadUrl(url)).toBe(false);
  }
});

describe("desktop window open policy", () => {
  test("dedicated print pages get the restricted preload while blank windows stay blocked", () => {
    const external = [];
    for (const appUrl of [
      "file:///Applications/EdgeEver.app/Contents/Resources/web/index.html",
      "http://127.0.0.1:5173/index.html",
      "edgeever-app://app/index.html?noteWindow=note-id",
    ]) {
      const handler = createAppWindowOpenHandler({
        getAppUrl: () => appUrl,
        printPreloadPath: "/app/preload/print.cjs",
        openExternal: (url) => external.push(url),
      });
      expect(handler({ url: new URL("note-print.html", appUrl).href })).toEqual({
        action: "allow",
        overrideBrowserWindowOptions: { webPreferences: {
          contextIsolation: true, nodeIntegration: false, sandbox: true, preload: "/app/preload/print.cjs",
        } },
      });
      expect(handler({ url: "about:blank" })).toEqual({ action: "deny" });
      expect(handler({ url: new URL("mobile-edit.html", appUrl).href })).toEqual({ action: "deny" });
    }
    expect(external).toEqual(["http://127.0.0.1:5173/mobile-edit.html"]);
  });

  test("allows only the packaged print preview beside the app entry", () => {
    const appUrl = "file:///Applications/EdgeEver.app/Contents/Resources/web/index.html";

    expect(isAllowedPrintPreviewUrl(
      "file:///Applications/EdgeEver.app/Contents/Resources/web/note-print.html?token=abc",
      appUrl,
    )).toBe(true);
    expect(isAllowedPrintPreviewUrl("file:///note-print.html?token=abc", appUrl)).toBe(false);
    expect(isAllowedPrintPreviewUrl(
      "file:///Applications/EdgeEver.app/Contents/Resources/web/mobile-edit.html",
      appUrl,
    )).toBe(false);
  });

  test("allows the same-origin print preview in desktop development", () => {
    const appUrl = "http://127.0.0.1:5173/";

    expect(isAllowedPrintPreviewUrl("http://127.0.0.1:5173/note-print.html?token=abc", appUrl)).toBe(true);
    expect(isAllowedPrintPreviewUrl("https://example.com/note-print.html", appUrl)).toBe(false);
    expect(isAllowedPrintPreviewUrl("http://127.0.0.1:5173/settings", appUrl)).toBe(false);
  });

  test("allows only the print preview on the private desktop origin", () => {
    const appUrl = "edgeever-app://app/index.html";

    expect(isAllowedPrintPreviewUrl("edgeever-app://app/note-print.html?token=abc", appUrl)).toBe(true);
    expect(isAllowedPrintPreviewUrl("edgeever-app://other/note-print.html", appUrl)).toBe(false);
    expect(isAllowedPrintPreviewUrl("edgeever-app://app/mobile-edit.html", appUrl)).toBe(false);
  });
});
