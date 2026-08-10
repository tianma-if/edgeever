import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildLocalDevEnvironmentFile,
  findD1DatabaseIdByName,
  normalizeD1MigrationSql,
  runWranglerSync,
} from "./wrangler-runner.mjs";
import { writeWranglerNotice } from "./wrangler-output.mjs";

const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const wranglerArgs = process.argv.slice(2);
if (wranglerArgs.length === 0) {
  console.error("Usage: bun scripts/run-wrangler.mjs <wrangler args...>");
  process.exit(1);
}

const requestedInstance = process.env.EDGE_EVER_INSTANCE;

const loadLocalEnv = () => {
  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Bun expands $ references while auto-loading .env files. Values written
    // by the deployment script escape literal dollars as \$.
    value = value.replace(/\\\$/g, "$");

    if (key) {
      process.env[key] = value;
    }
  }
};

loadLocalEnv();

// An instance selected for this command must take precedence over the default
// stored in .env.local. Bun loads .env.local before this script starts, so
// capture the effective process value before the explicit reload above.
if (requestedInstance !== undefined) {
  process.env.EDGE_EVER_INSTANCE = requestedInstance;
}

const baseConfigPath = resolve(process.env.WRANGLER_CONFIG ?? "wrangler.toml");
const baseConfigDirectory = dirname(baseConfigPath);
const instance = process.env.EDGE_EVER_INSTANCE?.trim();
const instanceKey = instance?.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
const generatedConfigPath = resolve(
  instanceKey
    ? `.wrangler.generated.${instanceKey.toLowerCase()}.toml`
    : ".wrangler.generated.toml",
);
const generatedSecretsPath = resolve(
  instanceKey
    ? `.env.wrangler.generated.${instanceKey.toLowerCase()}.secrets`
    : ".env.wrangler.generated.secrets",
);
const generatedLocalDevEnvPath = resolve(".env.wrangler.generated.local");
let config = readFileSync(baseConfigPath, "utf8");
let changed = false;

const migrationCommand =
  wranglerArgs[0] === "d1"
  && wranglerArgs[1] === "migrations"
  && ["apply", "list"].includes(wranglerArgs[2]);
const configuredMigrationsDirectory = config.match(/^migrations_dir\s*=\s*"([^"]+)"/m)?.[1]
  ?? "migrations";
const migrationsDirectory = resolve(baseConfigDirectory, configuredMigrationsDirectory);
const generatedMigrationsDirectory = resolve(".wrangler.generated-migrations");
const generatedMigrationsConfigDirectory = ".wrangler.generated-migrations";

if (migrationCommand) {
  const migrationFiles = existsSync(migrationsDirectory)
    ? readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort()
    : [];
  if (migrationFiles.length === 0) {
    console.error(
      `No D1 migration files found in ${migrationsDirectory}. Update the repository checkout before retrying.`,
    );
    process.exit(1);
  }

  // Git for Windows commonly checks text files out with CRLF. Cloudflare's
  // remote D1 parser currently rejects CRLF inside multi-line CREATE TRIGGER
  // statements with SQLITE_ERROR 7500, even though local D1 accepts them.
  // Always give Wrangler a generated LF-only copy without modifying checkout.
  rmSync(generatedMigrationsDirectory, { force: true, recursive: true });
  mkdirSync(generatedMigrationsDirectory, { recursive: true });
  for (const migrationFile of migrationFiles) {
    const source = readFileSync(resolve(migrationsDirectory, migrationFile), "utf8");
    writeFileSync(
      resolve(generatedMigrationsDirectory, migrationFile),
      normalizeD1MigrationSql(source),
    );
  }
  changed = true;
  writeWranglerNotice("ok", `local D1 migrations: ${migrationFiles.length} files`);
}

const replaceTomlValue = (source, key, value) => {
  if (!value) {
    return source;
  }

  const pattern = new RegExp(`(^${key}\\s*=\\s*")[^"]*(")`, "m");
  if (!pattern.test(source)) {
    throw new Error(`Cannot find ${key} in ${baseConfigPath}`);
  }

  changed = true;
  return source.replace(pattern, `$1${value}$2`);
};

const tomlString = (value) => JSON.stringify(value);

const envValue = (name) => {
  const scopedName = instanceKey ? `EDGE_EVER_${instanceKey}_${name}` : undefined;
  return (scopedName ? process.env[scopedName] : undefined)?.trim()
    || process.env[`EDGE_EVER_${name}`]?.trim();
};

const isRemoteCommand =
  wranglerArgs.includes("deploy") || wranglerArgs.includes("--remote");
const isRemoteDevCommand = wranglerArgs.includes("dev") && wranglerArgs.includes("--remote");
const isLocalDevCommand = wranglerArgs.includes("dev") && wranglerArgs.includes("--local");

