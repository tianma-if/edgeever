import { expect, test } from "bun:test";
import {
  ANDROID_APPLICATION_ID,
  ANDROID_INSTALL_UPDATE_SOURCES,
  findNewerMobileRelease,
  GITHUB_LATEST_RELEASE_URL,
  GOOGLE_PLAY_APP_URL,
  GOOGLE_PLAY_WEB_URL,
} from "./mobile-release";

const responseWithTag = (tagName: string, androidVersion = tagName.replace(/^v/, "")) => new Response(JSON.stringify({
  assets: [{
    browser_download_url: `https://github.com/tianma-if/edgeever/releases/download/${tagName}/edgeever-android-v${androidVersion}-arm64-v8a.apk`,
    digest: `sha256:${"a".repeat(64)}`,
    name: `edgeever-android-v${androidVersion}-arm64-v8a.apk`,
    size: 48_000_000,
  }],
  tag_name: tagName,
}), {
  headers: { "Content-Type": "application/json" },
  status: 200,
});

test("finds a newer formal GitHub release", async () => {
  const release = await findNewerMobileRelease("0.4.14", async () => responseWithTag("v0.4.15"));

  expect(release).toEqual({
    digest: `sha256:${"a".repeat(64)}`,
    downloadUrl: "https://github.com/tianma-if/edgeever/releases/download/v0.4.15/edgeever-android-v0.4.15-arm64-v8a.apk",
    fileName: "edgeever-android-v0.4.15-arm64-v8a.apk",
    size: 48_000_000,
    version: "0.4.15",
  });
});

test("does not treat the current or an older release as an update", async () => {
  expect(await findNewerMobileRelease("0.4.15", async () => responseWithTag("v0.4.15"))).toBeNull();
  expect(await findNewerMobileRelease("0.4.15", async () => responseWithTag("v0.4.14"))).toBeNull();
});

test("uses the actual reused Android asset version instead of the overall release tag", async () => {
  expect(await findNewerMobileRelease("1.6.50", async () => responseWithTag("v1.7.0", "1.6.50"))).toBeNull();
  expect(await findNewerMobileRelease("1.6.49", async () => responseWithTag("v1.7.0", "1.6.50"))).toEqual({
    digest: `sha256:${"a".repeat(64)}`,
    downloadUrl: "https://github.com/tianma-if/edgeever/releases/download/v1.7.0/edgeever-android-v1.6.50-arm64-v8a.apk",
    fileName: "edgeever-android-v1.6.50-arm64-v8a.apk",
    size: 48_000_000,
    version: "1.6.50",
  });
});

test("rejects invalid release responses instead of claiming the app is current", async () => {
  await expect(findNewerMobileRelease("0.4.14", async () => responseWithTag("latest"))).rejects.toThrow(
    "Invalid GitHub release version"
  );
  await expect(findNewerMobileRelease("0.4.14", async () => new Response(null, { status: 403 }))).rejects.toThrow(
    "status 403"
  );
  await expect(findNewerMobileRelease("0.4.14", async () => new Response(JSON.stringify({
    assets: [],
    tag_name: "v0.4.15",
  })))).rejects.toThrow("exactly one Android APK");
  await expect(findNewerMobileRelease("0.4.14", async () => new Response(JSON.stringify({
    assets: [{
      browser_download_url: "https://attacker.invalid/edgeever.apk",
      digest: `sha256:${"a".repeat(64)}`,
      name: "edgeever-android-v0.4.15-arm64-v8a.apk",
      size: 48_000_000,
    }],
    tag_name: "v0.4.15",
  })))).rejects.toThrow("exactly one Android APK");
});

test("offers Google Play and the latest GitHub Release as manual update destinations", () => {
  expect(ANDROID_INSTALL_UPDATE_SOURCES).toEqual([
    {
      applicationId: ANDROID_APPLICATION_ID,
      fallbackUrl: GOOGLE_PLAY_WEB_URL,
      id: "google-play",
      labelEn: "Update on Google Play",
      labelZh: "在 Google Play 更新",
      url: GOOGLE_PLAY_APP_URL,
    },
    {
      id: "github",
      labelEn: "Download from GitHub",
      labelZh: "从 GitHub 下载",
      url: GITHUB_LATEST_RELEASE_URL,
    },
  ]);
});
