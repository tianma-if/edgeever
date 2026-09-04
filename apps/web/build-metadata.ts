const RELEASE_DESCRIPTION_PATTERN = /^v(\d+\.\d+\.\d+)-(\d+)-g[0-9a-f]+$/i;

export const resolveAppVersion = (packageVersion: string, gitDescription: string | null) => {
  const match = gitDescription?.match(RELEASE_DESCRIPTION_PATTERN);

  if (!match) {
    return packageVersion;
  }

  const [, releaseVersion, commitsSinceRelease] = match;
  return commitsSinceRelease === "0"
    ? releaseVersion
    : `${releaseVersion}+${commitsSinceRelease}`;
};

export const resolveReleaseTimestamp = (releaseTimestamp: string | undefined) => releaseTimestamp?.trim() ?? "";
