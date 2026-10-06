import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { MAX_ARCHIVE_BYTES, MAX_EXTRACTED_BYTES, createAcpAdapterManager, managedAdapterCommand, selectAdapterRelease, selectPiAdapterRelease } from "./acp-adapter-manager.mjs";

const codexEntry = (version) => ({
  id: "codex-acp",
  version,
  distribution: { npx: { package: `@agentclientprotocol/codex-acp@${version}` } },
});

describe("managed ACP adapters", () => {
  test("accepts only the expected pi ACP npm package and retains the old adapter on a failed update", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "edgeever-managed-pi-"));
    let version = "0.0.34";
    const metadata = () => ({ name: "pi-acp", version, bin: { "pi-acp": "dist/index.js" } });
    expect(selectPiAdapterRelease(metadata()).packageName).toBe("pi-acp@0.0.34");
    expect(() => selectPiAdapterRelease({ ...metadata(), name: "other-package" })).toThrow("unsupported_release");
    expect(() => selectPiAdapterRelease({ ...metadata(), version: "0.1.0" })).toThrow("unsupported_release");
    const manager = createAcpAdapterManager({
      root,
      executablePath: "/usr/bin/node",
      fetchImpl: async () => new Response(JSON.stringify(metadata()), { status: 200 }),
      installNpmImpl: async (args, stage) => {
        expect(args).toContain(`pi-acp@${version}`);
        const directory = path.join(stage, "node_modules", "pi-acp", "dist");
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "index.js"), "// fake ACP adapter");
      },
    });
    try {
      expect((await manager.install("piAgent", async () => ({ state: "available" }))).updated).toBe(true);
      expect(manager.get("piAgent")?.command.args[0].endsWith(path.join("pi-acp", "dist", "index.js"))).toBe(true);
      version = "0.0.35";
      await expect(manager.install("piAgent", async () => ({ state: "failed", detail: "handshake_failed" }), { updateOnly: true })).rejects.toThrow("handshake_failed");
      expect(manager.get("piAgent")?.version).toBe("0.0.34");
      expect((await manager.install("piAgent", async () => ({ state: "available" }), { updateOnly: true })).version).toBe("0.0.35");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("accepts only the supported official distribution and platform command", () => {
    expect(selectAdapterRelease([codexEntry("2.0.1")], "codex").version).toBe("2.0.1");
    expect(() => selectAdapterRelease([{ ...codexEntry("2.0.1"), distribution: { npx: { package: "evil@2.0.1" } } }], "codex")).toThrow("unsupported_release");
    const entry = {
      id: "antigravity-acp",
      version: "1.2.1",
      distribution: { binary: { "darwin-aarch64": {
        archive: "https://dl.google.com/agy-extensions/releases/macos/test.zip",
        cmd: "./agy_acp_server.par",
      } } },
    };
    expect(selectAdapterRelease([entry], "antigravity", { platform: "darwin", arch: "arm64" }).kind).toBe("binary");
    entry.distribution.binary["linux-x86_64"] = {
      archive: "https://dl.google.com/agy-extensions/releases/linux/test.zip",
      cmd: "./agy_acp_server.par",
      args: ["--uid="],
    };
    expect(selectAdapterRelease([entry], "antigravity", { platform: "linux", arch: "x64" }).kind).toBe("binary");
    entry.distribution.binary["linux-x86_64"].args = [];
    expect(() => selectAdapterRelease([entry], "antigravity", { platform: "linux", arch: "x64" })).toThrow("unsupported_release");
    entry.distribution.binary["darwin-aarch64"].archive = "https://example.com/test.zip";
    expect(() => selectAdapterRelease([entry], "antigravity", { platform: "darwin", arch: "arm64" })).toThrow("unsupported_release");
  });

  test("keeps the previous version when a staged update fails the ACP handshake", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "edgeever-managed-acp-"));
    let release = "2.0.1";
    const manager = createAcpAdapterManager({
      root,
      platform: "darwin",
      arch: "arm64",
      executablePath: "/usr/bin/node",
      fetchImpl: async () => new Response(JSON.stringify({ agents: [codexEntry(release)] }), { status: 200 }),
      installNpmImpl: async (_args, stage) => {
        const directory = path.join(stage, "node_modules", "@agentclientprotocol", "codex-acp", "dist");
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "index.js"), "// fake agent");
      },
    });
    const valid = async () => ({ id: "codex", label: "Codex", state: "available" });
    try {
      expect((await manager.install("codex", valid)).updated).toBe(true);
      expect(manager.get("codex")?.version).toBe("2.0.1");
      expect(manager.installedIds()).toEqual(["codex"]);
      expect((await manager.install("codex", valid, { updateOnly: true })).updated).toBe(false);

      release = "2.0.2";
      await expect(manager.install("codex", async () => ({ state: "failed", detail: "handshake_failed" }), { updateOnly: true })).rejects.toThrow("handshake_failed");
      expect(manager.get("codex")?.version).toBe("2.0.1");
      expect(JSON.parse(await readFile(path.join(root, "installed.json"), "utf8")).codex.version).toBe("2.0.1");

      expect((await manager.install("codex", valid, { updateOnly: true })).updated).toBe(true);
      expect(manager.get("codex")?.version).toBe("2.0.2");
      expect(await readFile(path.join(root, "codex", "2.0.1", "node_modules", "@agentclientprotocol", "codex-acp", "dist", "index.js"), "utf8")).toBe("// fake agent");

      release = "2.0.3";
      expect((await manager.install("codex", valid, { updateOnly: true })).updated).toBe(true);
      await manager.prune();
      expect(existsSync(path.join(root, "codex", "2.0.1"))).toBe(false);
      expect(existsSync(path.join(root, "codex", "2.0.2"))).toBe(true);
      expect(manager.get("codex")?.version).toBe("2.0.3");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("extracts only expected Antigravity files and rejects archive traversal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "edgeever-managed-agy-"));
    let malicious = false;
    const entry = {
      id: "antigravity-acp",
      version: "1.2.1",
      distribution: { binary: { "darwin-aarch64": {
        archive: "https://dl.google.com/agy-extensions/releases/macos/test.zip",
        cmd: "./agy_acp_server.par",
      } } },
    };
    const manager = createAcpAdapterManager({
      root,
      platform: "darwin",
      arch: "arm64",
      fetchImpl: async () => new Response(JSON.stringify({ agents: [entry] }), { status: 200 }),
      downloadImpl: async (_url, destination) => {
        const files = malicious
          ? { "../outside": [new Uint8Array([1]), { level: 1 }] }
          : { "agy_acp_server.par": [new Uint8Array([1]), { level: 1 }], localharness_external: [new Uint8Array([2]), { level: 1 }] };
        await writeFile(destination, zipSync(files));
      },
    });
    try {
      malicious = true;
      await expect(manager.install("antigravity", async () => ({ state: "available" }))).rejects.toThrow("invalid_adapter_archive");
      expect(existsSync(path.join(root, "outside"))).toBe(false);
      malicious = false;
      expect((await manager.install("antigravity", async () => ({ state: "available" }))).updated).toBe(true);
      expect(manager.get("antigravity")?.version).toBe("1.2.1");
      expect(managedAdapterCommand(root, "antigravity", "1.2.1", { platform: "linux" })?.args).toEqual(["--uid="]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("updates an unauthenticated connector only when the previous version also needs login", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "edgeever-acp-login-update-"));
    let release = "2.0.1";
    const manager = createAcpAdapterManager({
      root,
      platform: "darwin",
      arch: "arm64",
      executablePath: "/usr/bin/node",
      fetchImpl: async () => new Response(JSON.stringify({ agents: [codexEntry(release)] }), { status: 200 }),
      installNpmImpl: async (_args, stage) => {
        const directory = path.join(stage, "node_modules", "@agentclientprotocol", "codex-acp", "dist");
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "index.js"), "// fake agent");
      },
    });
    try {
      await manager.install("codex", async () => ({ state: "needs_login" }));
      release = "2.0.2";
      await expect(manager.install("codex", async (command) => ({
        state: command.args[0].includes(".stage-") ? "needs_login" : "available",
      }), { updateOnly: true })).rejects.toThrow("adapter_probe_failed");
      expect(manager.get("codex")?.version).toBe("2.0.1");
      expect((await manager.install("codex", async () => ({ state: "needs_login" }), { updateOnly: true })).updated).toBe(true);
      expect(manager.get("codex")?.version).toBe("2.0.2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("prunes orphaned stage directories even when the adapter is uninstalled", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "edgeever-prune-orphaned-"));
    const stageDir = path.join(root, "antigravity", ".stage-1.3.0-12345-67890");
    await mkdir(stageDir, { recursive: true });
    const manager = createAcpAdapterManager({ root });
    expect(manager.get("antigravity")).toBeNull();
    try {
      await manager.prune();
      expect(existsSync(stageDir)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("configures archive and extracted size limits to 500 MiB and 2 GiB", () => {
    expect(MAX_ARCHIVE_BYTES).toBe(500 * 1024 * 1024);
    expect(MAX_EXTRACTED_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });

  test("updates binary ACP adapters from an older version to a larger newer version with staging and rollback protection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "edgeever-cross-version-agy-"));
    const versionRoot = path.join(root, "antigravity");
    const oldVersionDir = path.join(versionRoot, "1.2.1");
    const ancientVersionDir = path.join(versionRoot, "1.1.0");
    const orphanedStageDir = path.join(versionRoot, ".stage-1.2.0-orphaned");
    await mkdir(oldVersionDir, { recursive: true });
    await mkdir(ancientVersionDir, { recursive: true });
    await mkdir(orphanedStageDir, { recursive: true });

    const oldBinary = path.join(oldVersionDir, "agy_acp_server.par");
    const ancientBinary = path.join(ancientVersionDir, "agy_acp_server.par");
    await writeFile(oldBinary, "#!/bin/sh\necho old-1.2.1", { mode: 0o700 });
    await writeFile(ancientBinary, "#!/bin/sh\necho ancient-1.1.0", { mode: 0o700 });
    await writeFile(path.join(root, "installed.json"), JSON.stringify({ antigravity: { version: "1.2.1" } }), { mode: 0o600 });

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
          // Provide 334 MiB content-length header matching real Antigravity v1.3.0 Linux distribution (>300 MiB old cap)
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

    try {
      // 1. Initial state: verify old version 1.2.1 is recognized
      expect(manager.get("antigravity")?.version).toBe("1.2.1");
      expect(manager.get("antigravity")?.command.command).toBe(oldBinary);

      // 2. Failed update: staged validation fails handshake
      await expect(manager.install("antigravity", async () => ({
        state: "failed",
        detail: "handshake_failed",
      }), { updateOnly: true })).rejects.toThrow("handshake_failed");

      // Verify old version remains intact and active
      expect(manager.get("antigravity")?.version).toBe("1.2.1");
      expect(manager.get("antigravity")?.command.command).toBe(oldBinary);
      expect(JSON.parse(await readFile(path.join(root, "installed.json"), "utf8")).antigravity.version).toBe("1.2.1");
      expect(existsSync(oldBinary)).toBe(true);

      // Verify staged directory was cleanly purged on failure
      const intermediateNames = await readdir(versionRoot);
      expect(intermediateNames.some((name) => name.startsWith(".stage-1.3.0"))).toBe(false);

      // 3. Successful update: staged validation passes
      const updateResult = await manager.install("antigravity", async (command) => {
        expect(command.command).toContain(".stage-1.3.0");
        expect(command.args).toEqual(["--uid="]);
        return { state: "available", promptCapabilities: { image: true } };
      }, { updateOnly: true });

      expect(updateResult.updated).toBe(true);
      expect(updateResult.version).toBe("1.3.0");

      // Verify installed state migrated to 1.3.0
      expect(manager.get("antigravity")?.version).toBe("1.3.0");
      const newBinary = path.join(versionRoot, "1.3.0", "agy_acp_server.par");
      expect(manager.get("antigravity")?.command.command).toBe(newBinary);
      expect(JSON.parse(await readFile(path.join(root, "installed.json"), "utf8")).antigravity.version).toBe("1.3.0");
      expect(await readFile(newBinary, "utf8")).toContain("new-1.3.0");

      // Verify old 1.2.1 directory is still retained alongside 1.3.0 for rollback safety before prune
      expect(existsSync(oldBinary)).toBe(true);

      // 4. Prune: keeps current (1.3.0) and immediate previous fallback (1.2.1), deletes older (1.1.0) and orphaned stages
      await manager.prune();
      expect(existsSync(path.join(versionRoot, "1.3.0"))).toBe(true);
      expect(existsSync(path.join(versionRoot, "1.2.1"))).toBe(true);
      expect(existsSync(ancientVersionDir)).toBe(false);
      expect(existsSync(orphanedStageDir)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("enforces archive size cap of 500 MiB and rejects larger downloads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "edgeever-archive-size-"));
    const entry = {
      id: "antigravity-acp",
      version: "1.3.0",
      distribution: { binary: { "darwin-aarch64": {
        archive: "https://dl.google.com/agy-extensions/releases/macos/test.zip",
        cmd: "./agy_acp_server.par",
      } } },
    };
    let contentLength = 350 * 1024 * 1024;
    const manager = createAcpAdapterManager({
      root,
      platform: "darwin",
      arch: "arm64",
      fetchImpl: async (url) => {
        if (url.endsWith(".zip")) {
          return new Response(new ReadableStream({
            start(controller) {
              controller.error(new Error("aborted_after_header_check"));
            },
          }), {
            status: 200,
            headers: { "content-length": String(contentLength) },
          });
        }
        return new Response(JSON.stringify({ agents: [entry] }), { status: 200 });
      },
    });
    try {
      await expect(manager.install("antigravity", async () => ({ state: "available" }))).rejects.toThrow("aborted_after_header_check");
      contentLength = 501 * 1024 * 1024;
      await expect(manager.install("antigravity", async () => ({ state: "available" }))).rejects.toThrow("adapter_too_large");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});



