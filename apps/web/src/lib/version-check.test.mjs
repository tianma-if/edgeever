import { describe, expect, test } from "bun:test";
import { findDesktopReleaseVersion, getReleaseTagForVersion, isVersionOutdated, resolveLocalizedReleaseChanges } from "./version-check";

describe("platform release version checks", () => {
  test("derives the installed desktop version from the DMG asset", () => {
    expect(findDesktopReleaseVersion([
      "EdgeEver-1.6.50-mac-arm64.dmg",
      "EdgeEver-1.6.50-mac-arm64.dmg.blockmap",
      "EdgeEver-1.6.50-mac-x64.dmg",
      "EdgeEver-1.6.50-mac-x64.dmg.blockmap",
      "edgeever-android-v1.6.49-arm64-v8a.apk",
    ])).toBe("1.6.50");
  });

  test("rejects missing or ambiguous desktop assets", () => {
    expect(findDesktopReleaseVersion([])).toBeNull();
    expect(findDesktopReleaseVersion([
      "EdgeEver-1.6.49-mac-arm64.dmg",
      "EdgeEver-1.6.50-mac-x64.dmg",
    ])).toBeNull();
    expect(findDesktopReleaseVersion([
      "EdgeEver-1.6.50-mac-arm64.dmg",
    ])).toBeNull();
  });

  test("compares semantic release components and ignores build metadata", () => {
    expect(isVersionOutdated("1.6.49+12", "1.6.50")).toBe(true);
    expect(isVersionOutdated("1.6.50+3", "1.6.50")).toBe(false);
    expect(isVersionOutdated("1.6.50-beta.2", "1.6.50-beta.10")).toBe(true);
    expect(isVersionOutdated("1.6.50-beta.10", "1.6.50")).toBe(true);
    expect(isVersionOutdated("1.6.50", "1.6.50-beta.10")).toBe(false);
  });

  test("maps deployed builds back to their formal release tag", () => {
    expect(getReleaseTagForVersion("1.34.1+18")).toBe("v1.34.1");
    expect(getReleaseTagForVersion("v1.35.0-beta.2+4")).toBe("v1.35.0-beta.2");
    expect(getReleaseTagForVersion("local")).toBeNull();
  });

  test("selects exact and related locales before falling back to English", () => {
    const changes = {
      "en-US": ["English"],
      "ja-JP": ["日本語"],
      "pt-BR": ["Português"],
      "zh-CN": ["中文"],
    };

    expect(resolveLocalizedReleaseChanges(changes, "ja-JP")).toEqual(["日本語"]);
    expect(resolveLocalizedReleaseChanges(changes, "pt_PT")).toEqual(["Português"]);
    expect(resolveLocalizedReleaseChanges(changes, "zh-Hans")).toEqual(["中文"]);
    expect(resolveLocalizedReleaseChanges(changes, "de-DE")).toEqual(["English"]);
  });

});
