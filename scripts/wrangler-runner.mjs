import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  ...(isD1MigrationApplyCommand(args) ? { CI: "true" } : {}),
});

export const normalizeD1MigrationSql = (sql) => sql.replace(/\r\n?/g, "\n");

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
