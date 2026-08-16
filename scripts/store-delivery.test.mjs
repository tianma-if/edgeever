import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseStoreDeliveryArgs } from "./store-delivery.mjs";

describe("store delivery command", () => {
  test("uses full production delivery defaults", () => {
    expect(
      parseStoreDeliveryArgs(["--release", "v1.7.0"]),
    ).toMatchObject({
      releaseTag: "v1.7.0",
      platform: "both",
      androidTrack: "production",
    });
  });

  test("accepts an explicit single platform", () => {
    expect(
      parseStoreDeliveryArgs([
        "--release",
        "v1.7.0",
        "--platform",
        "ios",
      ]).platform,
    ).toBe("ios");
  });

  test("rejects malformed release tags", () => {
    expect(() =>
      parseStoreDeliveryArgs(["--release", "latest"])
    ).toThrow("stable vX.Y.Z");
  });

  test("uses the pinned official EAS CLI setup in store jobs", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/store-delivery.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).not.toContain("bunx eas-cli");
    expect(workflow.match(/uses: expo\/expo-github-action@v8/g)).toHaveLength(2);
    expect(workflow.match(/eas-version: 21\.4\.0/g)).toHaveLength(2);
    expect(workflow.match(/packager: npm/g)).toHaveLength(2);
  });

  test("replaces the GitHub APK with the Play-signed universal APK", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/store-delivery.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64");
    expect(workflow).toContain("ANDROID_PLAY_APP_SIGNER_SHA256");
    expect(workflow).toContain("scripts/download-play-universal-apk.mjs");
    expect(workflow).toContain('gh release upload "$RELEASE_TAG" "$apk_path"');
  });

  test("keeps the Play bundle and generated Release APK arm64-only", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/store-delivery.yml", import.meta.url),
      "utf8",
    );
    const buildScript = readFileSync(
      new URL("./build-android-local.sh", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain("EDGE_EVER_ANDROID_PLAY_ARCHS: arm64-v8a");
    expect(workflow).toContain("Verify Play APK architecture");
    expect(workflow).toContain('if [[ "$actual_archs" != "arm64-v8a" ]]');
    expect(buildScript).toContain(
      'PLAY_ARCHS="${EDGE_EVER_ANDROID_PLAY_ARCHS:-arm64-v8a}"',
    );
    expect(buildScript).toContain(
      'if [[ "$ACTUAL_PLAY_ARCHS" != "$PLAY_ARCHS" ]]',
    );
    expect(buildScript).not.toContain("EDGE_EVER_ANDROID_ARCHS:-");
    expect(buildScript).not.toContain("armeabi-v7a,arm64-v8a,x86,x86_64");
  });
});
