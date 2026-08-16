import { describe, expect, test } from "bun:test";
import { planNativeRelease } from "./plan-native-release.mjs";

describe("native release planning", () => {
  test("does not rebuild Android for root scripts, versions, or documentation", () => {
    expect(
      planNativeRelease("mobile", [
        "package.json",
        "AGENTS.md",
        "apps/web/src/app/App.tsx",
        "apps/desktop/package.json",
      ]),
    ).toEqual({ rebuild: false, relevantChanges: [] });
  });

  test("rebuilds Android for mobile, shared runtime, dependency, or build changes", () => {
    const changedFiles = [
      "apps/mobile/src/screens/LoginScreen.tsx",
      "packages/shared/src/index.ts",
      "bun.lock",
      "scripts/build-android-local.sh",
      "scripts/verify-android-apk-signature.mjs",
      ".github/workflows/mobile-build.yml",
      ".github/workflows/store-delivery.yml",
      "scripts/download-play-universal-apk.mjs",
    ];
    expect(planNativeRelease("mobile", changedFiles)).toEqual({
      rebuild: true,
      relevantChanges: changedFiles,
    });
  });

  test("rebuilds desktop for its embedded Web renderer and shared runtime", () => {
    const changedFiles = [
      "apps/web/src/app/App.tsx",
      "apps/desktop/src/main/index.mjs",
      "packages/shared/src/index.ts",
    ];
    expect(planNativeRelease("desktop", changedFiles)).toEqual({
      rebuild: true,
      relevantChanges: changedFiles,
    });
  });

  test("rebuilds desktop when its architecture packaging pipeline changes", () => {
    const changedFiles = [
      ".github/workflows/desktop-build.yml",
      "scripts/create-mac-update-metadata.mjs",
      "scripts/prepare-desktop-icons.mjs",
      "scripts/desktop-icns.mjs",
      "scripts/run-desktop-builder.mjs",
    ];
    expect(planNativeRelease("desktop", changedFiles)).toEqual({
      rebuild: true,
      relevantChanges: changedFiles,
    });
  });

  test("does not rebuild desktop for release notes or a root version bump alone", () => {
    expect(
      planNativeRelease("desktop", ["package.json", "AGENTS.md"]),
    ).toEqual({ rebuild: false, relevantChanges: [] });
  });
});
