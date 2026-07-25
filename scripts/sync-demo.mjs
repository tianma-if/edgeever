import { spawnSync } from "node:child_process";

const REPOSITORY = "tianma-if/edgeever";
const WORKFLOW = "deploy-demo.yml";
const DEFAULT_DEMO_URL = "https://demo.edgeever.org";
const DEFAULT_DEMO_USERNAME = "ee-demo";
const DEFAULT_DEMO_PASSWORD = "demo#dZ6Q29Zjfor%";
const RUN_DISCOVERY_ATTEMPTS = 30;
const RUN_DISCOVERY_INTERVAL_MS = 2_000;

const usage = `Usage:
  bun run demo:sync
  bun run demo:sync -- --dry-run

Deploys the pushed main commit through the Demo GitHub Actions workflow, resets
the public Demo workspace to that commit's seed data, and verifies the overview
memo. It does not create a tag or Release. The command requires an authenticated
GitHub CLI.

Optional environment overrides:
  EDGE_EVER_DEMO_URL
  EDGE_EVER_DEMO_USERNAME
  EDGE_EVER_DEMO_PASSWORD`;

export const parseSyncDemoArgs = (args) => {
  let dryRun = false;
  let help = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, help };
};

const run = (executable, args, options = {}) => {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    env: process.env,
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${executable} exited with status ${result.status ?? 1}.`);
  }

  return options.capture ? result.stdout.trim() : "";
};

const runJson = (executable, args) => {
  const output = run(executable, args, { capture: true });
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Unable to parse JSON output from ${executable} ${args.join(" ")}.`);
  }
};

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const assertRepositoryState = () => {
  const branch = run("git", ["branch", "--show-current"], { capture: true });
  if (branch !== "main") {
    throw new Error(`Demo sync must run on main; current branch is ${branch || "(detached)"}.`);
  }

  const status = run("git", ["status", "--porcelain"], { capture: true });
  if (status) {
    throw new Error("Demo sync requires a clean working tree. Commit or stash local changes first.");
  }

  run("git", ["fetch", "origin", "main"]);
  const headSha = run("git", ["rev-parse", "HEAD"], { capture: true });
  const remoteSha = run("git", ["rev-parse", "origin/main"], { capture: true });
  if (headSha !== remoteSha) {
    throw new Error(
      `Local main (${headSha.slice(0, 12)}) does not match origin/main (${remoteSha.slice(0, 12)}). Push or update main first.`,
    );
  }

  run("gh", ["auth", "status"]);
  const repository = runJson("gh", ["repo", "view", REPOSITORY, "--json", "nameWithOwner"]);
  if (repository.nameWithOwner !== REPOSITORY) {
    throw new Error(`GitHub repository is unavailable: ${REPOSITORY}.`);
  }

  return headSha;
};

const listWorkflowRuns = () =>
  runJson("gh", [
    "run",
    "list",
    "--repo",
    REPOSITORY,
    "--workflow",
    WORKFLOW,
    "--event",
    "workflow_dispatch",
    "--branch",
    "main",
    "--limit",
    "20",
    "--json",
    "databaseId,headSha,status,conclusion,url,createdAt",
  ]);

const dispatchDeployment = async (headSha) => {
  const previousRunIds = new Set(listWorkflowRuns().map((workflowRun) => workflowRun.databaseId));

  run("gh", [
    "workflow",
    "run",
    WORKFLOW,
    "--repo",
    REPOSITORY,
    "--ref",
    "main",
  ]);

  for (let attempt = 0; attempt < RUN_DISCOVERY_ATTEMPTS; attempt += 1) {
    const workflowRun = listWorkflowRuns().find(
      (candidate) => candidate.headSha === headSha && !previousRunIds.has(candidate.databaseId),
    );
    if (workflowRun) {
      return workflowRun;
    }
    await sleep(RUN_DISCOVERY_INTERVAL_MS);
  }

  throw new Error("Timed out while waiting for the Demo deployment workflow run to appear.");
};

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message || body?.message || response.statusText;
    throw new Error(`Demo API request failed (${response.status}): ${message}`);
  }
  return body;
};

const resetAndVerifyDemo = async () => {
  const demoUrl = (process.env.EDGE_EVER_DEMO_URL || DEFAULT_DEMO_URL).replace(/\/+$/, "");
  const username = process.env.EDGE_EVER_DEMO_USERNAME || DEFAULT_DEMO_USERNAME;
  const password = process.env.EDGE_EVER_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;

  const session = await requestJson(`${demoUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!session?.sessionToken) {
    throw new Error("Demo login succeeded without returning a session token.");
  }

  const authorization = { Authorization: `Bearer ${session.sessionToken}` };
  await requestJson(`${demoUrl}/api/v1/demo/reset`, {
    method: "POST",
    headers: authorization,
  });

  const response = await requestJson(`${demoUrl}/api/v1/memos/memo_demo_overview`, {
    headers: authorization,
  });
  const memo = response.memo ?? response;
  if (memo.id !== "memo_demo_overview" || !memo.title || !memo.contentMarkdown) {
    throw new Error("Demo overview memo verification returned incomplete data.");
  }

  return {
    demoUrl,
    title: memo.title,
    updatedAt: memo.updatedAt,
  };
};

const main = async () => {
  let options;
  try {
    options = parseSyncDemoArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage);
    process.exit(1);
  }

  if (options.help) {
    console.log(usage);
    return;
  }

  if (options.dryRun) {
    console.log("[dry-run] validate clean, pushed main and GitHub CLI authentication");
    console.log(`[dry-run] dispatch ${WORKFLOW} on ${REPOSITORY}@main and wait for success`);
    console.log("[dry-run] reset the public Demo workspace from the deployed seed");
    console.log("[dry-run] verify memo_demo_overview through the Demo API");
    return;
  }

  console.log("[1/4] Validating repository and GitHub access...");
  const headSha = assertRepositoryState();
  console.log(`[ok] main is clean and pushed at ${headSha.slice(0, 12)}`);

  console.log("[2/4] Dispatching the Demo deployment workflow...");
  const workflowRun = await dispatchDeployment(headSha);
  console.log(`[ok] workflow run: ${workflowRun.url}`);

  console.log("[3/4] Waiting for the Demo deployment...");
  run("gh", [
    "run",
    "watch",
    String(workflowRun.databaseId),
    "--repo",
    REPOSITORY,
    "--exit-status",
  ]);

  console.log("[4/4] Resetting and verifying Demo seed data...");
  const verification = await resetAndVerifyDemo();
  console.log(`[ok] ${verification.title}`);
  console.log(`[ok] updated at ${verification.updatedAt}`);
  console.log(`Demo seed synchronized: ${verification.demoUrl}`);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
