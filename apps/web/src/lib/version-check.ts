const LATEST_RELEASE_URL = "https://api.github.com/repos/tianma-if/edgeever/releases/latest";
const CACHE_KEY = "edgeever:latest-release";
const CACHE_TTL_MS = 60 * 60 * 1000;

export type LatestRelease = {
  tagName: string;
  version: string;
  url: string;
};

const DESKTOP_ASSET_PATTERN = /^EdgeEver-(\d+\.\d+\.\d+)-mac-(arm64|x64)\.dmg$/;

export const findDesktopReleaseVersion = (assetNames: string[]) => {
  const versions = new Map<string, string>();
  for (const name of assetNames) {
    const match = DESKTOP_ASSET_PATTERN.exec(name);
    if (!match) continue;
    if (versions.has(match[2])) return null;
    versions.set(match[2], match[1]);
  }
  return (
    versions.size === 2 &&
    versions.get("arm64") === versions.get("x64")
  )
    ? versions.get("arm64")!
    : null;
};

const parseVersion = (value: string) => {
  const match = value.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i);
  return match ? {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split(".") ?? null,
  } : null;
};

export const isVersionOutdated = (currentVersion: string, latestVersion: string) => {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);
  if (!current || !latest) return false;

  for (let index = 0; index < 3; index += 1) {
    if (current.core[index] !== latest.core[index]) return current.core[index] < latest.core[index];
  }
  if (!current.prerelease) return false;
  if (!latest.prerelease) return true;
  const length = Math.max(current.prerelease.length, latest.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = current.prerelease[index];
    const latestPart = latest.prerelease[index];
    if (currentPart === undefined) return true;
    if (latestPart === undefined) return false;
    if (currentPart === latestPart) continue;
    const currentNumber = /^\d+$/.test(currentPart) ? Number(currentPart) : null;
    const latestNumber = /^\d+$/.test(latestPart) ? Number(latestPart) : null;
    if (currentNumber !== null && latestNumber !== null) return currentNumber < latestNumber;
    if (currentNumber !== null) return true;
    if (latestNumber !== null) return false;
    return currentPart.localeCompare(latestPart) < 0;
  }
  return false;
};

const readCachedRelease = (): LatestRelease | null => {
  try {
    const cached = JSON.parse(window.sessionStorage.getItem(CACHE_KEY) ?? "null") as {
      expiresAt?: number;
      release?: Partial<LatestRelease>;
    } | null;
    return (
      cached?.expiresAt &&
      cached.expiresAt > Date.now() &&
      typeof cached.release?.tagName === "string" &&
      typeof cached.release.version === "string" &&
      typeof cached.release.url === "string"
    )
      ? cached.release as LatestRelease
      : null;
  } catch {
    return null;
  }
};

export const fetchLatestRelease = async (signal?: AbortSignal): Promise<LatestRelease> => {
  const cached = readCachedRelease();
  if (cached) return cached;

  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
  });
  if (!response.ok) throw new Error(`Release lookup failed with ${response.status}`);

  const payload = (await response.json()) as {
    assets?: Array<{ name?: unknown }>;
    html_url?: string;
    tag_name?: string;
  };
  if (!payload.tag_name || !payload.html_url) throw new Error("Release response is incomplete");

  const desktopVersion = findDesktopReleaseVersion(
    payload.assets
      ?.map((asset) => asset.name)
      .filter((name): name is string => typeof name === "string") ?? []
  );
  const isDesktop = Boolean(window.edgeeverDesktop?.isAvailable);
  if (isDesktop && !desktopVersion) {
    throw new Error("Release response does not contain matching arm64 and x64 desktop DMGs");
  }
  const release = {
    tagName: payload.tag_name,
    version: isDesktop ? desktopVersion! : payload.tag_name,
    url: payload.html_url,
  };
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, release }));
  } catch {
    // Storage can be unavailable in restricted browsing modes.
  }
  return release;
};
