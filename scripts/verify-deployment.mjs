import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEPLOYMENT_TARGETS_PATH } from "./wrangler-runner.mjs";

export const REQUIRED_TABLES = [
  "users",
  "sessions",
  "auth_login_attempts",
  "workspaces",
  "workspace_members",
  "notebooks",
  "memos",
  "memo_shares",
  "memo_import_sources",
  "mobile_sync_changes",
  "memo_search_documents",
  "memo_tags",
  "maintenance_leases",
  "ai_provider_configs",
  "ai_models",
  "ai_workspace_settings",
];

export const buildSchemaVerificationSql = () =>
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map((name) => `'${name}'`).join(", ")}) ORDER BY name`;

export const parseJsonOutput = (output, description) => {
  if (!output.trim()) {
    throw new Error(`Wrangler returned no JSON while checking ${description}.`);
  }

  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(
      `Wrangler returned invalid JSON while checking ${description}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const parseD1Rows = (output) => {
  // Some Wrangler versions emit an empty stdout for a successful D1 query
  // with zero rows instead of the documented empty JSON result.
  if (!output.trim()) {
    return [];
  }
  const parsed = parseJsonOutput(output, "the remote D1 schema");
  const results = Array.isArray(parsed) ? parsed : [parsed];
  return results.flatMap((result) => result?.results ?? []);
};

export const parseSecretNames = (output) => {
  const parsed = parseJsonOutput(output, "Worker Secrets");
  const secrets = Array.isArray(parsed) ? parsed : parsed?.secrets ?? parsed?.result ?? [];
  return new Set(secrets.map((secret) => secret?.name).filter(Boolean));
};

const instanceEnvironmentValue = (env, name) => {
  const instanceKey = env.EDGE_EVER_INSTANCE?.trim().replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  return (instanceKey ? env[`EDGE_EVER_${instanceKey}_${name}`]?.trim() : "")
    || env[`EDGE_EVER_${name}`]?.trim()
    || "";
};

export const normalizeDeploymentUrl = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Deployment URL must use HTTP(S) without embedded credentials: ${value}`);
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error(`Invalid deployment URL: ${value}`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`Deployment URL must use HTTP(S) without embedded credentials: ${value}`);
  }
  return url.origin;
};

export const parseCapturedDeploymentTargets = (content) => {
  const parsed = parseJsonOutput(content, "the deployed Worker targets");
  if (!Array.isArray(parsed?.urls) || parsed.urls.some((url) => typeof url !== "string")) {
    throw new Error("Wrangler returned an invalid deployed Worker targets file.");
  }
  if (parsed.versionId !== undefined && typeof parsed.versionId !== "string") {
    throw new Error("Wrangler returned an invalid deployed Worker version ID.");
  }
  return {
    urls: parsed.urls.map((url) => normalizeDeploymentUrl(url)).filter(Boolean),
    versionId: parsed.versionId?.trim() || undefined,
  };
};

export const parseCapturedDeploymentUrls = (content) => parseCapturedDeploymentTargets(content).urls;

export const readCapturedDeploymentTargets = (path = resolve(DEPLOYMENT_TARGETS_PATH)) =>
  existsSync(path)
    ? parseCapturedDeploymentTargets(readFileSync(path, "utf8"))
    : { urls: [], versionId: undefined };

export const readCapturedDeploymentUrls = (path = resolve(DEPLOYMENT_TARGETS_PATH)) =>
  readCapturedDeploymentTargets(path).urls;

export const resolveDeploymentUrl = ({ env = process.env, capturedUrls = [] } = {}) => {
  const configuredUrl = instanceEnvironmentValue(env, "DEPLOYMENT_URL");
  if (configuredUrl) return normalizeDeploymentUrl(configuredUrl);

  const customDomain = instanceEnvironmentValue(env, "CUSTOM_DOMAIN");
  if (customDomain) return normalizeDeploymentUrl(customDomain);

  return capturedUrls[0];
};

const wait = (durationMs) => new Promise((resolveWait) => setTimeout(resolveWait, durationMs));

const summarizeHealthResponseBody = (body, maxLength = 500) => {
  const normalized = body.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}…`
    : normalized;
};

const healthFailureContext = ({ body, deploymentVersionId, response }) => {
  const details = [];
  const responseBody = summarizeHealthResponseBody(body);
  const cfRay = response.headers.get("cf-ray")?.trim();

  if (responseBody) details.push(`response body: ${responseBody}`);
  if (cfRay) details.push(`CF-Ray: ${cfRay}`);
  if (deploymentVersionId) details.push(`Worker Version ID: ${deploymentVersionId}`);
  details.push(
    "Inspect Cloudflare Workers & Pages > edgeever > Logs > Live for the uncaught exception and stack trace, then retry the request.",
  );

  return details.join("; ");
};

