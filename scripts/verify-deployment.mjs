import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const REQUIRED_TABLES = [
  "users",
  "sessions",
  "auth_login_attempts",
  "workspaces",
  "workspace_members",
  "notebooks",
  "memos",
  "mobile_sync_changes",
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

const main = () => {
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
};

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`[fail] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
