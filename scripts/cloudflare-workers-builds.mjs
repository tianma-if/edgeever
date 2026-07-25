import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const command = process.argv[2] ?? "setup";
const dryRun = process.argv.includes("--dry-run");
const apiBase = "https://api.cloudflare.com/client/v4";

if (!["setup"].includes(command)) {
  console.error("Usage: bun scripts/cloudflare-workers-builds.mjs setup [--dry-run]");
  process.exit(1);
}

const parseEnv = (content) => {
  const values = new Map();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value.replace(/\\\$/g, "$"));
  }

  return values;
};

const localValues = existsSync(resolve(".env.local"))
  ? parseEnv(readFileSync(resolve(".env.local"), "utf8"))
  : new Map();

const value = (name) => process.env[name]?.trim() || localValues.get(name)?.trim() || "";
const instanceKey = value("EDGE_EVER_INSTANCE").replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
const instanceValue = (name) => (instanceKey ? value(`EDGE_EVER_${instanceKey}_${name}`) : "") || value(`EDGE_EVER_${name}`);

const gitRepository = () => {
  const configured = value("EDGE_EVER_GITHUB_REPOSITORY");
  if (/^[^/\s]+\/[^/\s]+$/.test(configured)) {
    const [owner, repository] = configured.split("/");
    return { owner, repository };
  }
  const remote = configured || (() => {
    try {
      return execFileSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  })();
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/#\s]+?)(?:\.git)?$/i);
  if (!match) {
    throw new Error(
      "Cannot identify the GitHub repository. Set EDGE_EVER_GITHUB_REPOSITORY=owner/repository or configure origin.",
    );
  }
  return { owner: match[1], repository: match[2] };
};

// Keep the generic token as a silent fallback for existing installations and CI.
const cfToken = value("EDGE_EVER_BUILDS_API_TOKEN") || value("CLOUDFLARE_API_TOKEN");
const accountId = value("CLOUDFLARE_ACCOUNT_ID");
const workerName = instanceValue("WORKER_NAME");
const pagesProjectName = value("EDGE_EVER_PAGES_PROJECT_NAME");

const request = async (method, path, body) => {
  if (dryRun) return undefined;

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const detail = payload.errors?.map((error) => error.message).join("; ") || response.statusText;
    throw new Error(`${method} ${path} failed: ${detail}`);
  }
  return payload.result;
};

const buildVariables = () => {
  const merged = new Map(localValues);
  for (const [key, current] of Object.entries(process.env)) {
    if (current !== undefined) merged.set(key, current);
  }

  const runtimeNames = [
    "WORKER_NAME",
    "WORKERS_DEV",
    "D1_DATABASE_NAME",
    "D1_DATABASE_ID",
    "R2_BUCKET_NAME",
    "R2_PREVIEW_BUCKET_NAME",
    "AUTH_USERNAME",
    "AUTH_PASSWORD",
    "AUTH_PASSWORD_HASH",
    "SESSION_TTL_DAYS",
    "DEMO_MODE",
    "DEMO_RESET_CRON",
    "CUSTOM_DOMAIN",
    "ROUTE_PATTERN",
  ];
  const entries = [];

  if (instanceKey) entries.push(["EDGE_EVER_INSTANCE", instanceKey]);
  for (const name of runtimeNames) {
    const scoped = instanceKey ? `EDGE_EVER_${instanceKey}_${name}` : "";
    const key = scoped && merged.get(scoped)?.trim() ? scoped : `EDGE_EVER_${name}`;
    const current = merged.get(key)?.trim();
    if (current) entries.push([key, current]);
  }

  if (!entries.some(([key]) => key.endsWith("AUTH_PASSWORD") || key.endsWith("AUTH_PASSWORD_HASH"))) {
    throw new Error("Missing EDGE_EVER_AUTH_PASSWORD or EDGE_EVER_AUTH_PASSWORD_HASH. Run deploy:setup before configuring Workers Builds.");
  }

  return Object.fromEntries(entries.map(([key, current]) => [key, {
    value: current.replace(/\\\$/g, "$"),
    is_secret: key.endsWith("AUTH_PASSWORD") || key.endsWith("AUTH_PASSWORD_HASH"),
  }]));
};

const triggerPayload = (workerTag, repoConnectionUuid, buildTokenUuid) => ({
  external_script_id: workerTag,
  repo_connection_uuid: repoConnectionUuid,
  build_token_uuid: buildTokenUuid,
  trigger_name: "Deploy EdgeEver production",
  build_command: "bun install --frozen-lockfile && EDGE_EVER_DEPLOYMENT_TRIGGER=main_push EDGE_EVER_DEPLOYMENT_METHOD=cloudflare_workers_builds bun run build:cloudflare",
  deploy_command: "bun run deploy:cloudflare-builds",
  root_directory: "/",
  branch_includes: ["main"],
  branch_excludes: [],
  path_includes: ["*"],
  path_excludes: [
    "apps/site/*",
    "apps/mobile/*",
    "apps/extension/*",
    "docs/*",
    "README*",
    ".github/*",
  ],
  build_caching_enabled: true,
});

