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

export const getReleaseTagForVersion = (version: string) => {
  const match = version.match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?$/i);
  return match ? `v${match[1]}` : null;
};

const normalizeLocale = (locale: string) => locale.trim().replaceAll("_", "-").toLowerCase();

export const resolveLocalizedReleaseChanges = (
  changes: Record<string, readonly string[]>,
  language: string,
  fallbackLanguage = "en-US"
) => {
  const locales = Object.keys(changes);
  const normalizedLanguage = normalizeLocale(language);
  const exactLocale = locales.find((locale) => normalizeLocale(locale) === normalizedLanguage);
  if (exactLocale) return changes[exactLocale];

  const baseLanguage = normalizedLanguage.split("-")[0];
  const relatedLocale = locales.find((locale) => normalizeLocale(locale).split("-")[0] === baseLanguage);
  if (relatedLocale) return changes[relatedLocale];

  const normalizedFallback = normalizeLocale(fallbackLanguage);
  const fallbackLocale = locales.find((locale) => normalizeLocale(locale) === normalizedFallback);
  return fallbackLocale ? changes[fallbackLocale] : [];
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