const workerName = envValue("WORKER_NAME");
if (workerName) {
  config = replaceTomlValue(config, "name", workerName);
}

const workersDev = envValue("WORKERS_DEV");
if (workersDev) {
  const normalized = workersDev.toLowerCase();
  if (!["true", "false"].includes(normalized)) {
    throw new Error("EDGE_EVER_WORKERS_DEV must be true or false.");
  }

  const pattern = /^workers_dev\s*=\s*(true|false)/m;
  if (!pattern.test(config)) {
    throw new Error(`Cannot find workers_dev in ${baseConfigPath}`);
  }

  changed = true;
  config = config.replace(pattern, `workers_dev = ${normalized}`);
}

const d1DatabaseId = envValue("D1_DATABASE_ID");
if (d1DatabaseId) {
  if (!UUID_PATTERN.test(d1DatabaseId)) {
    throw new Error("EDGE_EVER_D1_DATABASE_ID must be a Cloudflare D1 UUID.");
  }

  config = replaceTomlValue(config, "database_id", d1DatabaseId);
}

config = replaceTomlValue(config, "database_name", envValue("D1_DATABASE_NAME"));

if (isRemoteCommand && config.includes(`database_id = "${PLACEHOLDER_D1_ID}"`)) {
  const databaseName = config.match(/^database_name\s*=\s*"([^"]+)"/m)?.[1];
  if (databaseName) {
    writeWranglerNotice("info", `resolving Cloudflare D1 database id for ${databaseName}`);
    const listResult = runWranglerSync(
      ["--config", baseConfigPath, "d1", "list", "--json"],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: process.env,
      },
    );

    if (listResult.status === 0) {
      try {
        const discoveredId = findD1DatabaseIdByName(listResult.stdout, databaseName);
        if (discoveredId && UUID_PATTERN.test(discoveredId)) {
          config = replaceTomlValue(config, "database_id", discoveredId);
          writeWranglerNotice("ok", `resolved D1 database ${databaseName}`);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }
    } else if (listResult.stderr) {
      console.error(listResult.stderr.trim());
    }
  }
}

config = replaceTomlValue(config, "bucket_name", envValue("R2_BUCKET_NAME"));
config = replaceTomlValue(
  config,
  "preview_bucket_name",
  envValue("R2_PREVIEW_BUCKET_NAME"),
);

const runtimeVars = {
  // Keep the login identifier explicit in generated online deployments so
  // users can discover and override the default without changing code.
  EDGE_EVER_AUTH_USERNAME: envValue("AUTH_USERNAME") || "admin",
  EDGE_EVER_SESSION_TTL_DAYS: envValue("SESSION_TTL_DAYS"),
  EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS: envValue("AUTH_LOGIN_WINDOW_SECONDS"),
  EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS: envValue("AUTH_LOGIN_USERNAME_MAX_ATTEMPTS"),
  EDGE_EVER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS: envValue("AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS"),
  EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS: envValue("AUTH_LOGIN_IP_MAX_ATTEMPTS"),
  EDGE_EVER_AUTH_LOGIN_IP_COOLDOWN_SECONDS: envValue("AUTH_LOGIN_IP_COOLDOWN_SECONDS"),
  EDGE_EVER_R2_BUCKET_NAME: envValue("R2_BUCKET_NAME"),
  EDGE_EVER_DEMO_MODE: envValue("DEMO_MODE"),
  EDGE_EVER_LOCAL_DEMO_SEED: envValue("LOCAL_DEMO_SEED"),
  // Auth-free access is a local-development capability. Remote deployments
  // fail closed when credentials and users are both missing.
  EDGE_EVER_ALLOW_UNAUTHENTICATED: isLocalDevCommand ? "true" : undefined,
};
const runtimeVarLines = Object.entries(runtimeVars)
  .filter(([, value]) => Boolean(value))
  .map(([key, value]) => `${key} = ${tomlString(value)}`);

if (runtimeVarLines.length > 0) {
  changed = true;
  config = `${config.trimEnd()}

[vars]
${runtimeVarLines.join("\n")}
`;
}

const demoMode = envValue("DEMO_MODE")?.toLowerCase();
if (demoMode && !["true", "false"].includes(demoMode)) {
  throw new Error("EDGE_EVER_DEMO_MODE must be true or false.");
}

const localDemoSeed = envValue("LOCAL_DEMO_SEED")?.toLowerCase();
if (localDemoSeed && !["true", "false"].includes(localDemoSeed)) {
  throw new Error("EDGE_EVER_LOCAL_DEMO_SEED must be true or false.");
}

if (demoMode === "true") {
  // Default: daily 19:00 UTC = 03:00 China Standard Time (UTC+8).
  const demoResetCron = envValue("DEMO_RESET_CRON") || "0 19 * * *";
  changed = true;
  config = `${config.trimEnd()}

[triggers]
crons = [${tomlString(demoResetCron)}]
`;
}

