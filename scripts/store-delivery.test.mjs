import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseStoreDeliveryArgs } from "./store-delivery.mjs";

describe("store delivery command", () => {
  test("uses full production delivery defaults", () => {
    expect(parseStoreDeliveryArgs(["--release", "v1.7.0"])).toMatchObject({
      releaseTag: "v1.7.0",
      platform: "both",
      androidTrack: "production",
    });
  });

  test("accepts an explicit single platform", () => {
    expect(
      parseStoreDeliveryArgs(["--release", "v1.7.0", "--platform", "ios"])
        .platform,
    ).toBe("ios");
  });

  test("supports recovering a Play-signed APK without re-uploading", () => {
    expect(
      parseStoreDeliveryArgs([
        "--release",
        "v1.7.0",
        "--platform",
        "android",
        "--recover-play-apk",
      ]).recoverPlayApk,
    ).toBe(true);
  });

  test("rejects malformed release tags", () => {
    expect(() => parseStoreDeliveryArgs(["--release", "latest"])).toThrow(
      "stable vX.Y.Z",
    );
  });

  test("uses the pinned official EAS CLI setup in store jobs", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/store-delivery.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).not.toContain("bunx eas-cli");
    expect(workflow.match(/uses: expo\/expo-github-action@v8/g)).toHaveLength(
      2,
    );
    expect(workflow.match(/eas-version: 21\.4\.0/g)).toHaveLength(2);
    expect(workflow.match(/packager: npm/g)).toHaveLength(2);
    expect(workflow).toContain("for attempt in 1 2 3");
    expect(workflow).toContain("Dependency install failed on attempt ${attempt}/3");
    expect(
      workflow.match(
        /edgeever-bun-cache-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/g,
      ),
    ).toHaveLength(3);
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
    expect(
      workflow.match(/if: \$\{\{ !inputs\.recover_play_apk \}\}/g),
    ).toHaveLength(6);
    expect(workflow).toContain("if: ${{ inputs.recover_play_apk }}");
    expect(workflow).toContain(
      "node --input-type=module -e \"await import('google-auth-library')\"",
    );
  });

  test("can prepare a matching Draft before formal publication", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/store-delivery.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain('if [[ "$release_is_draft" = "true" ]]');
    expect(workflow).toContain('previous_tag="${release_tags[0]:-}"');
    expect(workflow).toContain('git tag "$RELEASE_TAG" "$RELEASE_TARGET"');
    expect(workflow).toContain("set -o pipefail");
    expect(workflow).toContain(
      "release_target: ${{ steps.release.outputs.release_target }}",
    );
    expect(workflow).toContain('gh release view "$RELEASE_TAG"');
    expect(workflow).not.toContain("releases/tags/${RELEASE_TAG}");
    expect(workflow).toContain(
      "ref: ${{ steps.release.outputs.release_target }}",
    );
    expect(
      workflow.match(/ref: \$\{\{ needs\.plan\.outputs\.release_target \}\}/g),
    ).toHaveLength(2);
    expect(workflow).not.toContain("ref: ${{ inputs.release_tag }}");
    expect(workflow).not.toContain(
      'test "$(jq -r \'.draft\' <<<"$release")" = "false"',
    );
  });

  test("uses a dedicated Draft audit that accepts only the Play app signer", () => {
    const workflow = readFileSync(
      new URL(
        "../.github/workflows/android-play-signature-audit.yml",
        import.meta.url,
      ),
      "utf8",
    );

    expect(workflow).toContain("github.repository == 'tianma-if/edgeever'");
    expect(workflow).toContain(
      "permissions:\n  # Draft Releases are only visible to a token with repository write access.\n  contents: write",
    );
    expect(workflow).toContain('gh release view "$RELEASE_TAG"');
    expect(workflow).toContain(
      'test "$(jq -r \'.isDraft\' <<<"$release")" = "true"',
    );
    expect(workflow).toContain(
      "ref: ${{ steps.release.outputs.target_commitish }}",
    );
    expect(workflow).not.toContain("ref: ${{ inputs.release_tag }}");
    expect(workflow).toContain(
      "EDGE_EVER_ANDROID_ALLOWED_SIGNER_SHA256: ${{ secrets.ANDROID_PLAY_APP_SIGNER_SHA256 }}",
    );
    expect(workflow).not.toContain(
      "22bf52a9501c89020f5acc966960152c826bfa64f31e578e858d088f8cd75d87",
    );
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

  test("removes the sideload-only install permission from Play bundles", () => {
    const buildScript = readFileSync(
      new URL("./build-android-local.sh", import.meta.url),
      "utf8",
    );

    expect(buildScript).toContain('if [[ "$MODE" == "play" ]]');
    expect(buildScript).toContain('"$ANDROID_MANIFEST" play');
    expect(buildScript).toContain('"$ANDROID_MANIFEST" sideload');
    expect(buildScript).toContain(
      'grep -q "android.permission.REQUEST_INSTALL_PACKAGES" "$PACKAGED_MANIFEST"',
    );
  });
});
