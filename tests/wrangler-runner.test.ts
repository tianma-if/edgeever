import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
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

    expect(triggerLines).toHaveLength(12);
    for (const triggerLine of triggerLines) {
      expect(triggerLine).toEndWith(" END;");
    }
  });
});
