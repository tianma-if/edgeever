export const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";

export const hasPlaceholderD1Binding = (config) =>
  new RegExp(`^database_id\\s*=\\s*["']${PLACEHOLDER_D1_ID}["']`, "m").test(config);

export const shouldRunEdgeEverDeployment = (
  args,
  env = process.env,
  repositoryConfig = "",
) =>
  env.WORKERS_CI === "1"
  && env.EDGE_EVER_WRANGLER_BYPASS_SHIM !== "1"
  && !env.WRANGLER_CONFIG?.trim()
  // Cloudflare's production default is exactly `npx wrangler deploy`.
  // Preserve every explicit Wrangler customization for existing deployments.
  && args.length === 1
  && args[0] === "deploy"
  // Legacy deployments that committed a real UUID already work with the
  // official CLI and must retain that behavior.
  && hasPlaceholderD1Binding(repositoryConfig);

export const edgeEverDeploymentEnvironment = (env = process.env) => ({
  ...env,
  EDGE_EVER_DEPLOYMENT_TRIGGER: env.EDGE_EVER_DEPLOYMENT_TRIGGER || "main_push",
  EDGE_EVER_DEPLOYMENT_METHOD:
    env.EDGE_EVER_DEPLOYMENT_METHOD || "cloudflare_workers_builds_default",
});
