import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const workflow = readFileSync(new URL("../.github/workflows/desktop-build.yml", import.meta.url), "utf8");
const mobileWorkflow = readFileSync(new URL("../.github/workflows/mobile-build.yml", import.meta.url), "utf8");
const desktopPackageVerifier = readFileSync(new URL("./verify-desktop-package.mjs", import.meta.url), "utf8");
const packagedStartupVerifier = readFileSync(new URL("./verify-packaged-desktop-startup.mjs", import.meta.url), "utf8");
const cargoConfig = readFileSync(new URL("../.cargo/config.toml", import.meta.url), "utf8");

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = workflow.indexOf("\n      - name: ", start + 1);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

describe("desktop release workflow", () => {
  test("gates Draft release assets on the full project suite in Ubuntu", () => {
    expect(mobileWorkflow).toContain("github.repository == 'tianma-if/edgeever'");
    expect(mobileWorkflow).toContain("name: Plan Android release asset\n    runs-on: ubuntu-latest");
    const regressionTests = mobileWorkflow.indexOf("      - name: Run full project regression tests\n        run: bun run test");
    const releasePlan = mobileWorkflow.indexOf("      - name: Compare with previous formal release");
    expect(regressionTests).toBeGreaterThanOrEqual(0);
    expect(regressionTests).toBeLessThan(releasePlan);
    expect(workflow).toContain('gh release view "$CURRENT_TAG"');
    expect(mobileWorkflow).toContain('gh release view "$CURRENT_TAG"');
    expect(workflow).not.toContain('releases/tags/${CURRENT_TAG}');
    expect(mobileWorkflow).not.toContain('releases/tags/${CURRENT_TAG}');
  });

  test("rejects a published APK that is not Play-signed and restores Draft state", () => {
    expect(mobileWorkflow).toContain("github.event_name == 'release' && secrets.ANDROID_PLAY_APP_SIGNER_SHA256");
    expect(mobileWorkflow).toContain('gh release edit "$CURRENT_TAG" --repo "$GITHUB_REPOSITORY" --draft=true');
  });

  test("assigns shared validation only to the arm64 matrix job", () => {
    expect(workflow).toContain([
      "          - arch: arm64",
      "            runner: macos-15",
      "            shared_validation: true",
    ].join("\n"));
    expect(workflow).toContain([
      "          - arch: x64",
      "            runner: macos-15-intel",
      "            shared_validation: false",
    ].join("\n"));
  });

  test("runs architecture-independent checks once", () => {
    for (const name of [
      "Cache Bun dependencies for shared validation",
      "Verify Web precache budget",
      "Run project type checks",
      "Build debug sidecar for integration tests",
      "Run desktop regression tests",
      "Verify packaged renderer startup",
      "Validate Rust sidecar",
    ]) {
      expect(step(name)).toContain("        if: matrix.shared_validation\n");
    }
  });

  test("still builds and verifies each architecture-specific installer", () => {
    expect(step("Build architecture-specific Rust sidecar")).not.toContain("if: matrix.shared_validation");
    expect(step("Package desktop installer")).not.toContain("if: matrix.shared_validation");
    expect(step("Package desktop installer")).toContain("EDGE_EVER_DESKTOP_ARCH: ${{ matrix.arch }}");
    expect(step("Verify desktop installer")).not.toContain("if: matrix.shared_validation");
  });

  test("reports timings after builds without instrumenting native build steps", () => {
    expect(workflow).toContain("name: Report desktop build timings");
    expect(workflow).toContain("--platform desktop");
    expect(workflow).toContain("name: edgeever-desktop-build-timings");
    expect(mobileWorkflow).toContain("name: Report Android build timings");
    expect(mobileWorkflow).toContain("--platform android");
    expect(mobileWorkflow).toContain("name: edgeever-android-build-timings");
    expect(mobileWorkflow).not.toContain("Build signed release APK for GitHub Release\n        run: time");
  });

  test("builds an unsigned Windows x64 Preview and audits its signed update metadata", () => {
    expect(workflow).toContain("name: Windows x64 unsigned Preview");
    expect(workflow).toContain("EDGE_EVER_DESKTOP_TARGET: win");
    expect(workflow).toContain("Get-AuthenticodeSignature");
    expect(workflow).toContain("create-windows-update-metadata.mjs");
    expect(workflow).toContain("allow-missing-windows-signature");
    expect(workflow).toContain("name: Audit signed Windows update");
    expect(workflow).toContain("verify-windows-update-release.mjs");
    expect(workflow).toContain("name: Run packaged Windows sidecar integration tests");
    expect(workflow).toContain("name: Verify packaged Windows first launch");
    expect(workflow).toContain("verify:packaged-desktop-startup");
    expect(packagedStartupVerifier).toContain('new Set(["sidecar.ready", "renderer.bootstrap-ready"])');
    expect(desktopPackageVerifier).toContain("isVisualCppRuntimeDll");
    expect(cargoConfig).toContain('target.x86_64-pc-windows-msvc');
    expect(cargoConfig).toContain('target-feature=+crt-static');
    expect(desktopPackageVerifier).toContain(
      'path.replaceAll("\\\\", "/")',
    );
  });
});
