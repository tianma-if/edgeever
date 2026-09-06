export type DeploymentPlatform = "cloudflare" | "docker" | "unknown";

export const resolveDeploymentPlatform = (runtime: string | null | undefined): DeploymentPlatform => {
  switch (runtime) {
    case "cloudflare-workers":
      return "cloudflare";
    case "self-hosted-bun":
      return "docker";
    default:
      return "unknown";
  }
};
