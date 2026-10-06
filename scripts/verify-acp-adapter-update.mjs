import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { createAcpAdapterManager, MAX_ARCHIVE_BYTES, MAX_EXTRACTED_BYTES } from "../apps/desktop/src/main/acp-adapter-manager.mjs";

export async function runAcpAdapterCrossVersionVerification({ silent = false } = {}) {
  const log = (...args) => { if (!silent) console.log(...args); };
  const root = mkdtempSync(path.join(tmpdir(), "edgeever-acp-update-verify-"));

  try {
    log("=================================================================");
    log("ACP Adapter Installer Real Cross-Version Verification");
    log("=================================================================");

    const versionRoot = path.join(root, "antigravity");
    const oldVersionDir = path.join(versionRoot, "1.2.1");
    const ancientVersionDir = path.join(versionRoot, "1.1.0");
    const orphanedStageDir = path.join(versionRoot, ".stage-legacy-orphaned");

    await mkdir(oldVersionDir, { recursive: true });
    await mkdir(ancientVersionDir, { recursive: true });
    await mkdir(orphanedStageDir, { recursive: true });

    const oldBinary = path.join(oldVersionDir, "agy_acp_server.par");
    const ancientBinary = path.join(ancientVersionDir, "agy_acp_server.par");
    await writeFile(oldBinary, "#!/bin/sh\necho old-1.2.1", { mode: 0o700 });
    await writeFile(ancientBinary, "#!/bin/sh\necho ancient-1.1.0", { mode: 0o700 });
    await writeFile(path.join(root, "installed.json"), JSON.stringify({ antigravity: { version: "1.2.1" } }), { mode: 0o600 });

    log("[1/5] Initialized store with legacy Antigravity v1.2.1, older v1.1.0, and orphaned stage.");

    const newZipBytes = zipSync({
      "agy_acp_server.par": [new TextEncoder().encode("#!/bin/sh\necho new-1.3.0"), { level: 1 }],
      localharness_external: [new Uint8Array([42]), { level: 1 }],
    });

    const registryEntry = {
      id: "antigravity-acp",
      version: "1.3.0",
      distribution: { binary: { "linux-x86_64": {
        archive: "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.3.0-linux-x86_64.zip",
        cmd: "./agy_acp_server.par",
        args: ["--uid="],
      } } },
    };

    let downloadBytesCounted = 0;
    const manager = createAcpAdapterManager({
      root,
      platform: "linux",
      arch: "x64",
      fetchImpl: async (url) => {
        if (url.endsWith(".zip")) {
          // Real-world Antigravity v1.3.0 Linux package is ~334 MiB (> 300 MiB old cap)
          return new Response(new ReadableStream({
            start(controller) {
              downloadBytesCounted += newZipBytes.length;
              controller.enqueue(newZipBytes);
              controller.close();
            },
          }), {
            status: 200,
            headers: { "content-length": String(334 * 1024 * 1024) },
          });
        }
        return new Response(JSON.stringify({ agents: [registryEntry] }), { status: 200 });
      },
    });

    // Verify initial detection
    const initial = manager.get("antigravity");
    assert.equal(initial?.version, "1.2.1", "Initial version must be 1.2.1");
    assert.equal(initial?.command.command, oldBinary, "Initial binary path mismatch");

    // Phase 2: Failed update simulation
    let failedThrew = false;
    try {
      await manager.install("antigravity", async () => ({
        state: "failed",
        detail: "simulated_handshake_failure",
      }), { updateOnly: true });
    } catch (error) {
      failedThrew = true;
      assert.equal(error?.message, "simulated_handshake_failure");
    }
    assert.ok(failedThrew, "Staged failure must reject the install promise");
    assert.equal(manager.get("antigravity")?.version, "1.2.1", "Failed update must retain v1.2.1");
    assert.ok(existsSync(oldBinary), "Old binary must remain intact on failed update");
    const stagesAfterFailure = (await readdir(versionRoot)).filter((name) => name.startsWith(".stage-1.3.0"));
    assert.equal(stagesAfterFailure.length, 0, "Staged directory must be cleaned up on failure");
    log("[2/5] Verified rollback protection: failed update retained v1.2.1 without leaving stage artifacts.");

    // Phase 3: Successful cross-version upgrade to 1.3.0
    const updateResult = await manager.install("antigravity", async (command) => {
      assert.ok(command.command.includes(".stage-1.3.0"), "Validation must inspect staged command");
      assert.deepEqual(command.args, ["--uid="]);
      return { state: "available", promptCapabilities: { image: true } };
    }, { updateOnly: true });

    assert.equal(updateResult.updated, true, "Update result must report updated: true");
    assert.equal(updateResult.version, "1.3.0", "Updated version must be 1.3.0");

    const updated = manager.get("antigravity");
    assert.equal(updated?.version, "1.3.0", "Manager must report active version 1.3.0");
    const newBinary = path.join(versionRoot, "1.3.0", "agy_acp_server.par");
    assert.equal(updated?.command.command, newBinary, "Active binary path must point to 1.3.0");
    assert.ok(existsSync(newBinary), "New binary must exist");
    assert.ok(existsSync(oldBinary), "Old binary must be preserved alongside new version for fallback");

    const manifestState = JSON.parse(await readFile(path.join(root, "installed.json"), "utf8"));
    assert.equal(manifestState.antigravity?.version, "1.3.0", "installed.json must record 1.3.0");
    log("[3/5] Verified cross-version upgrade to 1.3.0: atomic migration, state persistence, and old version retention.");

    // Phase 4: Stage cleanup and version pruning
    const orphanedStage2 = path.join(versionRoot, ".stage-uninstalled-adapter");
    await mkdir(orphanedStage2, { recursive: true });

    await manager.prune();
    assert.ok(existsSync(path.join(versionRoot, "1.3.0")), "Current version 1.3.0 must be retained");
    assert.ok(existsSync(path.join(versionRoot, "1.2.1")), "Previous fallback version 1.2.1 must be retained");
    assert.ok(!existsSync(ancientVersionDir), "Ancient version 1.1.0 must be pruned");
    assert.ok(!existsSync(orphanedStageDir), "Orphaned stage dir must be pruned");
    assert.ok(!existsSync(orphanedStage2), "Orphaned stage dir from uninstalled state must be pruned");
    log("[4/5] Verified prune lifecycle: cleaned older version and orphaned stages while keeping 1.3.0 and 1.2.1.");

    // Phase 5: Size limit boundary enforcement
    assert.equal(MAX_ARCHIVE_BYTES, 500 * 1024 * 1024, "MAX_ARCHIVE_BYTES must be 500 MiB");
    assert.equal(MAX_EXTRACTED_BYTES, 2 * 1024 * 1024 * 1024, "MAX_EXTRACTED_BYTES must be 2 GiB");
    log("[5/5] Verified size caps: 500 MiB archive cap and 2 GiB extracted cap verified.");

    log("=================================================================");
    log("ACP Adapter Installer Cross-Version Verification: ALL PASSED");
    log("=================================================================");
    return true;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.main || process.argv[1] === new URL(import.meta.url).pathname) {
  runAcpAdapterCrossVersionVerification()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("[acp-adapter-update-verify] FAILED:", error);
      process.exit(1);
    });
}
