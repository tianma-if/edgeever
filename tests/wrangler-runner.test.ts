import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import {
  buildLocalDevEnvironmentFile,
  buildWranglerInvocation,
  buildWranglerEnvironment,
  buildWranglerSpawnOptions,
  deployedWorkerSettings,
  findD1DatabaseIdByName,
  isD1MigrationApplyCommand,
  normalizeD1MigrationSql,
  productionVersionIds,
  LOCAL_DEV_CREDENTIALS_ENCRYPTION_KEY,
  resolveWranglerAssetsDirectory,
  resolveWranglerCliPath,
  resolveWranglerRuntimeExecutable,
  runWranglerSync,
} from "../scripts/wrangler-runner.mjs";

describe("cross-platform Wrangler runner", () => {
  test("uses the installed JavaScript CLI instead of a platform shell shim", () => {
    const invocation = buildWranglerInvocation(["--version"], {
      cwd: process.cwd(),
      runtimeExecutable: process.execPath,
    });

    expect(invocation.executable).toBe(process.execPath);
    expect(invocation.args).toEqual([resolveWranglerCliPath(process.cwd()), "--version"]);
    expect(invocation.args[0]).toEndWith(["node_modules", "wrangler", "bin", "wrangler.js"].join(sep));
    expect(invocation.args[0]).not.toEndWith("wrangler.cmd");
  });

  test("runs the project-local Wrangler without a global installation", () => {
    const result = runWranglerSync(["--version"], { cwd: process.cwd(), encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("runs Wrangler with Node when the project command itself uses Bun", () => {
    expect(resolveWranglerRuntimeExecutable()).toBe(process.versions.bun ? "node" : process.execPath);
  });

  test("forces D1 migration apply into non-interactive CI mode", () => {
    const args = ["--config", "generated.toml", "d1", "migrations", "apply", "DB", "--remote"];

    expect(isD1MigrationApplyCommand(args)).toBe(true);
    expect(buildWranglerEnvironment(args, { EXISTING: "value" })).toMatchObject({
      EXISTING: "value",
      CI: "true",
    });
    expect(buildWranglerEnvironment(["d1", "migrations", "list", "DB"], {})).not.toHaveProperty("CI");
    expect(buildWranglerSpawnOptions(args, { stdio: "inherit" })).toEqual({
      input: "y\n",
      stdio: ["pipe", "inherit", "inherit"],
    });
  });

  test("normalizes Windows migration line endings for remote D1", () => {
    expect(normalizeD1MigrationSql("CREATE TABLE demo (id TEXT);\r\n\r\nSELECT 1;\r")).toBe(
      "CREATE TABLE demo (id TEXT);\n\nSELECT 1;\n",
    );
  });

  test("gives local development an isolated credential encryption key", () => {
    const envFile = buildLocalDevEnvironmentFile();

    expect(LOCAL_DEV_CREDENTIALS_ENCRYPTION_KEY.length).toBeGreaterThanOrEqual(32);
    expect(envFile).toContain(
      `EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY=${LOCAL_DEV_CREDENTIALS_ENCRYPTION_KEY}`,
    );
    expect(envFile).not.toContain("EDGE_EVER_AUTH_PASSWORD=");
    expect(envFile).not.toContain("EDGE_EVER_AUTH_PASSWORD_HASH=");
  });

  test("resolves the configured assets directory so local dev can create it", () => {
    const config = '[vars]\ndirectory = "wrong"\n\n[assets]\ndirectory = "public"\n';

    expect(resolveWranglerAssetsDirectory(config, "/repo")).toBe(resolve("/repo", "public"));
    expect(resolveWranglerAssetsDirectory('name = "x"\n', "/repo")).toBeNull();
  });

  test("prepares missing dev assets before Wrangler starts and preserves existing files", () => {
    const workingDirectory = mkdtempSync(resolve(tmpdir(), "edgeever-dev-assets-"));
    const assetsDirectory = resolve(workingDirectory, "custom-assets", "dist");
    const configPath = resolve(workingDirectory, "custom.toml");
    const cliDirectory = resolve(workingDirectory, "node_modules", "wrangler", "bin");
    const env = Object.fromEntries(
      ["PATH", "Path", "PATHEXT", "SystemRoot", "ComSpec", "TEMP", "TMP"]
        .map((name) => [name, process.env[name]])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const run = (...args: string[]) => spawnSync(
      "node",
      [resolve(import.meta.dir, "../scripts/run-wrangler.mjs"), ...args],
      {
        cwd: workingDirectory,
        encoding: "utf8",
        env: { ...env, WRANGLER_CONFIG: configPath },
      },
    );

    try {
      mkdirSync(cliDirectory, { recursive: true });
      writeFileSync(configPath, 'name = "dev-assets-test"\n[assets]\ndirectory = "custom-assets/dist"\n');
      writeFileSync(resolve(cliDirectory, "wrangler.js"), [
        'const { statSync } = require("node:fs");',
        'if (process.argv.includes("dev") && !statSync("custom-assets/dist").isDirectory()) process.exit(1);',
      ].join("\n"));

      // Non-dev commands must not manufacture a missing build directory.
      const nonDev = run("d1", "execute", "DB", "--local", "--command", "SELECT 1");
      expect(nonDev.error).toBeUndefined();
      expect(nonDev.status).toBe(0);
      expect(existsSync(assetsDirectory)).toBe(false);

      const firstStart = run("dev", "--local");
      expect(firstStart.error).toBeUndefined();
      expect(firstStart.status).toBe(0);
      expect(existsSync(assetsDirectory)).toBe(true);

      const existingAsset = resolve(assetsDirectory, "index.html");
      writeFileSync(existingAsset, "existing build must survive dev startup");
      const secondStart = run("dev", "--local");
      expect(secondStart.status).toBe(0);
      expect(readFileSync(existingAsset, "utf8")).toBe("existing build must survive dev startup");
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  test("resolves an exact D1 database name from Wrangler JSON", () => {
    const databases = JSON.stringify([
      { uuid: "11111111-1111-1111-1111-111111111111", name: "another-database" },
      { uuid: "22222222-2222-2222-2222-222222222222", name: "edgeever" },
    ]);

    expect(findD1DatabaseIdByName(databases, "edgeever")).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
    expect(findD1DatabaseIdByName(databases, "EdgeEver")).toBeUndefined();
    expect(findD1DatabaseIdByName("[]", "edgeever")).toBeUndefined();
  });

  test("rejects malformed D1 database list output", () => {
    expect(() => findD1DatabaseIdByName("not-json", "edgeever")).toThrow(
      "Wrangler returned invalid JSON",
    );
    expect(() => findD1DatabaseIdByName("{}", "edgeever")).toThrow(
      "Wrangler returned an unexpected response",
    );
  });

  test("reads active production versions and legacy deployment settings", () => {
    expect(productionVersionIds(JSON.stringify({
      versions: [
        { version_id: "version-old", percentage: 10 },
        { version_id: "version-current", percentage: 90 },
        { version_id: "version-inactive", percentage: 0 },
      ],
    }))).toEqual(["version-current", "version-old"]);

    expect(deployedWorkerSettings(JSON.stringify({
      resources: {
        bindings: [
          { name: "RESOURCES", type: "r2_bucket", bucket_name: "my-old-edgeever-bucket" },
          { name: "EDGE_EVER_AUTH_USERNAME", type: "plain_text", text: "owner" },
        ],
      },
    }))).toEqual({
      r2BucketName: "my-old-edgeever-bucket",
      authUsername: "owner",
      sessionTtlDays: undefined,
      authSecretNames: [],
    });
  });

  test("rejects malformed Worker deployment responses", () => {
    expect(() => productionVersionIds("[]")).toThrow("unexpected response");
    expect(() => deployedWorkerSettings("not-json")).toThrow("invalid JSON");
    expect(() => deployedWorkerSettings(JSON.stringify({ resources: {} }))).toThrow(
      "unexpected response",
    );
  });

  test("keeps every D1 trigger on one physical line for remote compatibility", () => {
    const migrationSql = globSync(resolve("migrations", "*.sql"))
      .sort()
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const triggerLines = migrationSql
      .split("\n")
      .filter((line) => line.startsWith("CREATE TRIGGER "));

    expect(triggerLines).toHaveLength(43);
    for (const triggerLine of triggerLines) {
      expect(triggerLine).toEndWith(" END;");
    }
  });

  test("opts in to the Cloudflare IMAGES binding only when EDGE_EVER_CLOUDFLARE_IMAGES=true", () => {
    const workingDirectory = mkdtempSync(resolve(tmpdir(), "edgeever-images-binding-"));
    const configPath = resolve(workingDirectory, "custom.toml");
    const cliDirectory = resolve(workingDirectory, "node_modules", "wrangler", "bin");
    const baseEnv = Object.fromEntries(
      ["PATH", "Path", "PATHEXT", "SystemRoot", "ComSpec", "TEMP", "TMP"]
        .map((name) => [name, process.env[name]])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const runWithEnv = (extraEnv: Record<string, string>) => spawnSync(
      "node",
      [resolve(import.meta.dir, "../scripts/run-wrangler.mjs"), "--version"],
      {
        cwd: workingDirectory,
        encoding: "utf8",
        env: { ...baseEnv, WRANGLER_CONFIG: configPath, ...extraEnv },
      },
    );

    try {
      mkdirSync(cliDirectory, { recursive: true });
      writeFileSync(configPath, 'name = "images-test"\n');
      writeFileSync(resolve(cliDirectory, "wrangler.js"), "process.exit(0);\n");

      const withoutImages = runWithEnv({ EDGE_EVER_CLOUDFLARE_IMAGES: "false" });
      expect(withoutImages.status).toBe(0);
      expect(readFileSync(resolve(workingDirectory, ".wrangler.generated.toml"), "utf8")).not.toContain("[images]");

      const withImages = runWithEnv({ EDGE_EVER_CLOUDFLARE_IMAGES: "true" });
      expect(withImages.status).toBe(0);
      const generated = readFileSync(resolve(workingDirectory, ".wrangler.generated.toml"), "utf8");
      expect(generated).toContain('[images]\nbinding = "IMAGES"');

      const invalidImages = runWithEnv({ EDGE_EVER_CLOUDFLARE_IMAGES: "yes" });
      expect(invalidImages.status).not.toBe(0);
      expect(invalidImages.stderr).toContain("EDGE_EVER_CLOUDFLARE_IMAGES must be true or false.");
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });
});
