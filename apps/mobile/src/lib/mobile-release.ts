import { clean, gt, valid } from "semver";

const RELEASES_API_URL = "https://api.github.com/repos/tianma-if/edgeever/releases";
const MOBILE_CONFIG_URL = "https://raw.githubusercontent.com/tianma-if/edgeever";
const PLAY_NOTES_TIMEOUT_MS = 2_500;

export const GITHUB_LATEST_RELEASE_URL = "https://github.com/tianma-if/edgeever/releases/latest";
export const ANDROID_APPLICATION_ID = "org.edgeever.mobile";
export const GOOGLE_PLAY_APP_URL = "market://details?id=org.edgeever.mobile";
export const GOOGLE_PLAY_WEB_URL = "https://play.google.com/store/apps/details?id=org.edgeever.mobile";

type MobileInstallUpdateSourceBase = {
  url: string;
};

export type MobileInstallUpdateSource =
  | MobileInstallUpdateSourceBase & {
    applicationId: string;
    fallbackUrl: string;
    id: "google-play";
  }
  | MobileInstallUpdateSourceBase & {
    id: "github";
  };

/** Manual destinations presented when a newer Android binary is available. */
export const ANDROID_INSTALL_UPDATE_SOURCES: readonly MobileInstallUpdateSource[] = [
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
];

type GitHubRelease = {
  assets?: unknown;
  body?: unknown;
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

const fetchGitHubRelease = async (path: string, fetchRelease: typeof fetch, signal?: AbortSignal) => {
  const response = await fetchRelease(`${RELEASES_API_URL}/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal,
  });
  if (!response.ok) {
    throw new Error(`GitHub release check failed with status ${response.status}`);
  }
  return await response.json() as GitHubRelease;
};

const selectReleaseNotes = (body: unknown, locale: string) => {
  if (typeof body !== "string") return null;
  const sections = new Map<string, string>();
  for (const section of body.split(/^##\s+/m).slice(1)) {
    const [heading, ...lines] = section.split(/\r?\n/);
    const notes = lines
      .filter((line) => !/^(?:关联 Issue|Related Issue|贡献者 \/ Contributors)[:：]/i.test(line.trim()))
      .join("\n")
      .replace(/^\s*[-*] /gm, "• ")
      .trim();
    if (notes) sections.set(heading.trim(), notes);
  }
  return (locale.startsWith("zh") ? sections.get("主要更新") : null)
    || sections.get("Key Changes")
    || sections.get("主要更新")
    || null;
};

/** Display notes only when the APK's original release matches Play's offered version code. */
export const findPlayReleaseNotes = async (
  versionCode: number,
  locale: string,
  fetchRelease: typeof fetch = fetch,
): Promise<{ version: string; notes: string } | null> => {
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAY_NOTES_TIMEOUT_MS);
  try {
    const { signal } = controller;
    const latest = await fetchGitHubRelease("latest", fetchRelease, signal);
    const version = findAndroidReleaseVersion(latest.assets);
    if (!version) return null;
    const tag = `v${version}`;
    const response = await fetchRelease(`${MOBILE_CONFIG_URL}/${tag}/apps/mobile/app.json`, { signal });
    if (!response.ok) return null;
    const config = await response.json();
    if (config?.expo?.version !== version || config.expo.android?.versionCode !== versionCode) return null;

    // Desktop-only releases can reuse the Android APK and have unrelated notes.
    const release = latest.tag_name === tag ? latest : await fetchGitHubRelease(`tags/${tag}`, fetchRelease, signal);
    if (release.tag_name !== tag) return null;
    const notes = selectReleaseNotes(release.body, locale);
    return notes ? { version, notes } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export const findNewerMobileRelease = async (
  currentVersion: string,
  fetchRelease: typeof fetch = fetch
): Promise<MobileRelease | null> => {
  const normalizedCurrentVersion = normalizeVersion(currentVersion);
  if (!normalizedCurrentVersion) {
    throw new Error(`Invalid installed app version: ${currentVersion}`);
  }

  const release = await fetchGitHubRelease("latest", fetchRelease);
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
