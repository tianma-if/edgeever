#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  edgeEverDeploymentEnvironment,
  shouldRunEdgeEverDeployment,
} from "../dispatch.mjs";

const args = process.argv.slice(2);
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const repositoryConfig = (() => {
  try {
    return readFileSync(resolve(repositoryRoot, "wrangler.toml"), "utf8");
  } catch {
    return "";
  }
})();

const run = (executable, commandArgs, options = {}) => {
  const result = spawnSync(executable, commandArgs, {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
};

if (shouldRunEdgeEverDeployment(args, process.env, repositoryConfig)) {
  console.error(
    "[info] Cloudflare used its default deploy command; routing it through EdgeEver's validated deployment pipeline.",
  );
  run("bun", ["run", "deploy"], {
    env: edgeEverDeploymentEnvironment(),
  });
}

const require = createRequire(import.meta.url);
const officialPackagePath = require.resolve("edgeever-wrangler-cli/package.json");
const officialCliPath = resolve(dirname(officialPackagePath), "bin/wrangler.js");
run("node", [officialCliPath, ...args], {
  env: {
    ...process.env,
    EDGE_EVER_WRANGLER_BYPASS_SHIM: "1",
  },
});