export const verifyCloudflareWorkerHealth = async ({
  deploymentUrl,
  deploymentVersionId,
  fetchImpl = fetch,
  attempts = 4,
  retryDelayMs = 1_000,
} = {}) => {
  const normalizedDeploymentUrl = normalizeDeploymentUrl(deploymentUrl ?? "");
  if (!normalizedDeploymentUrl) {
    throw new Error("A deployment URL is required for the live Worker health check.");
  }
  const healthUrl = new URL("/api/health", `${normalizedDeploymentUrl}/`).toString();
  let lastFailure;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(healthUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.text();
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        payload = undefined;
      }

      if (response.ok && payload?.ok === true) {
        return { healthUrl, payload };
      }

      if (payload?.error?.code === "database_not_ready") {
        lastFailure = new Error(
          `Deployed Worker reports database_not_ready at ${healthUrl}. The D1 database verified by Wrangler may differ from the DB binding used by the live Worker.`,
        );
      } else if (payload?.error?.code === "object_storage_not_ready") {
        lastFailure = new Error(
          `Deployed Worker reports object_storage_not_ready at ${healthUrl}. Check that the RESOURCES binding points to the configured R2 bucket.`,
        );
      } else {
        const diagnostic = payload?.error?.code || `${response.status} ${response.statusText}`.trim();
        const context = healthFailureContext({ body, deploymentVersionId, response });
        lastFailure = new Error(
          `Deployed Worker health check failed at ${healthUrl}: ${diagnostic}; ${context}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastFailure = new Error(`Deployed Worker health check request failed at ${healthUrl}: ${message}.`);
    }

    if (attempt < attempts) await wait(retryDelayMs);
  }

  throw lastFailure ?? new Error(`Deployed Worker health check failed at ${healthUrl}.`);
};

const runWrangler = (args, options = {}) => {
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/run-wrangler.mjs"), ...args],
    { encoding: "utf8", env: process.env },
  );

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Wrangler verification command exited with status ${result.status ?? 1}.`);
  }

  if (!result.stdout.trim() && !options.allowEmptyOutput) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(
      "Wrangler completed without returning verification data. Check the D1 binding and deployment credentials, then retry.",
    );
  }

  return result.stdout;
};

const main = async () => {
  const schemaOutput = runWrangler([
    "d1",
    "execute",
    "DB",
    "--remote",
    "--command",
    buildSchemaVerificationSql(),
    "--json",
  ], { allowEmptyOutput: true });
  const tableNames = new Set(parseD1Rows(schemaOutput).map((row) => row.name));
  const missingTables = REQUIRED_TABLES.filter((table) => !tableNames.has(table));
  if (missingTables.length > 0) {
    throw new Error(
      `Remote D1 migrations are incomplete; missing tables: ${missingTables.join(", ")}. Run bun run db:migrate:remote and retry deployment.`,
    );
  }
  console.log(`[ok] remote D1 schema: ${REQUIRED_TABLES.length} required tables`);

  const secretNames = parseSecretNames(runWrangler(["secret", "list", "--format", "json"]));
  if (!secretNames.has("EDGE_EVER_AUTH_PASSWORD") && !secretNames.has("EDGE_EVER_AUTH_PASSWORD_HASH")) {
    throw new Error("The deployed Worker has no EdgeEver authentication Secret.");
  }
  console.log("[ok] Worker authentication Secret is deployed");

  const capturedTargets = readCapturedDeploymentTargets();
  const deploymentUrl = resolveDeploymentUrl({ capturedUrls: capturedTargets.urls });
  if (!deploymentUrl) {
    if (process.env.CI?.trim().toLowerCase() === "true" || process.env.WORKERS_CI === "1") {
      throw new Error(
        "Could not determine the deployed Worker URL for the live health check. Set EDGE_EVER_DEPLOYMENT_URL and retry deployment.",
      );
    }
    console.log("[skip] deployed Worker health: set EDGE_EVER_DEPLOYMENT_URL to enable the live check");
    return;
  }

  const health = await verifyCloudflareWorkerHealth({
    deploymentUrl,
    deploymentVersionId: capturedTargets.versionId,
  });
  const versionDiagnostic = capturedTargets.versionId
    ? ` (Worker Version ID: ${capturedTargets.versionId})`
    : "";
  console.log(`[ok] deployed Worker health: ${health.healthUrl}${versionDiagnostic}`);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
    // Cloudflare Builds captures stderr through a pipe. Let the stream flush
    // before Bun exits so the actionable failure is not lost behind the
    // generic parent-script exit messages.
    process.exitCode = 1;
  });
}
