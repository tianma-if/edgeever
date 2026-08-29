import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";

const REPOSITORY_WRANGLER_VALUES = {
  name: "edgeever",
  workers_dev: "true",
  database_name: "edgeever",
  database_id: PLACEHOLDER_D1_ID,
  bucket_name: "edgeever-resources",
  preview_bucket_name: "edgeever-resources-preview",
};
const REPOSITORY_WRANGLER_SHA256 = "d49ed530169a8597d2c17d5c6b99e03e371c8710124bbce4e526cf2b3a720f7a";

const configValue = (config, key) => {
  const match = config.match(new RegExp(`^${key}\\s*=\\s*(?:"([^"]*)"|(true|false))`, "m"));
  return match?.[1] ?? match?.[2];
};

export const repositoryWranglerConfigError = (config, usesRepositoryConfig) => {
  if (!usesRepositoryConfig) return undefined;

  const changedEntry = Object.entries(REPOSITORY_WRANGLER_VALUES)
    .find(([key, expected]) => configValue(config, key) !== expected);
  const instanceSection = ["[[routes]]", "[vars]", "[triggers]"]
    .find((section) => config.includes(section));
  const normalizedConfig = config.replace(/\r\n/g, "\n");
  const repositoryConfigChanged = createHash("sha256")
    .update(normalizedConfig)
    .digest("hex") !== REPOSITORY_WRANGLER_SHA256;
  if (!changedEntry && !instanceSection && !repositoryConfigChanged) return undefined;

  const changedSetting = changedEntry?.[0] ?? instanceSection ?? "tracked file contents";

  return [
    `Refusing instance-specific setting ${changedSetting} in the repository wrangler.toml.`,
    "Restore the tracked file from upstream.",
    "Provide deployment settings through EDGE_EVER_* Workers Builds variables,",
    "or point WRANGLER_CONFIG at an external configuration file for an advanced deployment.",
  ].join(" ");
};

export const resolveWranglerCliPath = (cwd = resolve(".")) =>
  resolve(cwd, "node_modules", "wrangler", "bin", "wrangler.js");

export const resolveWranglerRuntimeExecutable = (runtimeExecutable) =>
  runtimeExecutable ?? (process.versions.bun ? "node" : process.execPath);

export const buildWranglerInvocation = (args, options = {}) => ({
  executable: resolveWranglerRuntimeExecutable(options.runtimeExecutable),
  args: [resolveWranglerCliPath(options.cwd), ...args],
});

export const isD1MigrationApplyCommand = (args) => {
  const command = args.join(" ");
  return /(?:^|\s)d1\s+migrations\s+apply(?:\s|$)/.test(command);
};

export const buildWranglerEnvironment = (args, env = process.env) => ({
  ...env,
  // The repository installs a Wrangler compatibility shim so Cloudflare's
  // default `npx wrangler deploy` cannot bypass the validated pipeline. Calls
  // originating from our runner must delegate straight to the official CLI.
  EDGE_EVER_WRANGLER_BYPASS_SHIM: "1",
  ...(isD1MigrationApplyCommand(args) ? { CI: "true" } : {}),
});

export const normalizeD1MigrationSql = (sql) => sql.replace(/\r\n?/g, "\n");

export const DEPLOYMENT_TARGETS_PATH = ".wrangler.deployment-targets.json";

const stripAnsi = (value) => value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");

const normalizeDeploymentUrl = (value) => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return undefined;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
};

export const parseWranglerDeploymentUrls = (output) => {
  const lines = stripAnsi(output).split(/\r?\n/);
  const triggerIndex = lines.findIndex((line) => /^Deployed .+ triggers\b/.test(line.trim()));
  if (triggerIndex === -1) return [];

  const urls = [];
  for (const line of lines.slice(triggerIndex + 1)) {
    const target = line.trim();
    if (!target) continue;
    if (/^Current Version ID:/i.test(target) || /^No targets deployed for\b/i.test(target)) break;

    const directUrl = /^(https?:\/\/[^\s]+)(?:\s|$)/i.exec(target)?.[1];
    const customDomain = /^([^\s/]+)\s+\(custom domain\b/i.exec(target)?.[1];
    const normalized = normalizeDeploymentUrl(directUrl ?? customDomain ?? "");
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  }
  return urls;
};

export const parseWranglerDeploymentVersionId = (output) => {
  const matches = [...stripAnsi(output).matchAll(/^Current Version ID:\s*(\S+)\s*$/gim)];
  return matches.at(-1)?.[1];
};

export const shouldCaptureDeploymentTargets = (env = process.env) =>
  env.WORKERS_CI === "1" || env.CI?.trim().toLowerCase() === "true";

export const LOCAL_DEV_CREDENTIALS_ENCRYPTION_KEY =
  "edgeever-local-development-credentials-key-v1";

export const buildLocalDevEnvironmentFile = () => [
  "# Local-only values. Remote instance secrets are intentionally excluded.",
  `EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY=${LOCAL_DEV_CREDENTIALS_ENCRYPTION_KEY}`,
  "",
].join("\n");

export const findD1DatabaseIdByName = (json, databaseName) => {
  let databases;
  try {
    databases = JSON.parse(json);
  } catch {
    throw new Error("Wrangler returned invalid JSON while listing D1 databases.");
  }

  if (!Array.isArray(databases)) {
    throw new Error("Wrangler returned an unexpected response while listing D1 databases.");
  }

  const matches = databases.filter((database) => database?.name === databaseName);
  if (matches.length !== 1) {
    return undefined;
  }

  const databaseId = matches[0]?.uuid;
  return typeof databaseId === "string" ? databaseId : undefined;
};

const parseWranglerObject = (json, description) => {
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`Wrangler returned invalid JSON while reading ${description}.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Wrangler returned an unexpected response while reading ${description}.`);
  }
  return value;
};

