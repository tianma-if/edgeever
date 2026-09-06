import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createLocalDevelopmentSession } from "./local-dev-auth.mjs";

export const LOCAL_DEV_API_URL = "http://127.0.0.1:8787";
export const LOCAL_DEV_WEB_URL = "http://127.0.0.1:5173";
export const LOCAL_DEV_STATE_PATH = ".wrangler/state";
export const LOCAL_DEV_PROFILE_PATH = ".env.local-dev";

export const LOCAL_DEVELOPMENT_PROFILES = Object.freeze({
  local: Object.freeze({
    name: "local",
    label: "LOCAL DEV",
    statePath: LOCAL_DEV_STATE_PATH,
    demoSeed: false,
    bootstrapAi: true,
  }),
  demo: Object.freeze({
    name: "demo",
    label: "LOCAL DEMO",
    statePath: ".wrangler/demo-state",
    demoSeed: true,
    bootstrapAi: false,
  }),
});

export const getLocalDevelopmentProfile = (name = "local") => {
  const profile = LOCAL_DEVELOPMENT_PROFILES[name];
  if (!profile) {
    throw new Error(`Unknown local development profile: ${name}. Expected local or demo.`);
  }
  return profile;
};

const AI_PROVIDERS = new Set([
  "openai",
  "openrouter",
  "anthropic",
  "google",
  "openai-compatible",
]);

export const parseEnvironmentFile = (source) => {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[key] = value.replace(/\\\$/g, "$");
  }
  return values;
};

