import { describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CODEBUDDY_UNSET_ENV, codeBuddyLoginUrl, resolveCodeBuddyCli } from "./codebuddy-cli.mjs";
import { createAcpSpawnPlan, resolveAcpCommand } from "./acp-host.mjs";

const officialPackage = JSON.stringify({ name: "@tencent-ai/codebuddy-code" });

// In-memory files: path -> contents. Every listed file counts as executable.
const memoryDeps = (platform, files, links = {}) => ({
  platform,
  executableMode: 1,
  stat: (file) => {
    if (!Object.hasOwn(files, file)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return { isFile: () => true };
  },
  access: (file) => {
    if (!Object.hasOwn(files, file)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
  },
  exists: (file) => Object.hasOwn(files, file),
  realpath: (file) => links[file] ?? file,
  readFile: (file) => {
    if (!Object.hasOwn(files, file)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return files[file];
  },
});

describe("CodeBuddy CLI resolution", () => {
  const posixPrefix = "/Users/me/.nvm/versions/node/v22.11.0";
  const posixRoot = `${posixPrefix}/lib/node_modules/@tencent-ai/codebuddy-code`;
  const posixFiles = {
    [`${posixPrefix}/bin/codebuddy`]: "",
    [`${posixPrefix}/bin/node`]: "",
    [`${posixRoot}/bin/codebuddy`]: "",
    [`${posixRoot}/package.json`]: officialPackage,
    "/usr/bin/node": "",
  };
  const posixLinks = { [`${posixPrefix}/bin/codebuddy`]: `${posixRoot}/bin/codebuddy` };

  test("runs the npm entry with the Node that installed it, without a shell", () => {
    const result = resolveCodeBuddyCli({ ...memoryDeps("darwin", posixFiles, posixLinks), toolPath: `/usr/bin:${posixPrefix}/bin` });
    expect(result).toEqual({
      ok: true,
      command: { command: `${posixPrefix}/bin/node`, args: [`${posixRoot}/bin/codebuddy`, "--acp"], env: {}, unsetEnv: CODEBUDDY_UNSET_ENV },
    });
  });

  test("falls back to Node on the tool path and reports a missing Node", () => {
    const { [`${posixPrefix}/bin/node`]: _, ...withoutNvmNode } = posixFiles;
    expect(resolveCodeBuddyCli({ ...memoryDeps("linux", withoutNvmNode, posixLinks), toolPath: `${posixPrefix}/bin:/usr/bin` }).command?.command).toBe("/usr/bin/node");
    const { "/usr/bin/node": __, ...noNode } = withoutNvmNode;
    expect(resolveCodeBuddyCli({ ...memoryDeps("linux", noNode, posixLinks), toolPath: `${posixPrefix}/bin:/usr/bin` })).toEqual({ ok: false, state: "failed", detail: "node_missing" });
  });

  test("reports not installed for a missing CLI, another package or WorkBuddy's bundled copy", () => {
    expect(resolveCodeBuddyCli({ ...memoryDeps("darwin", posixFiles, posixLinks), toolPath: "/usr/bin" })).toEqual({ ok: false, state: "not_installed" });
    const otherPackage = { ...posixFiles, [`${posixRoot}/package.json`]: JSON.stringify({ name: "codebuddy" }) };
    expect(resolveCodeBuddyCli({ ...memoryDeps("darwin", otherPackage, posixLinks), toolPath: `${posixPrefix}/bin` })).toEqual({ ok: false, state: "not_installed" });
    const bundledRoot = "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli";
    const bundled = {
      "/usr/local/bin/codebuddy": "", "/usr/local/bin/node": "",
      [`${bundledRoot}/bin/codebuddy`]: "", [`${bundledRoot}/package.json`]: officialPackage,
    };
    expect(resolveCodeBuddyCli({ ...memoryDeps("darwin", bundled, { "/usr/local/bin/codebuddy": `${bundledRoot}/bin/codebuddy` }), toolPath: "/usr/local/bin" })).toEqual({ ok: false, state: "not_installed" });
  });

  test("uses npm's codebuddy.cmd location on Windows without running the shim", () => {
    const prefix = "C:\\Users\\me\\AppData\\Roaming\\npm";
    const root = `${prefix}\\node_modules\\@tencent-ai\\codebuddy-code`;
    const files = {
      [`${prefix}\\codebuddy.cmd`]: "",
      [`${root}\\bin\\codebuddy`]: "",
      [`${root}\\package.json`]: officialPackage,
      "C:\\Program Files\\nodejs\\node.exe": "",
    };
    const result = resolveCodeBuddyCli({ ...memoryDeps("win32", files), toolPath: `${prefix};C:\\Program Files\\nodejs` });
    expect(result).toEqual({
      ok: true,
      command: { command: "C:\\Program Files\\nodejs\\node.exe", args: [`${root}\\bin\\codebuddy`, "--acp"], env: {}, unsetEnv: CODEBUDDY_UNSET_ENV },
    });
    // An nvm-windows install keeps node.exe beside the shim and wins.
    const nvm = { ...files, [`${prefix}\\node.exe`]: "" };
    expect(resolveCodeBuddyCli({ ...memoryDeps("win32", nvm), toolPath: `${prefix};C:\\Program Files\\nodejs` }).command.command).toBe(`${prefix}\\node.exe`);
    expect(resolveCodeBuddyCli({ ...memoryDeps("win32", { [`${prefix}\\codebuddy.cmd`]: "" }), toolPath: prefix })).toEqual({ ok: false, state: "not_installed" });
    expect(resolveCodeBuddyCli({ ...memoryDeps("win32", { ...files, "C:\\Program Files\\nodejs\\node.exe": undefined }), toolPath: prefix }).detail).toBe("node_missing");
  });

  test("resolves a real npm-style install and clears inherited region overrides", async () => {
    const directory = realpathSync(await mkdtemp(path.join(tmpdir(), "edgeever-codebuddy-cli-")));
    try {
      const root = path.join(directory, "lib", "node_modules", "@tencent-ai", "codebuddy-code");
      await mkdir(path.join(root, "bin"), { recursive: true });
      await mkdir(path.join(directory, "bin"), { recursive: true });
      await writeFile(path.join(root, "package.json"), officialPackage);
      await writeFile(path.join(root, "bin", "codebuddy"), "#!/usr/bin/env node\n", { mode: 0o755 });
      await symlink(path.join(root, "bin", "codebuddy"), path.join(directory, "bin", "codebuddy"));
      await writeFile(path.join(directory, "bin", "node"), "#!/bin/sh\n", { mode: 0o755 });
      const resolved = resolveAcpCommand({ id: "codebuddy" }, {
        platform: "darwin", home: directory, pathEnv: path.join(directory, "bin"),
        // Keep machine-wide installs (e.g. Homebrew) out of the lookup.
        existsSync: (candidate) => candidate.startsWith(directory) && existsSync(candidate),
      });
      expect(resolved.ok).toBe(true);
      expect(resolved.command.command).toBe(path.join(directory, "bin", "node"));
      expect(resolved.command.args).toEqual([realpathSync(path.join(root, "bin", "codebuddy")), "--acp"]);
      const previous = { a: process.env.CODEBUDDY_INTERNET_ENVIRONMENT, b: process.env.CODEBUDDY_INTERNET_ENVIROMENT };
      process.env.CODEBUDDY_INTERNET_ENVIRONMENT = "internal";
      process.env.CODEBUDDY_INTERNET_ENVIROMENT = "internal";
      try {
        const env = createAcpSpawnPlan(resolved.command, directory).options.env;
        expect(env.CODEBUDDY_INTERNET_ENVIRONMENT).toBeUndefined();
        expect(env.CODEBUDDY_INTERNET_ENVIROMENT).toBeUndefined();
      } finally {
        if (previous.a === undefined) delete process.env.CODEBUDDY_INTERNET_ENVIRONMENT; else process.env.CODEBUDDY_INTERNET_ENVIRONMENT = previous.a;
        if (previous.b === undefined) delete process.env.CODEBUDDY_INTERNET_ENVIROMENT; else process.env.CODEBUDDY_INTERNET_ENVIROMENT = previous.b;
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("CodeBuddy login links", () => {
  test("accepts only https links on verified hosts", () => {
    for (const url of [
      "https://copilot.tencent.com/login?state=x",
      "https://www.codebuddy.ai/login?state=x",
      "https://codebuddy.ai/login",
      "https://WWW.CODEBUDDY.AI/login",
    ]) expect(codeBuddyLoginUrl(url)).toBe(new URL(url).href);
  });

  test("rejects other schemes, hosts, credentials and ports", () => {
    for (const url of [
      "http://www.codebuddy.ai/login",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://www.tencent.com/login",
      "https://evil.copilot.tencent.com.example/login",
      "https://notcodebuddy.ai/login",
      "https://codebuddy.ai.evil.example/login",
      "https://codebuddy.cn/login",
      "https://user:pass@www.codebuddy.ai/login",
      "https://user@www.codebuddy.ai/login",
      "https://www.codebuddy.ai:8443/login",
      "not a url",
      "",
      undefined,
      `https://www.codebuddy.ai/${"a".repeat(5000)}`,
    ]) expect(codeBuddyLoginUrl(url)).toBeNull();
  });
});
