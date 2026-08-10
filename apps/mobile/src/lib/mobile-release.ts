import { clean, gt, valid } from "semver";

const LATEST_RELEASE_API_URL = "https://api.github.com/repos/tianma-if/edgeever/releases/latest";

export const GITHUB_LATEST_RELEASE_URL = "https://github.com/tianma-if/edgeever/releases/latest";

export type MobileInstallUpdateSource = {
  id: "github";
  labelEn: string;
  labelZh: string;
  url: string;
};

/** GitHub Releases is the canonical source for the latest Android installable build. */
export const ANDROID_INSTALL_UPDATE_SOURCES: readonly MobileInstallUpdateSource[] = [
  {
    id: "github",
    labelEn: "GitHub Releases",
    labelZh: "GitHub Releases",
    url: GITHUB_LATEST_RELEASE_URL,
  },
];

export const getDefaultMobileInstallUpdateUrl = (platform: "android" | "ios" | "web" | "windows" | "macos") => {
  return GITHUB_LATEST_RELEASE_URL;
};

type LatestReleaseResponse = {
  assets?: unknown;
  tag_name?: unknown;
};

export type MobileRelease = {
  version: string;
};

const normalizeVersion = (value: string) => {
  const normalized = clean(value);
  return normalized && valid(normalized) ? normalized : null;
};

const ANDROID_ASSET_PATTERN = /^edgeever-android-v(\d+\.\d+\.\d+)-arm64-v8a\.apk$/;

export const findAndroidReleaseVersion = (assets: unknown) => {
  if (!Array.isArray(assets)) return null;
  const versions = assets
    .map((asset) => {
      if (!asset || typeof asset !== "object" || !("name" in asset) || typeof asset.name !== "string") {
        return null;
      }
      return ANDROID_ASSET_PATTERN.exec(asset.name)?.[1] ?? null;
    })
    .filter((version): version is string => Boolean(version));
  return versions.length === 1 ? versions[0] : null;
};

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
  const latestVersion = findAndroidReleaseVersion(release.assets);
  if (!latestVersion) {
    throw new Error("GitHub release response does not contain exactly one Android APK");
  }

  return gt(latestVersion, normalizedCurrentVersion) ? { version: latestVersion } : null;
};
