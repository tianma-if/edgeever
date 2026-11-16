import { expect, test } from "bun:test";
import {
  ANDROID_APPLICATION_ID,
  ANDROID_INSTALL_UPDATE_SOURCES,
  findNewerMobileRelease,
  findPlayReleaseNotes,
  GITHUB_LATEST_RELEASE_URL,
  GOOGLE_PLAY_APP_URL,
  GOOGLE_PLAY_WEB_URL,
} from "./mobile-release";

const responseWithTag = (tagName: string, androidVersion = tagName.replace(/^v/, ""), body?: string) => new Response(JSON.stringify({
  assets: [{
    browser_download_url: `https://github.com/tianma-if/edgeever/releases/download/${tagName}/edgeever-android-v${androidVersion}-arm64-v8a.apk`,
    digest: `sha256:${"a".repeat(64)}`,
    name: `edgeever-android-v${androidVersion}-arm64-v8a.apk`,
    size: 48_000_000,
  }],
  body,
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
      url: GOOGLE_PLAY_APP_URL,
    },
    {
      id: "github",
      url: GITHUB_LATEST_RELEASE_URL,
    },
  ]);
});

const bilingualNotes = [
  "## 主要更新",
  "- 修复同步后列表不刷新的问题。",
  "关联 Issue：#123",
  "## Key Changes",
  "- Refresh the list after syncing.",
  "Related Issue: #123",
].join("\n\n");

const fetchPlayReleaseFixture = (latestTag: string, latestAndroidVersion: string, versionCode: number): typeof fetch =>
  Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.endsWith("/releases/latest")) {
      return responseWithTag(latestTag, latestAndroidVersion, latestTag === "v2.24.0" ? bilingualNotes : "## Key Changes\n\n- Desktop update.");
    }
    if (url.endsWith("/v2.24.0/apps/mobile/app.json")) {
      return Response.json({ expo: { version: "2.24.0", android: { versionCode } } });
    }
    if (url.endsWith("/releases/tags/v2.24.0")) {
      return responseWithTag("v2.24.0", undefined, bilingualNotes);
    }
    return new Response(null, { status: 404 });
  }, { preconnect: fetch.preconnect });

test("shows the matching Play release notes in Chinese or English", async () => {
  const fetchRelease = fetchPlayReleaseFixture("v2.24.0", "2.24.0", 261);
  expect(await findPlayReleaseNotes(261, "zh-TW", fetchRelease)).toEqual({
    version: "2.24.0",
    notes: "• 修复同步后列表不刷新的问题。",
  });
  expect(await findPlayReleaseNotes(261, "ja", fetchRelease)).toEqual({
    version: "2.24.0",
    notes: "• Refresh the list after syncing.",
  });
});

test("uses original notes when a desktop release reuses the Play APK", async () => {
  const fetchRelease = fetchPlayReleaseFixture("v2.24.1", "2.24.0", 261);
  expect((await findPlayReleaseNotes(261, "en-US", fetchRelease))?.notes).toBe("• Refresh the list after syncing.");
});

test("omits release notes when Play offers a different version or GitHub is unavailable", async () => {
  const fetchRelease = fetchPlayReleaseFixture("v2.24.0", "2.24.0", 261);
  expect(await findPlayReleaseNotes(262, "en-US", fetchRelease)).toBeNull();
  expect(await findPlayReleaseNotes(260, "en-US", fetchRelease)).toBeNull();
  expect(await findPlayReleaseNotes(261, "en-US", async () => new Response(null, { status: 403 }))).toBeNull();
});

test("gives up on a stalled notes request so Play can continue", async () => {
  let aborted = false;
  const notes = await findPlayReleaseNotes(261, "en-US", async (_input, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error("Missing timeout signal");
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true });
    });
  });
  expect(notes).toBeNull();
  expect(aborted).toBe(true);
});