const customDomain = envValue("CUSTOM_DOMAIN");
const routePattern = envValue("ROUTE_PATTERN") || customDomain;
if (routePattern) {
  changed = true;
  config = `${config.trimEnd()}

[[routes]]
pattern = "${routePattern}"
custom_domain = ${customDomain ? "true" : "false"}
`;
}

if (isRemoteDevCommand && !instance) {
  console.error(
    "Remote development requires an explicit instance. Run EDGE_EVER_INSTANCE=<name> bun run dev:remote.",
  );
  process.exit(1);
}

if (isRemoteCommand && config.includes(`database_id = "${PLACEHOLDER_D1_ID}"`)) {
  const databaseName = config.match(/^database_name\s*=\s*"([^"]+)"/m)?.[1] ?? "edgeever";
  console.error(
    [
      `Could not resolve Cloudflare D1 database "${databaseName}".`,
      "Create it with that exact name and ensure the Workers Builds API token has D1 read/edit permission.",
      instanceKey
        ? `Set EDGE_EVER_${instanceKey}_D1_DATABASE_ID or EDGE_EVER_D1_DATABASE_ID,`
        : "Set EDGE_EVER_D1_DATABASE_ID,",
      "or replace the database_id placeholder in wrangler.toml / WRANGLER_CONFIG.",
    ].join(" "),
  );
  process.exit(1);
}

const configPath = changed ? generatedConfigPath : baseConfigPath;
if (changed) {
  // Wrangler resolves migrations_dir relative to its config. Use an absolute,
  // slash-normalized path so generated configs behave consistently in Windows
  // Git Bash, PowerShell, Linux, and macOS.
  config = config.replace(
    /^migrations_dir\s*=\s*"[^"]+"/m,
    `migrations_dir = ${tomlString(
      (migrationCommand ? generatedMigrationsConfigDirectory : migrationsDirectory).replaceAll("\\", "/"),
    )}`,
  );
  writeFileSync(generatedConfigPath, config);
}

const isDeployCommand = wranglerArgs.includes("deploy");
const hasSecretsFileArg = wranglerArgs.some((arg) => arg === "--secrets-file" || arg.startsWith("--secrets-file="));
const hasEnvFileArg = wranglerArgs.some((arg) => arg === "--env-file" || arg.startsWith("--env-file="));
const authPassword = envValue("AUTH_PASSWORD");
const authPasswordHash = envValue("AUTH_PASSWORD_HASH");
const authSecrets = {
  ...(authPassword ? { EDGE_EVER_AUTH_PASSWORD: authPassword } : {}),
  ...(authPasswordHash ? { EDGE_EVER_AUTH_PASSWORD_HASH: authPasswordHash } : {}),
};
const finalWranglerArgs = [...wranglerArgs];
const useExistingAuthSecret = process.env.EDGE_EVER_USE_EXISTING_AUTH_SECRET?.trim().toLowerCase() === "true";

if (isDeployCommand && Object.keys(authSecrets).length === 0 && !useExistingAuthSecret) {
  console.error(
    "Refusing to deploy without EDGE_EVER_AUTH_PASSWORD or EDGE_EVER_AUTH_PASSWORD_HASH. Run bun run deploy:setup first, or use the Cloudflare one-click deploy entrypoint.",
  );
  process.exit(1);
}

if (isDeployCommand && Object.keys(authSecrets).length === 0 && useExistingAuthSecret) {
  writeWranglerNotice("info", "using the authentication Secret provisioned by Cloudflare");
}

if (isLocalDevCommand && !hasEnvFileArg) {
  writeFileSync(generatedLocalDevEnvPath, buildLocalDevEnvironmentFile());
  finalWranglerArgs.push("--env-file", generatedLocalDevEnvPath);
}

if (isDeployCommand && Object.keys(authSecrets).length > 0 && !hasSecretsFileArg) {
  writeFileSync(generatedSecretsPath, `${JSON.stringify(authSecrets, null, 2)}\n`);
  finalWranglerArgs.push("--secrets-file", generatedSecretsPath);
}

const result = runWranglerSync(["--config", configPath, ...finalWranglerArgs], {
  cwd: resolve("."),
  env: process.env,
  stdio: "inherit",
});

if (result.status === 0 && isDeployCommand) {
  for (const [secretName, secretValue] of Object.entries(authSecrets)) {
    const secretResult = runWranglerSync(["--config", configPath, "secret", "put", secretName], {
      cwd: resolve("."),
      env: process.env,
      input: secretValue,
      stdio: ["pipe", "inherit", "inherit"],
    });

    if (secretResult.error) {
      throw secretResult.error;
    }

    if (secretResult.status !== 0) {
      process.exit(secretResult.status ?? 1);
    }
  }
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
