import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { createAcpAdapterManager, managedAdapterCommand, selectAdapterRelease, selectPiAdapterRelease } from "./acp-adapter-manager.mjs";

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
});