export const buildLocalAiSeed = (environment) => {
  const apiKey = environment.EDGE_EVER_LOCAL_AI_API_KEY?.trim();
  if (!apiKey) return null;

  const provider = environment.EDGE_EVER_LOCAL_AI_PROVIDER?.trim() || "openai-compatible";
  const baseUrl = environment.EDGE_EVER_LOCAL_AI_BASE_URL?.trim();
  const modelId = environment.EDGE_EVER_LOCAL_AI_MODEL_ID?.trim();
  if (!AI_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported EDGE_EVER_LOCAL_AI_PROVIDER: ${provider}`);
  }
  if (!baseUrl || !modelId) {
    throw new Error("Local AI bootstrap requires EDGE_EVER_LOCAL_AI_BASE_URL and EDGE_EVER_LOCAL_AI_MODEL_ID.");
  }
  const parsedBaseUrl = new URL(baseUrl);
  if (!new Set(["http:", "https:"]).has(parsedBaseUrl.protocol)) {
    throw new Error("EDGE_EVER_LOCAL_AI_BASE_URL must use HTTP(S).");
  }

  return {
    provider,
    displayName: environment.EDGE_EVER_LOCAL_AI_DISPLAY_NAME?.trim() || provider,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    isEnabled: true,
    initialModelId: modelId,
  };
};

export const findLocalD1DatabasePaths = (statePath = LOCAL_DEV_STATE_PATH) => {
  const directory = resolve(statePath, "v3/d1/miniflare-D1DatabaseObject");
  if (!existsSync(directory)) return [];
  return Array.from(new Bun.Glob("*.sqlite").scanSync({ cwd: directory, absolute: true }))
    .filter((path) => !path.endsWith("/metadata.sqlite"))
    .sort();
};

export const inspectLocalD1 = (statePath = LOCAL_DEV_STATE_PATH) => {
  const paths = findLocalD1DatabasePaths(statePath);
  if (paths.length !== 1) {
    return { databaseCount: paths.length, migrationCount: null, providerCount: null, modelCount: null };
  }
  // Miniflare keeps D1 in WAL mode. SQLite may need to materialize empty
  // -wal/-shm sidecars even for inspection after a clean server shutdown.
  const database = new Database(paths[0], { readwrite: true });
  try {
    const tableNames = new Set(
      database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
    );
    const count = (table) => tableNames.has(table)
      ? Number(database.query(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0)
      : null;
    return {
      databaseCount: 1,
      migrationCount: count("d1_migrations"),
      providerCount: count("ai_provider_configs"),
      modelCount: count("ai_models"),
    };
  } finally {
    database.close();
  }
};

const loadBootstrapProfile = (path = LOCAL_DEV_PROFILE_PATH) => {
  if (!existsSync(path)) return { exists: false, seed: null };
  return {
    exists: true,
    seed: buildLocalAiSeed(parseEnvironmentFile(readFileSync(path, "utf8"))),
  };
};

const assertChildSucceeded = (result) => {
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const runLocalMigrations = (profile) => {
  mkdirSync(resolve(profile.statePath), { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-wrangler.mjs",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      profile.statePath,
    ],
    {
      cwd: resolve("."),
      env: { ...process.env, EDGE_EVER_INSTANCE: "" },
      stdio: "inherit",
    },
  );
  assertChildSucceeded(result);
};

const runProfileApi = (profile) => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-wrangler.mjs",
      "dev",
      "--local",
      "--persist-to",
      profile.statePath,
      "--port",
      "8787",
    ],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        EDGE_EVER_INSTANCE: "",
        EDGE_EVER_LOCAL_DEMO_SEED: String(profile.demoSeed),
      },
      stdio: "inherit",
    },
  );
  assertChildSucceeded(result);
};

const runProfileWeb = (profile) => {
  const result = spawnSync(process.execPath, ["run", "dev:web"], {
    cwd: resolve("."),
    env: {
      ...process.env,
      EDGE_EVER_DEVELOPMENT_PROFILE: profile.name,
    },
    stdio: "inherit",
  });
  assertChildSucceeded(result);
};

const startProfile = async (profile) => {
  runLocalMigrations(profile);
  if (profile.name === "local") await createProfileSession(profile);
  console.log(`[local-dev] ${profile.label} migrations ready: ${resolve(profile.statePath)}`);
  const result = spawnSync(
    process.execPath,
    [
      "x",
      "concurrently",
      "--kill-others-on-fail",
      "-n",
      "api,web,ready",
      "-c",
      "cyan,magenta,green",
      `bun scripts/local-dev.mjs api ${profile.name}`,
      `bun scripts/local-dev.mjs web ${profile.name}`,
      `bun scripts/local-dev.mjs ready ${profile.name}`,
    ],
    { cwd: resolve("."), env: process.env, stdio: "inherit" },
  );
  assertChildSucceeded(result);
};

const waitForLocalApi = async (timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${LOCAL_DEV_API_URL}/api/health`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) return await response.json();
      lastError = new Error(`health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(500);
  }
  throw new Error(`Local API did not become healthy within ${timeoutMs / 1_000}s: ${lastError?.message ?? "unknown error"}`);
};

const createProfileSession = async (profile) => {
  if (profile.name !== "local") throw new Error("Automatic login is only available for local development.");
  const paths = findLocalD1DatabasePaths(profile.statePath);
  if (paths.length !== 1) throw new Error("Expected one local database. Run bun run dev:prepare first.");
  const database = new Database(paths[0], { readwrite: true });
  try {
    return await createLocalDevelopmentSession(database);
  } finally {
    database.close();
  }
};

const ensureLocalAiSeed = async (token) => {
  const headers = { Authorization: `Bearer ${token}` };
  const settingsResponse = await fetch(`${LOCAL_DEV_API_URL}/api/v1/ai/settings`, { headers });
  if (!settingsResponse.ok) {
    throw new Error(`Cannot read local AI settings: HTTP ${settingsResponse.status}`);
  }
  const settings = await settingsResponse.json();
  if (settings.providers.length > 0) {
    return { state: "preserved", providerCount: settings.providers.length };
  }

  const profile = loadBootstrapProfile();
  if (!profile.seed) {
    return { state: profile.exists ? "profile-incomplete" : "profile-missing", providerCount: 0 };
  }

  const createResponse = await fetch(`${LOCAL_DEV_API_URL}/api/v1/ai/providers`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(profile.seed),
  });
  if (!createResponse.ok) {
    const body = await createResponse.json().catch(() => null);
    throw new Error(body?.error?.message || `Local AI bootstrap failed: HTTP ${createResponse.status}`);
  }
  const created = await createResponse.json();
  return { state: "seeded", providerCount: created.providers.length };
};

export const buildReadyBanner = (profile, ai = null) => {
  const aiLabel = ai
    ? {
        preserved: `preserved ${ai.providerCount} existing provider(s)`,
        seeded: `restored ${ai.providerCount} provider(s) from ${LOCAL_DEV_PROFILE_PATH}`,
        "profile-incomplete": `${LOCAL_DEV_PROFILE_PATH} has no API key; skipped bootstrap`,
        "profile-missing": `optional ${LOCAL_DEV_PROFILE_PATH} not found`,
      }[ai.state]
    : null;
  return [
    "",
    `[local-dev] ${profile.label} ready`,
    `[local-dev] Web:  ${LOCAL_DEV_WEB_URL}`,
    `[local-dev] API:  ${LOCAL_DEV_API_URL}`,
    ...(profile.name === "local" ? ["[local-dev] Auth: real local owner session; browser auto-login (EDGE_EVER_LOCAL_AUTO_LOGIN=false to disable)"] : []),
    `[local-dev] Data: ${resolve(profile.statePath)} (${profile.demoSeed ? "resettable demo data" : "persistent development data"})`,
    ...(aiLabel ? [`[local-dev] AI:   ${aiLabel}`] : []),
    "",
  ].join("\n");
};

const printReadyBanner = (profile, ai = null) => {
  console.log(buildReadyBanner(profile, ai));
};

const resetDemoProfile = async (profile) => {
  let apiHealthy = false;
  try {
    const healthResponse = await fetch(`${LOCAL_DEV_API_URL}/api/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    apiHealthy = healthResponse.ok;
  } catch {}

  if (apiHealthy) {
    const resetResponse = await fetch(`${LOCAL_DEV_API_URL}/api/v1/demo/reset`, { method: "POST" });
    if (resetResponse.ok) {
      console.log(`[local-dev] ${profile.label} reset through the running API.`);
      return;
    }
    const body = await resetResponse.json().catch(() => null);
    const details = body?.error?.message || `HTTP ${resetResponse.status}`;
    throw new Error(`Demo reset failed while an API is running: ${details}. Stop it and retry.`);
  }

  const target = resolve(profile.statePath);
  const wranglerRoot = resolve(".wrangler");
  if (profile.name !== "demo" || !target.startsWith(`${wranglerRoot}${sep}`)) {
    throw new Error(`Refusing to reset unsafe profile path: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
  runLocalMigrations(profile);
  console.log(`[local-dev] ${profile.label} state reset: ${target}`);
};

const doctor = async () => {
  const wranglerPath = resolve("node_modules/wrangler/package.json");
  const wranglerVersion = existsSync(wranglerPath)
    ? JSON.parse(readFileSync(wranglerPath, "utf8")).version
    : null;
  const profile = loadBootstrapProfile();
  const localDatabase = inspectLocalD1(LOCAL_DEVELOPMENT_PROFILES.local.statePath);
  const demoDatabase = inspectLocalD1(LOCAL_DEVELOPMENT_PROFILES.demo.statePath);
  let health = "offline";
  try {
    const response = await fetch(`${LOCAL_DEV_API_URL}/api/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    health = response.ok ? "healthy" : `HTTP ${response.status}`;
  } catch {}

  console.log([
    "EdgeEver local development doctor",
    `- Wrangler: ${wranglerVersion ? `v${wranglerVersion}` : "missing (run bun install)"}`,
    `- Web: ${LOCAL_DEV_WEB_URL}`,
    `- API: ${LOCAL_DEV_API_URL} (${health})`,
    `- LOCAL DEV data: ${resolve(LOCAL_DEVELOPMENT_PROFILES.local.statePath)}`,
    `  D1 databases/migrations: ${localDatabase.databaseCount}/${localDatabase.migrationCount ?? "not initialized"}`,
    `  AI providers/models: ${localDatabase.providerCount ?? 0}/${localDatabase.modelCount ?? 0}`,
    `- Bootstrap profile: ${profile.exists ? (profile.seed ? "configured" : "present without API key") : "optional; not created"}`,
    `- LOCAL DEMO data: ${resolve(LOCAL_DEVELOPMENT_PROFILES.demo.statePath)}`,
    `  D1 databases/migrations: ${demoDatabase.databaseCount}/${demoDatabase.migrationCount ?? "not initialized"}`,
  ].join("\n"));

  if (!wranglerVersion) process.exitCode = 1;
};

const main = async () => {
  const command = process.argv[2] ?? "doctor";
  const profileName = process.argv[3] ?? "local";
  const profile = command === "doctor" ? null : getLocalDevelopmentProfile(profileName);
  if (command === "prepare") {
    runLocalMigrations(profile);
    console.log(`[local-dev] ${profile.label} migrations ready: ${resolve(profile.statePath)}`);
  } else if (command === "start") {
    await startProfile(profile);
  } else if (command === "api") {
    runProfileApi(profile);
  } else if (command === "web") {
    runProfileWeb(profile);
  } else if (command === "ready") {
    await waitForLocalApi();
    const session = profile.bootstrapAi ? await createProfileSession(profile) : null;
    printReadyBanner(profile, session ? await ensureLocalAiSeed(session.token) : null);
  } else if (command === "auth-session") {
    console.log(JSON.stringify(await createProfileSession(profile)));
  } else if (command === "reset") {
    if (profile.name !== "demo") throw new Error("Only the demo profile is resettable.");
    await resetDemoProfile(profile);
  } else if (command === "doctor") {
    await doctor();
  } else {
    console.error("Usage: bun scripts/local-dev.mjs <start|prepare|api|web|ready|reset|doctor> [local|demo]");
    process.exit(1);
  }
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[local-dev] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
