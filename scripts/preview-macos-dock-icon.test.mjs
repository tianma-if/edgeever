import { describe, expect, test } from "bun:test";
import {
  PREVIEW_APP_NAME,
  assertPreviewPlatform,
  createPreviewInfoPlist,
  previewSwiftSource,
} from "./preview-macos-dock-icon.mjs";

describe("macOS Dock icon preview", () => {
  test("creates a regular app bundle that declares the preview icon", () => {
    const plist = createPreviewInfoPlist("org.edgeever.logo-preview.test");
    expect(plist).toContain(`<string>${PREVIEW_APP_NAME}</string>`);
    expect(plist).toContain("<string>AppIcon</string>");
    expect(plist).toContain("<string>org.edgeever.logo-preview.test</string>");
    expect(plist).toContain("<key>LSUIElement</key>\n  <false/>");
  });

  test("keeps the Cocoa preview alive and sets its Dock icon", () => {
    expect(previewSwiftSource).toContain("NSApp.setActivationPolicy(.regular)");
    expect(previewSwiftSource).toContain("NSApp.applicationIconImage = icon");
    expect(previewSwiftSource).toContain("application.run()");
  });

  test("rejects unsupported platforms", () => {
    expect(() => assertPreviewPlatform("linux")).toThrow(/only available on macOS/i);
    expect(() => assertPreviewPlatform("darwin")).not.toThrow();
  });
});
