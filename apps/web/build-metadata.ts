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

export type DeploymentTrigger = "github_release" | "main_push" | "manual" | "unknown";
export type DeploymentMethod = "github_actions" | "cloudflare_workers_builds" | "local_cli" | "unknown";

export const resolveDeploymentTrigger = (trigger: string | undefined): DeploymentTrigger => {
  if (trigger === "github_release" || trigger === "main_push" || trigger === "manual") {
    return trigger;
  }
  return "unknown";
};

export const resolveDeploymentMethod = (method: string | undefined): DeploymentMethod => {
  if (method === "github_actions" || method === "cloudflare_workers_builds" || method === "local_cli") {
    return method;
  }
  return "unknown";
};
