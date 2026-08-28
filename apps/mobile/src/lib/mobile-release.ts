import { clean, gt, valid } from "semver";

const LATEST_RELEASE_API_URL = "https://api.github.com/repos/tianma-if/edgeever/releases/latest";

export const GITHUB_LATEST_RELEASE_URL = "https://github.com/tianma-if/edgeever/releases/latest";
export const GOOGLE_PLAY_APP_URL = "market://details?id=org.edgeever.mobile";
export const GOOGLE_PLAY_WEB_URL = "https://play.google.com/store/apps/details?id=org.edgeever.mobile";

export type MobileInstallUpdateSource = {
  fallbackUrl?: string;
  id: "github" | "google-play";
  labelEn: string;
  labelZh: string;
  url: string;
};

/** Manual destinations presented when a newer Android binary is available. */
export const ANDROID_INSTALL_UPDATE_SOURCES: readonly MobileInstallUpdateSource[] = [
  {
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
];

type LatestReleaseResponse = {
  assets?: unknown;
  tag_name?: unknown;
};

export type MobileRelease = {
  digest: string;
  downloadUrl: string;
  fileName: string;
  size: number;
  version: string;
};

const normalizeVersion = (value: string) => {
  const normalized = clean(value);
  return normalized && valid(normalized) ? normalized : null;
};

const ANDROID_ASSET_PATTERN = /^edgeever-android-v(\d+\.\d+\.\d+)-arm64-v8a\.apk$/;

const findAndroidReleaseAsset = (assets: unknown): MobileRelease | null => {
  if (!Array.isArray(assets)) return null;
  const releases = assets
    .map((asset) => {
      if (
        !asset ||
        typeof asset !== "object" ||
        !("name" in asset) ||
        typeof asset.name !== "string"
      ) {
        return null;
      }
      const version = ANDROID_ASSET_PATTERN.exec(asset.name)?.[1];
      if (
        !version ||
        !("browser_download_url" in asset) ||
        typeof asset.browser_download_url !== "string" ||
        !asset.browser_download_url.startsWith("https://github.com/tianma-if/edgeever/releases/download/") ||
        !("digest" in asset) ||
        typeof asset.digest !== "string" ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
        !("size" in asset) ||
        typeof asset.size !== "number" ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0
      ) {
        return null;
      }
      return {
        digest: asset.digest,
        downloadUrl: asset.browser_download_url,
        fileName: asset.name,
        size: asset.size,
        version,
      };
    })
    .filter((release): release is MobileRelease => Boolean(release));
  return releases.length === 1 ? releases[0] : null;
};

export const findAndroidReleaseVersion = (assets: unknown) => findAndroidReleaseAsset(assets)?.version ?? null;

export const findNewerMobileRelease = async (
  currentVersion: string,
  fetchRelease: typeof fetch = fetch
): Promise<MobileRelease | null> => {
  const normalizedCurrentVersion = normalizeVersion(currentVersion);
  if (!normalizedCurrentVersion) {
    throw new Error(`Invalid installed app version: ${currentVersion}`);
  }

  const response = await fetchRelease(LATEST_RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub release check failed with status ${response.status}`);
  }

  const release = await response.json() as LatestReleaseResponse;
  if (typeof release.tag_name !== "string") {
    throw new Error("GitHub release response does not contain a version tag");
  }
  const releaseVersion = normalizeVersion(release.tag_name);
  if (!releaseVersion) {
    throw new Error(`Invalid GitHub release version: ${release.tag_name}`);
  }
  const latestRelease = findAndroidReleaseAsset(release.assets);
  if (!latestRelease) {
    throw new Error("GitHub release response does not contain exactly one Android APK");
  }

  return gt(latestRelease.version, normalizedCurrentVersion) ? latestRelease : null;
};
