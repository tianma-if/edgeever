import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Script, runInNewContext } from "node:vm";
import { expect, test } from "bun:test";
import { macAppBundle, MAC_UPDATE_FIXTURE_NAME } from "./native-update-macos.mjs";
import { backgroundNodeExecutable } from "../apps/desktop/src/main/background-node.mjs";
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

// This JavaScript is sent to a real application, so template escaping
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

test("macOS fixture bundle discovery honors executableName and rejects ambiguity", () => {
  const directory = mkdtempSync(join(tmpdir(), "edgeever-bundle-name-"));
  try {
    mkdirSync(join(directory, "EdgeEverUpdateVerifier.app"));
    writeFileSync(join(directory, "not-a-bundle.app"), "not a directory");
    expect(macAppBundle(directory)).toBe(join(directory, "EdgeEverUpdateVerifier.app"));
    mkdirSync(join(directory, "Another.app"));
    expect(() => macAppBundle(directory)).toThrow("exactly one");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("macOS fixture identity satisfies the actual product background Helper lookup", () => {
  const directory = mkdtempSync(join(tmpdir(), "edgeever-helper-invariant-"));
  try {
    const contents = join(directory, MAC_UPDATE_FIXTURE_NAME + ".app", "Contents");
    const executable = join(contents, "MacOS", MAC_UPDATE_FIXTURE_NAME);
    const helperName = MAC_UPDATE_FIXTURE_NAME + " Helper";
    const helper = join(contents, "Frameworks", helperName + ".app", "Contents", "MacOS", helperName);
    mkdirSync(join(contents, "MacOS"), { recursive: true });
    mkdirSync(join(contents, "Frameworks", helperName + ".app", "Contents", "MacOS"), { recursive: true });
    writeFileSync(helper, "fixture");
    chmodSync(helper, 0o755);
    expect(backgroundNodeExecutable(executable, "darwin")).toBe(helper);
    const builder = readFileSync(new URL("./build-native-update-fixtures.mjs", import.meta.url), "utf8");
    expect(builder).toContain('productName: process.platform === "darwin" ? MAC_UPDATE_FIXTURE_NAME');
    expect(builder).toContain('executableName: MAC_UPDATE_FIXTURE_NAME');
    expect(builder).toContain('assertMacFixtureRuntime(macAppBundle(');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
