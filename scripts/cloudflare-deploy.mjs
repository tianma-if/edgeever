import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
const findWrangler = () => {
  const binDir = resolve("node_modules", ".bin");
  const candidates = process.platform === "win32"
    ? ["wrangler.exe", "wrangler.cmd", "wrangler"]
    : ["wrangler"];
  for (const name of candidates) {
    const full = resolve(binDir, name);
    if (existsSync(full)) return full;
  }
  return process.platform === "win32" ? "wrangler.exe" : "wrangler";
};
const wrangler = findWrangler();

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
    shell: process.platform === "win32",
    ...options,
  });

const runWrangler = (args) => run(wrangler, args);

const check = (label, passed, detail = "") => {
  const status = passed ? "ok" : "fail";
  console.log(`[${status}] ${label}${detail ? `: ${detail}` : ""}`);
  return passed;
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

const ensurePasswordHash = (values) => {
  const currentHash = envValue("AUTH_PASSWORD_HASH", values);
  if (currentHash) {
    return check("auth password hash", PASSWORD_HASH_PATTERN.test(currentHash), "configured");
  }

  const password = process.env.EDGE_EVER_PASSWORD?.trim();
  if (!password) {
    return check(
      "auth password hash",
      false,
      "set EDGE_EVER_PASSWORD and rerun setup, or set EDGE_EVER_AUTH_PASSWORD_HASH",
    );
  }

  const result = run("bun", ["scripts/hash-password.mjs"], {
    env: { ...process.env, EDGE_EVER_PASSWORD: password },
  });
  if (result.status !== 0) {
    console.error(result.stderr.trim());
    return check("generate auth password hash", false);
  }

  const passwordHash = result.stdout.trim();
  upsertEnv(targetKey("AUTH_PASSWORD_HASH", values), passwordHash);
  console.log("[ok] generated auth password hash");
  return true;
};

const doctor = () => {
  const values = readEnv();
  let passed = true;

  passed = check("Bun", run("bun", ["--version"]).status === 0) && passed;
  passed = check("Wrangler", runWrangler(["--version"]).status === 0) && passed;
  passed = check(".env.local", existsSync(envPath), existsSync(envPath) ? "present" : "missing") && passed;

  const whoami = runWrangler(["whoami"]);
  passed = check("Cloudflare auth", whoami.status === 0, whoami.status === 0 ? "authenticated" : "run wrangler login") && passed;

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
  passed =
    check(
      "auth password hash",
      Boolean(passwordHash && PASSWORD_HASH_PATTERN.test(passwordHash)),
      passwordHash ? "configured" : "missing",
    ) && passed;

  process.exit(passed ? 0 : 1);
};

const setup = () => {
  ensureEnvLocal();
  const values = readEnv();
  let passed = true;

  passed = check("Wrangler", runWrangler(["--version"]).status === 0) && passed;
  const whoami = runWrangler(["whoami"]);
  passed = check("Cloudflare auth", whoami.status === 0, whoami.status === 0 ? "authenticated" : "run wrangler login") && passed;

  if (!passed) {
    process.exit(1);
  }

  passed = ensureD1(values) && passed;
  passed = ensureR2(values, "R2_BUCKET_NAME") && passed;
  passed = ensureR2(values, "R2_PREVIEW_BUCKET_NAME") && passed;
  passed = ensurePasswordHash(values) && passed;

  process.exit(passed ? 0 : 1);
};

if (command === "setup") {
  setup();
} else {
  doctor();
}