export const productionVersionIds = (json) => {
  const deployment = parseWranglerObject(json, "the production Worker deployment");
  if (!Array.isArray(deployment.versions)) {
    throw new Error(
      "Wrangler returned an unexpected response while reading the production Worker deployment.",
    );
  }
  return deployment.versions
    .filter((version) =>
      typeof version?.version_id === "string" && Number(version?.percentage) > 0
    )
    .sort((left, right) => Number(right.percentage) - Number(left.percentage))
    .map((version) => version.version_id);
};

export const deployedWorkerSettings = (json) => {
  const version = parseWranglerObject(json, "the deployed Worker version");
  const bindings = version.resources?.bindings;
  if (!Array.isArray(bindings)) {
    throw new Error(
      "Wrangler returned an unexpected response while reading the deployed Worker version.",
    );
  }
  const resources = bindings.filter((binding) =>
    binding?.name === "RESOURCES" && binding?.type === "r2_bucket"
  );
  const usernames = bindings.filter((binding) =>
    binding?.name === "EDGE_EVER_AUTH_USERNAME" && binding?.type === "plain_text"
  );
  return {
    r2BucketName: resources.length === 1 && typeof resources[0].bucket_name === "string"
      ? resources[0].bucket_name
      : undefined,
    authUsername: usernames.length === 1 && typeof usernames[0].text === "string"
      ? usernames[0].text
      : undefined,
  };
};

export const buildWranglerSpawnOptions = (args, options = {}) => {
  if (!isD1MigrationApplyCommand(args) || options.input !== undefined) {
    return options;
  }

  return {
    ...options,
    // Wrangler 4.105 can still prompt in an interactive Windows Git Bash even
    // when CI=true. Explicitly answer yes so automated deployments never wait.
    input: "y\n",
    ...(options.stdio === "inherit"
      ? { stdio: ["pipe", "inherit", "inherit"] }
      : {}),
  };
};

export const runWranglerSync = (args, options = {}) => {
  const cwd = options.cwd ?? resolve(".");
  const cliPath = resolveWranglerCliPath(cwd);
  if (!existsSync(cliPath)) {
    return {
      status: 1,
      signal: null,
      stdout: "",
      stderr: `Wrangler is not installed at ${cliPath}. Run bun install first.\n`,
      error: new Error("Local Wrangler installation not found."),
    };
  }

  const { runtimeExecutable, ...spawnOptions } = options;
  const finalSpawnOptions = buildWranglerSpawnOptions(args, spawnOptions);
  const runtime = resolveWranglerRuntimeExecutable(runtimeExecutable);
  const result = spawnSync(runtime, [cliPath, ...args], {
    cwd,
    shell: false,
    ...finalSpawnOptions,
    env: buildWranglerEnvironment(args, finalSpawnOptions.env),
  });

  if (result.error?.code === "ENOENT" && runtime === "node") {
    result.error = new Error(
      "Node.js 22 or newer is required to run Wrangler reliably. Install Node.js, reopen the terminal, and retry.",
    );
  }

  // Wrangler can successfully handle --version without writing to the child
  // pipe when it is launched by Bun's test runner. Preserve the runner's
  // stdout contract using the version from the exact local package we ran.
  if (result.status === 0 && args.length === 1 && args[0] === "--version" && !String(result.stdout ?? "").trim()) {
    try {
      const metadata = JSON.parse(readFileSync(resolve(cwd, "node_modules", "wrangler", "package.json"), "utf8"));
      if (typeof metadata.version === "string") {
        result.stdout = options.encoding ? `${metadata.version}\n` : Buffer.from(`${metadata.version}\n`);
      }
    } catch {
      // Leave the original successful result intact if package metadata is unavailable.
    }
  }

  return result;
};
