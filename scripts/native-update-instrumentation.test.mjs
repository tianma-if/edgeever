import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Script, runInNewContext } from "node:vm";
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

// This JavaScript is sent to a paused real application, so template escaping
// must be checked independently of the outer verifier script's syntax.
test("official bridge debugger bootstrap compiles for old/new and Windows paths", () => {
  const source = readFileSync(new URL("./verify-native-release-bridge.mjs", import.meta.url), "utf8");
  const start = source.indexOf("  const expression = `");
  const end = source.indexOf('  const evaluated = await send("Runtime.evaluate"', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  for (const update of [false, true]) {
    const context = { profile: "D:\\a\\_temp\\profile", evidence: "D:\\a\\_temp\\evidence", update, version: "2.18.0", feed: "http://127.0.0.1:1234/", join, console: { log() {} } };
    const expression = runInNewContext(`${source.slice(start, end)}; expression`, context);
    expect(() => new Script(expression)).not.toThrow();
  }
});