const configurePagesWatchPaths = async () => {
  if (!pagesProjectName) return;

  try {
    await request("PATCH", `/accounts/${accountId}/pages/projects/${encodeURIComponent(pagesProjectName)}`, {
      source: {
        config: {
          // `*` spans nested directories in Cloudflare Pages. Root lockfiles and
          // package metadata are shared build inputs, so they intentionally trigger
          // both projects when changed.
          path_includes: ["apps/site/*", "bun.lock", "package.json"],
          path_excludes: [],
        },
      },
    });
    console.log(`[ok] configured Pages watch paths for ${pagesProjectName}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Direct Uploads project")) {
      console.log(`[skip] ${pagesProjectName} is a Direct Upload Pages project; its deploy workflow already controls path filtering.`);
      return;
    }
    throw error;
  }
};

const selectBuildToken = async (buildTokens, existingTrigger) => {
  const tokens = Array.isArray(buildTokens)
    ? buildTokens.filter((token) => token?.build_token_uuid)
    : [];

  // Keep accepting the old environment variable so existing installations do
  // not break, but do not expose Cloudflare's internal UUID in the new setup UX.
  const legacyBuildTokenUuid = value("EDGE_EVER_BUILDS_BUILD_TOKEN_UUID");
  if (legacyBuildTokenUuid) {
    const legacyToken = tokens.find((token) => token.build_token_uuid === legacyBuildTokenUuid);
    if (legacyToken) return legacyToken;
    throw new Error(
      "The API token configured by the legacy EDGE_EVER_BUILDS_BUILD_TOKEN_UUID setting no longer exists. Remove that setting and rerun the command.",
    );
  }

  const existingToken = existingTrigger?.build_token_uuid
    ? tokens.find((token) => token.build_token_uuid === existingTrigger.build_token_uuid)
    : undefined;
  if (existingToken) return existingToken;

  if (tokens.length === 1) return tokens[0];
  if (tokens.length === 0) {
    throw new Error(
      "No Workers Builds API token was found. In Cloudflare Dashboard open this Worker -> Settings -> Builds -> API token, create or select an API token with D1 edit permission, then rerun the command.",
    );
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Multiple Workers Builds API tokens are available (${tokens.map((token) => token.build_token_name || "Unnamed token").join(", ")}). Rerun this command in an interactive terminal and select one.`,
    );
  }

  console.log("Multiple Workers Builds API tokens are available:");
  tokens.forEach((token, index) => {
    console.log(`  ${index + 1}. ${token.build_token_name || "Unnamed token"}`);
  });

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await prompt.question(`Select an API token [1-${tokens.length}]: `)).trim();
      const selectedIndex = Number(answer) - 1;
      if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < tokens.length) {
        return tokens[selectedIndex];
      }
      console.log("Enter the number shown next to the API token you want to use.");
    }
  } finally {
    prompt.close();
  }
};

const setup = async () => {
  if (!accountId) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID.");
  if (!workerName) throw new Error("Missing EDGE_EVER_WORKER_NAME.");
  if (!cfToken) {
    throw new Error(
      "Missing EDGE_EVER_BUILDS_API_TOKEN. It must be a User API Token with Workers Builds Configuration: Edit and Workers Scripts: Read.",
    );
  }

  const repository = gitRepository();
  const variables = buildVariables();
  console.log(`[ok] repository: ${repository.owner}/${repository.repository}`);
  console.log(`[ok] Worker: ${workerName}`);
  console.log(`[ok] build variables: ${Object.keys(variables).length} (${Object.values(variables).filter((item) => item.is_secret).length} secret)`);

  if (dryRun) {
    console.log("[ok] dry run complete; no Cloudflare configuration was changed");
    return;
  }

  const github = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.repository}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  const githubRepository = await github.json().catch(() => ({}));
  if (!github.ok || !githubRepository.id || !githubRepository.owner?.id) {
    throw new Error(`Cannot read GitHub repository ${repository.owner}/${repository.repository}. For a private repository, configure an accessible origin or run this command through an authenticated Agent.`);
  }

  const scripts = await request("GET", `/accounts/${accountId}/workers/scripts`);
  const worker = scripts?.find((script) => script.id === workerName);
  if (!worker?.tag) {
    throw new Error(`Worker ${workerName} was not found. Complete the first bun run deploy:manual before enabling Workers Builds.`);
  }

  const buildTokens = await request("GET", `/accounts/${accountId}/builds/tokens`);
  const triggers = await request("GET", `/accounts/${accountId}/builds/workers/${worker.tag}/triggers`);
  const existing = triggers?.find((trigger) => trigger.branch_includes?.includes("main"));
  const buildToken = await selectBuildToken(buildTokens, existing);

  const connection = await request("PUT", `/accounts/${accountId}/builds/repos/connections`, {
    provider_type: "github",
    provider_account_id: String(githubRepository.owner.id),
    provider_account_name: githubRepository.owner.login,
    repo_id: String(githubRepository.id),
    repo_name: githubRepository.name,
  });
  const repoConnectionUuid = connection?.repo_connection_uuid;
  if (!repoConnectionUuid) throw new Error("Cloudflare did not return repo_connection_uuid.");

  const payload = triggerPayload(worker.tag, repoConnectionUuid, buildToken.build_token_uuid);
  const trigger = existing
    ? await request("PATCH", `/accounts/${accountId}/builds/triggers/${existing.trigger_uuid}`, payload)
    : await request("POST", `/accounts/${accountId}/builds/triggers`, payload);
  const triggerUuid = trigger?.trigger_uuid ?? existing?.trigger_uuid;
  if (!triggerUuid) throw new Error("Cloudflare did not return trigger_uuid.");

  await request("PATCH", `/accounts/${accountId}/builds/triggers/${triggerUuid}/environment_variables`, variables);
  console.log(`[ok] ${existing ? "updated" : "created"} production trigger`);
  await configurePagesWatchPaths();
  if (!existing) {
    const build = await request("POST", `/accounts/${accountId}/builds/triggers/${triggerUuid}/builds`, { branch: "main" });
    console.log(`[ok] started first build${build?.build_uuid ? `: ${build.build_uuid}` : ""}`);
  }
  console.log("[ok] Workers Builds is ready; future pushes to main deploy automatically");
};

setup().catch((error) => {
  console.error(`[fail] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
