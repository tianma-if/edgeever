import { describe, expect, test } from "bun:test";
import { planNativeRelease } from "./plan-native-release.mjs";

describe("native release planning", () => {
  test("rebuilds desktop when production archive validation changes", () => {
    for (const file of ["scripts/desktop-production-files.mjs", "scripts/verify-desktop-production-runtime.cjs"]) {
      expect(planNativeRelease("desktop", [file])).toEqual({ rebuild: true, relevantChanges: [file] });
    }
  });
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
      "apps/desktop/src/main/wechat-chat-transcript.cjs",
      "scripts/verify-android-apk-signature.mjs",
      ".github/workflows/mobile-build.yml",
      ".github/workflows/android-play-signature-audit.yml",
      ".github/workflows/store-delivery.yml",
      "scripts/download-play-universal-apk.mjs",
    ];
    expect(planNativeRelease("mobile", changedFiles)).toEqual({
      rebuild: true,
      relevantChanges: changedFiles,
    });
  });

  test("keeps an expo-sharing dependency patch scoped to Android", () => {
    const changedFiles = [
      "package.json",
      "bun.lock",
      "apps/mobile/app.json",
      "patches/expo-sharing@57.0.16.patch",
      "scripts/plan-native-release.mjs",
      "scripts/plan-native-release.test.mjs",
    ];

    expect(planNativeRelease("mobile", changedFiles)).toEqual({
      rebuild: true,
      relevantChanges: [
        "bun.lock",
        "apps/mobile/app.json",
        "patches/expo-sharing@57.0.16.patch",
      ],
    });
    expect(planNativeRelease("desktop", changedFiles)).toEqual({
      rebuild: false,
      relevantChanges: [],
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
      ".cargo/config.toml",
      ".github/workflows/desktop-build.yml",
      "scripts/create-mac-update-metadata.mjs",
      "scripts/create-windows-update-metadata.mjs",
      "scripts/prepare-desktop-icons.mjs",
      "scripts/desktop-icns.mjs",
      "scripts/pe-imports.mjs",
      "scripts/run-desktop-builder.mjs",
      "scripts/sign-windows-update-manifest.mjs",
      "scripts/verify-windows-update-release.mjs",
      "scripts/verify-desktop-cross-version-startup.mjs",
      "scripts/verify-packaged-desktop-startup.mjs",
      "scripts/verify-renderer-origin-migration.mjs",
    ];
    expect(planNativeRelease("desktop", changedFiles)).toEqual({
      rebuild: true,
      relevantChanges: changedFiles,
    });
  });

  test("does not rebuild desktop for release notes or a root version bump alone", () => {
    expect(
      planNativeRelease("desktop", ["package.json", "release-summary.json", "AGENTS.md"]),
    ).toEqual({ rebuild: false, relevantChanges: [] });
  });

  test("rebuilds iOS when the bundled WeChat formatter changes", () => {
    const file = "apps/desktop/src/main/wechat-chat-transcript.cjs";
    expect(planNativeRelease("ios", [file])).toEqual({ rebuild: true, relevantChanges: [file] });
  });

  test("rebuilds iOS for the native client or shared editor runtime", () => {
    expect(
      planNativeRelease("ios", [
        "apps/ios/EdgeEver/App/RootView.swift",
        "packages/shared/src/index.ts",
        "apps/mobile/src/screens/LoginScreen.tsx",
      ]),
    ).toEqual({
      rebuild: true,
      relevantChanges: [
        "apps/ios/EdgeEver/App/RootView.swift",
        "packages/shared/src/index.ts",
      ],
    });
  });

  test("does not rebuild iOS for Android-only or documentation changes", () => {
    expect(
      planNativeRelease("ios", [
        "apps/mobile/src/screens/LoginScreen.tsx",
        "apps/ios/README.md",
        "package.json",
      ]),
    ).toEqual({ rebuild: false, relevantChanges: [] });
  });

  test("rebuilds desktop when bundled sidecar migrations change", () => {
    expect(
      planNativeRelease("desktop", [
        "migrations/0053_collapse_duplicate_inbox_notebooks.sql",
        "apps/api/src/notebook-service.test.mjs",
      ]),
    ).toEqual({
      rebuild: true,
      relevantChanges: ["migrations/0053_collapse_duplicate_inbox_notebooks.sql"],
    });
  });
});
