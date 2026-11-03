import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { expect, test } from "bun:test";
import { instrumentNativeUpdateMain } from "./native-update-instrumentation.mjs";

const main = readFileSync(new URL("../apps/desktop/src/main/index.mjs", import.meta.url), "utf8");
test("instruments the actual current EdgeEver entry without changing its update controller", () => {
  const instrumented = instrumentNativeUpdateMain(main, "/tmp/native-update-config.json");
  const directory = mkdtempSync(join(tmpdir(), "edgeever-native-update-syntax-"));
  try {
    const path = join(directory, "index.mjs");
    writeFileSync(path, instrumented);
    const result = spawnSync("node", ["--check", path], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(instrumented).toContain('createDesktopUpdateController({');
    expect(instrumented).toContain('verifierLog("ready", { version, runningVersion: app.getVersion() })');
    expect(instrumented).toContain('app.setPath("userData", process.env.EDGE_EVER_UPDATE_VERIFIER_PROFILE)');
    expect(instrumented).not.toContain('await confirmMacInstallation()');
    expect(main).not.toContain('native-update-verifier.mjs');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("fails closed if a product integration site moves or appears twice", () => {
  expect(() => instrumentNativeUpdateMain(main.replace('    onDownloaded: (version) => {', '    onDownloaded: async (version) => {'))).toThrow("exactly one");
  expect(() => instrumentNativeUpdateMain(main + '\n  desktopUpdateController = createDesktopUpdateController({')).toThrow("exactly one");
});

test("the installer workflow is official-only, manual, and never publishes assets", () => {
  const workflow = readFileSync(new URL("../.github/workflows/desktop-update-verification.yml", import.meta.url), "utf8");
  expect(workflow).toContain("if: github.repository == 'tianma-if/edgeever'");
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).not.toContain("contents: write");
  expect(workflow).not.toContain("release_tag");
  const matrices = [...workflow.matchAll(/'(\[\{.*?\}\])'/g)].map((match) => JSON.parse(match[1]));
  expect(matrices).toHaveLength(3);
  expect(matrices[0].map((entry) => entry.runner)).toEqual(["windows-latest"]);
  expect(matrices[1].map((entry) => entry.runner)).toEqual(["macos-15", "macos-15-intel"]);
  expect(matrices[2].map((entry) => entry.runner)).toEqual(["macos-15", "macos-15-intel", "windows-latest", "ubuntu-22.04"]);
});
