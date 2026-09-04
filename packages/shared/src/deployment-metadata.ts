export type DeploymentTrigger = "github_release" | "main_push" | "manual" | "unknown";
export type DeploymentMethod = "github_actions" | "cloudflare_workers_builds" | "local_cli" | "unknown";

export type DeploymentMetadata = {
  trigger: DeploymentTrigger;
  method: DeploymentMethod;
};

type DeploymentBuildEnvironment = Partial<Record<
  | "EDGE_EVER_DEPLOYMENT_TRIGGER"
  | "EDGE_EVER_DEPLOYMENT_METHOD"
  | "WORKERS_CI_COMMIT_SHA"
  | "GITHUB_ACTIONS"
  | "GITHUB_EVENT_NAME"
  | "GITHUB_REF_NAME",
  string | undefined
>>;

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

export const resolveDeploymentBuildMetadata = (
  environment: DeploymentBuildEnvironment,
): DeploymentMetadata => {
  const inferredGitHubTrigger = environment.GITHUB_EVENT_NAME === "release"
    ? "github_release"
    : environment.GITHUB_EVENT_NAME === "workflow_dispatch"
      ? "manual"
      : environment.GITHUB_EVENT_NAME === "push" && environment.GITHUB_REF_NAME === "main"
        ? "main_push"
        : undefined;

  return {
    trigger: resolveDeploymentTrigger(
      environment.EDGE_EVER_DEPLOYMENT_TRIGGER
        ?? (environment.WORKERS_CI_COMMIT_SHA ? "main_push" : inferredGitHubTrigger),
    ),
    method: resolveDeploymentMethod(
      environment.EDGE_EVER_DEPLOYMENT_METHOD
        ?? (environment.WORKERS_CI_COMMIT_SHA
          ? "cloudflare_workers_builds"
          : environment.GITHUB_ACTIONS
            ? "github_actions"
            : undefined),
    ),
  };
};
