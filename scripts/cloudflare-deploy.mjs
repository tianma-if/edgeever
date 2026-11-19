import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runWranglerSync } from "./wrangler-runner.mjs";

const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSWORD_HASH_PATTERN = /^pbkdf2-sha256\$100000\$[^$]+\$[^$]+$/;

const command = process.argv[2] ?? "doctor";
if (!["doctor", "setup"].includes(command)) {
  console.error("Usage: bun scripts/cloudflare-deploy.mjs <doctor|setup>");
  process.exit(1);
}

const envPath = resolve(".env.local");
const envExamplePath = resolve(".env.local.example");
const parseEnv = (content) => {
  const values = new Map();

  for (const line of content.split(/\r?\n/)) {
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
    // by this script escape literal dollars as \$ so they survive that load.
    value = value.replace(/\\\$/g, "$");
    values.set(key, value);
  }

  return values;
};

const readEnv = () => {
  const values = existsSync(envPath)
    ? parseEnv(readFileSync(envPath, "utf8"))
    : new Map();

  for (const [key, value] of values) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return values;
};

const scopedKey = (name, values) => {
  const instance = (process.env.EDGE_EVER_INSTANCE || values.get("EDGE_EVER_INSTANCE") || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "_")
    .toUpperCase();
  return instance ? `EDGE_EVER_${instance}_${name}` : undefined;
};

const envValue = (name, values) => {
  const scoped = scopedKey(name, values);
  return (
    (scoped ? values.get(scoped) || process.env[scoped] : undefined) ||
    values.get(`EDGE_EVER_${name}`) ||
    process.env[`EDGE_EVER_${name}`] ||
    ""
  ).trim();
};

const targetKey = (name, values) => scopedKey(name, values) || `EDGE_EVER_${name}`;

const upsertEnv = (key, value) => {
  const content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  // Keep literal dollars from being expanded by Bun when it auto-loads the file.
  const fileValue = value.replace(/\$/g, "\\$");
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*$`, "m");
  const next = pattern.test(content)
    ? content.replace(pattern, () => `${key}=${fileValue}`)
    : `${content.trimEnd()}\n${key}=${fileValue}\n`;

  writeFileSync(envPath, next.startsWith("\n") ? next.slice(1) : next);
  process.env[key] = value;
};

const run = (executable, args, options = {}) =>
  spawnSync(executable, args, {
    cwd: resolve("."),
    encoding: "utf8",
    env: process.env,
    shell: false,
    ...options,
  });

const runWrangler = (args, options = {}) =>
  runWranglerSync(args, {
    cwd: resolve("."),
    encoding: "utf8",
    env: process.env,
    ...options,
  });

const check = (label, passed, detail = "") => {
  const status = passed ? "ok" : "fail";
  console.log(`[${status}] ${label}${detail ? `: ${detail}` : ""}`);
  return passed;
};

const printCommandFailure = (result) => {
  if (result.error?.message) console.error(result.error.message);
  if (result.stdout) console.error(String(result.stdout).trim());
  if (result.stderr) console.error(String(result.stderr).trim());
};

const ensureCloudflareAuth = () => {
  let whoami = runWrangler(["whoami"]);
  if (whoami.status === 0) {
    return check("Cloudflare auth", true, "authenticated");
  }

  console.log("[info] Cloudflare authorization is required; starting Wrangler login...");
  const login = runWrangler(["login"], { encoding: undefined, stdio: "inherit" });
  if (login.status !== 0) {
    check("Cloudflare auth", false, "Wrangler login did not complete");
    if (login.error?.message) console.error(login.error.message);
    return false;
  }

  whoami = runWrangler(["whoami"]);
  const authenticated = whoami.status === 0;
  check("Cloudflare auth", authenticated, authenticated ? "authenticated" : "login verification failed");
  if (!authenticated) printCommandFailure(whoami);
  return authenticated;
};

const ensureEnvLocal = () => {
  if (existsSync(envPath)) {
    return;
  }

  copyFileSync(envExamplePath, envPath);
  console.log("[ok] created .env.local from .env.local.example");
};

const extractUuid = (text) => {
  const assignment = text.match(/database_id\s*=\s*"([^"]+)"/);
  if (assignment?.[1] && UUID_PATTERN.test(assignment[1])) {
    return assignment[1];
  }

  const match = text.match(UUID_PATTERN);
  return match?.[0] ?? "";
};

const findD1DatabaseId = (databaseName) => {
  const result = runWrangler(["d1", "list", "--json"]);
  if (result.status !== 0) {
    return "";
  }

  try {
    const databases = JSON.parse(result.stdout);
    const database = Array.isArray(databases)
      ? databases.find((item) => item?.name === databaseName)
      : undefined;
    return database?.uuid || database?.id || "";
  } catch {
    return "";
  }
};

const ensureD1 = (values) => {
  const currentId = envValue("D1_DATABASE_ID", values);
  if (currentId && currentId !== PLACEHOLDER_D1_ID) {
    return check("D1 database id", UUID_PATTERN.test(currentId), currentId);
  }

  const databaseName = envValue("D1_DATABASE_NAME", values) || "edgeever";
  const existingId = findD1DatabaseId(databaseName);
  if (existingId) {
    upsertEnv(targetKey("D1_DATABASE_ID", values), existingId);
    console.log(`[ok] reused D1 database ${databaseName}`);
    return true;
  }

  const result = runWrangler(["d1", "create", databaseName]);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0) {
    console.error(output.trim());
    return check("create D1 database", false, `set ${targetKey("D1_DATABASE_ID", values)} manually`);
  }

  const databaseId = extractUuid(output);
  if (!databaseId) {
    console.error(output.trim());
    return check("read D1 database id", false, "could not parse wrangler output");
  }

  upsertEnv(targetKey("D1_DATABASE_ID", values), databaseId);
  console.log(`[ok] created D1 database ${databaseName}`);
  return true;
};

const ensureR2 = (values, name) => {
  const bucketName = envValue(name, values);
  if (!bucketName) {
    return name === "R2_PREVIEW_BUCKET_NAME" || check(`${name}`, false, "missing bucket name");
  }

  const result = runWrangler(["r2", "bucket", "create", bucketName]);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.status === 0 || /already exists|binding already exists|bucket.+exists/i.test(output)) {
    console.log(`[ok] R2 bucket ${bucketName}`);
    return true;
  }

  console.error(output);
  return check(`create R2 bucket ${bucketName}`, false);
};

const ensureAuthPassword = (values) => {
  const currentHash = envValue("AUTH_PASSWORD_HASH", values);
  if (currentHash) {
    const valid = PASSWORD_HASH_PATTERN.test(currentHash);
    return check("auth password hash", valid, valid ? "configured" : "invalid");
  }

  const password = process.env.EDGE_EVER_PASSWORD?.trim();
  if (password) {
    upsertEnv(targetKey("AUTH_PASSWORD", values), password);
    console.log("[ok] configured auth password secret");
    return true;
  }

  const currentPassword = envValue("AUTH_PASSWORD", values);
  return currentPassword
    ? check("auth password", true, "configured as a secret")
    : check(
        "auth password",
        false,
        "set EDGE_EVER_PASSWORD and rerun setup, or set EDGE_EVER_AUTH_PASSWORD",
      );
};

const doctor = () => {
  const values = readEnv();
  let passed = true;

  passed = check("Bun", run(process.execPath, ["--version"]).status === 0) && passed;
  const wranglerVersion = runWrangler(["--version"]);
  const wranglerAvailable = wranglerVersion.status === 0;
  passed = check("Wrangler", wranglerAvailable) && passed;
  if (!wranglerAvailable) printCommandFailure(wranglerVersion);
  passed = check(".env.local", existsSync(envPath), existsSync(envPath) ? "present" : "missing") && passed;

  if (wranglerAvailable) {
    const whoami = runWrangler(["whoami"]);
    passed = check("Cloudflare auth", whoami.status === 0, whoami.status === 0 ? "authenticated" : "run bun scripts/run-wrangler.mjs login") && passed;
    if (whoami.status !== 0) printCommandFailure(whoami);
  } else {
    passed = check("Cloudflare auth", false, "Wrangler is unavailable") && passed;
  }

  const databaseId = envValue("D1_DATABASE_ID", values);
  passed =
    check(
      "D1 database id",
      Boolean(databaseId && databaseId !== PLACEHOLDER_D1_ID && UUID_PATTERN.test(databaseId)),
      databaseId && databaseId !== PLACEHOLDER_D1_ID ? databaseId : "missing",
    ) && passed;

  passed =
    check("R2 bucket name", Boolean(envValue("R2_BUCKET_NAME", values)), envValue("R2_BUCKET_NAME", values) || "missing") &&
    passed;

  const demoMode = envValue("DEMO_MODE", values).toLowerCase();
  passed =
    check(
      "demo mode",
      !demoMode || ["true", "false"].includes(demoMode),
      demoMode === "true" ? "enabled, daily reset cron will be generated" : "disabled",
    ) && passed;

  const passwordHash = envValue("AUTH_PASSWORD_HASH", values);
  const password = envValue("AUTH_PASSWORD", values);
  const passwordHashValid = Boolean(passwordHash && PASSWORD_HASH_PATTERN.test(passwordHash));
  const passwordConfigured = Boolean(password);
  const workerConfigPath = resolve(process.env.WRANGLER_CONFIG || "wrangler.toml");
  const workerName = envValue("WORKER_NAME", values)
    || (existsSync(workerConfigPath) ? readFileSync(workerConfigPath, "utf8").match(/^name\s*=\s*"([^"]+)"/m)?.[1] : undefined)
    || "edgeever";
  const secretList = wranglerAvailable ? runWrangler(["secret", "list", "--name", workerName]) : undefined;
  let hasDeployedAuthSecret = false;
  if (secretList?.status === 0) {
    try {
      const secrets = JSON.parse(secretList.stdout);
      hasDeployedAuthSecret = Array.isArray(secrets) && secrets.some((secret) =>
        ["EDGE_EVER_AUTH_PASSWORD", "EDGE_EVER_AUTH_PASSWORD_HASH"].includes(secret?.name)
      );
    } catch {
      // The deploy runner independently requires readable live version metadata.
    }
  }
  passed =
    check(
      "auth password",
      hasDeployedAuthSecret || (passwordHash ? passwordHashValid : passwordConfigured),
      hasDeployedAuthSecret
        ? "existing Worker Secret will be preserved; local credentials are ignored"
        : passwordHash
        ? passwordHashValid
          ? password
            ? "hash configured and takes precedence over password secret"
            : "hash configured"
          : "invalid password hash; remove or replace it because it takes precedence"
        : password
          ? "password secret configured"
          : "missing",
    ) && passed;

  const allowUnauthenticated = envValue("ALLOW_UNAUTHENTICATED", values).toLowerCase();
  passed =
    check(
      "production authentication policy",
      allowUnauthenticated !== "true",
      allowUnauthenticated === "true"
        ? "EDGE_EVER_ALLOW_UNAUTHENTICATED is local-only and must not be enabled for deployment"
        : "fail-closed",
    ) && passed;

  process.exit(passed ? 0 : 1);
};

const setup = () => {
  ensureEnvLocal();
  const values = readEnv();
  let passed = true;

  const wranglerVersion = runWrangler(["--version"]);
  const wranglerAvailable = wranglerVersion.status === 0;
  passed = check("Wrangler", wranglerAvailable) && passed;
  if (!wranglerAvailable) printCommandFailure(wranglerVersion);

  if (wranglerAvailable) {
    passed = ensureCloudflareAuth() && passed;
  }

  if (!passed) {
    process.exit(1);
  }

  passed = ensureD1(values) && passed;
  passed = ensureR2(values, "R2_BUCKET_NAME") && passed;
  passed = ensureR2(values, "R2_PREVIEW_BUCKET_NAME") && passed;
  passed = ensureAuthPassword(values) && passed;

  process.exit(passed ? 0 : 1);
};

if (command === "setup") {
  setup();
} else {
  doctor();
}
