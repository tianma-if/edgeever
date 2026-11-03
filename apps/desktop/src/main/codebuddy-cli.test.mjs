import { describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CODEBUDDY_UNSET_ENV, codeBuddyLoginUrl, resolveCodeBuddyCli } from "./codebuddy-cli.mjs";
import { createAcpSpawnPlan, nvmDefaultVersion, resolveAcpCommand } from "./acp-host.mjs";

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

  describe("version-manager shims", () => {
    const home = "/Users/me";
    const brewRoot = "/opt/homebrew/lib/node_modules/@tencent-ai/codebuddy-code";
    const brew = {
      "/opt/homebrew/bin/codebuddy": "", "/opt/homebrew/bin/node": "",
      [`${brewRoot}/bin/codebuddy`]: "", [`${brewRoot}/package.json`]: officialPackage,
    };
    const brewLinks = { "/opt/homebrew/bin/codebuddy": `${brewRoot}/bin/codebuddy` };
    const install = (prefix) => ({
      [`${prefix}/bin/codebuddy`]: "", [`${prefix}/bin/node`]: "",
      [`${prefix}/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy`]: "",
      [`${prefix}/lib/node_modules/@tencent-ai/codebuddy-code/package.json`]: officialPackage,
    });
    const installLinks = (prefix) => ({ [`${prefix}/bin/codebuddy`]: `${prefix}/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy` });
    const run = (answers, calls = []) => (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return answers[command] ?? null;
    };

    test("asks asdf for the real executable and uses that install's Node", () => {
      const asdfInstall = `${home}/.asdf/installs/nodejs/22.14.0`;
      const files = { [`${home}/.asdf/shims/codebuddy`]: "", [`${home}/.asdf/bin/asdf`]: "", ...install(asdfInstall), ...brew };
      const calls = [];
      const result = resolveCodeBuddyCli({
        ...memoryDeps("darwin", files, { ...installLinks(asdfInstall), ...brewLinks }), home, env: {}, tmpdir: "/tmp",
        toolPath: `${home}/.asdf/shims:/opt/homebrew/bin`,
        runManager: run({ [`${home}/.asdf/bin/asdf`]: `${asdfInstall}/bin/codebuddy` }, calls),
      });
      expect(result.command).toMatchObject({ command: `${asdfInstall}/bin/node`, args: [`${asdfInstall}/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy`, "--acp"] });
      expect(calls).toEqual([{ command: `${home}/.asdf/bin/asdf`, args: ["which", "codebuddy"], cwd: "/tmp" }]);
    });

    test("an unresolvable shim does not hide a later valid install", () => {
      const files = { [`${home}/.asdf/shims/codebuddy`]: "", [`${home}/.asdf/bin/asdf`]: "", ...brew };
      const result = resolveCodeBuddyCli({
        ...memoryDeps("darwin", files, brewLinks), home, env: {}, tmpdir: "/tmp",
        toolPath: `${home}/.asdf/shims:/opt/homebrew/bin`, runManager: run({}),
      });
      expect(result.command).toMatchObject({ command: "/opt/homebrew/bin/node", args: [`${brewRoot}/bin/codebuddy`, "--acp"] });
    });

    test("resolves mise shims that link to the mise binary", () => {
      const miseInstall = `${home}/.local/share/mise/installs/node/22.14.0`;
      const files = { [`${home}/.local/share/mise/shims/codebuddy`]: "", [`${home}/.local/bin/mise`]: "", ...install(miseInstall) };
      const result = resolveCodeBuddyCli({
        ...memoryDeps("linux", files, { [`${home}/.local/share/mise/shims/codebuddy`]: `${home}/.local/bin/mise`, ...installLinks(miseInstall) }),
        home, env: {}, tmpdir: "/tmp", toolPath: `${home}/.local/share/mise/shims`,
        runManager: run({ [`${home}/.local/bin/mise`]: `${miseInstall}/bin/codebuddy` }),
      });
      expect(result.command).toMatchObject({ command: `${miseInstall}/bin/node`, args: [`${miseInstall}/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy`, "--acp"] });
    });

    test("resolves Volta packages and runs them with Volta's Node", () => {
      const pkg = `${home}/.volta/tools/image/packages/@tencent-ai/codebuddy-code`;
      const files = {
        [`${home}/.volta/bin/codebuddy`]: "", [`${home}/.volta/bin/volta`]: "", [`${home}/.volta/bin/node`]: "",
        [`${pkg}/bin/codebuddy`]: "", [`${pkg}/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy`]: "",
        [`${pkg}/lib/node_modules/@tencent-ai/codebuddy-code/package.json`]: officialPackage,
      };
      const result = resolveCodeBuddyCli({
        ...memoryDeps("darwin", files, {
          [`${home}/.volta/bin/codebuddy`]: `${home}/.volta/bin/volta-shim`,
          [`${pkg}/bin/codebuddy`]: `${pkg}/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy`,
        }),
        home, env: {}, tmpdir: "/tmp", toolPath: `${home}/.volta/bin`,
        runManager: run({ [`${home}/.volta/bin/volta`]: `${pkg}/bin/codebuddy` }),
      });
      expect(result.command).toMatchObject({ command: `${home}/.volta/bin/node`, args: [`${pkg}/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy`, "--acp"] });
    });

    test("another package earlier on the path does not hide the official CLI", () => {
      const files = { "/usr/local/bin/codebuddy": "", "/usr/local/lib/node_modules/codebuddy/bin/codebuddy": "", "/usr/local/lib/node_modules/codebuddy/package.json": JSON.stringify({ name: "codebuddy" }), ...brew };
      const result = resolveCodeBuddyCli({
        ...memoryDeps("darwin", files, { "/usr/local/bin/codebuddy": "/usr/local/lib/node_modules/codebuddy/bin/codebuddy", ...brewLinks }),
        home, env: {}, toolPath: "/usr/local/bin:/opt/homebrew/bin", runManager: run({}),
      });
      expect(result.command?.args[0]).toBe(`${brewRoot}/bin/codebuddy`);
    });
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

describe("nvm default alias", () => {
  const home = "/Users/me";
  const nvm = (aliases, versions = ["v20.18.0", "v22.9.0", "v22.14.0", "v23.1.0"]) => ({
    readFile: (file) => {
      const name = file.slice(`${home}/.nvm/alias/`.length);
      if (!file.startsWith(`${home}/.nvm/alias/`) || !Object.hasOwn(aliases, name)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return `${aliases[name]}\n`;
    },
    readdir: (dir) => {
      if (dir !== `${home}/.nvm/versions/node`) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return [...versions, ".DS_Store"];
    },
  });

  test("resolves exact, partial and newest-version aliases to an installed version", () => {
    expect(nvmDefaultVersion(home, nvm({ default: "v22.9.0" }))).toBe("v22.9.0");
    expect(nvmDefaultVersion(home, nvm({ default: "22" }))).toBe("v22.14.0");
    expect(nvmDefaultVersion(home, nvm({ default: "v22" }))).toBe("v22.14.0");
    expect(nvmDefaultVersion(home, nvm({ default: "22.9" }))).toBe("v22.9.0");
    expect(nvmDefaultVersion(home, nvm({ default: "node" }))).toBe("v23.1.0");
    expect(nvmDefaultVersion(home, nvm({ default: "stable" }))).toBe("v23.1.0");
    expect(nvmDefaultVersion(home, nvm({ default: "21" }))).toBeNull();
  });

  test("follows lts and named aliases", () => {
    expect(nvmDefaultVersion(home, nvm({ default: "lts/*", "lts/*": "lts/jod", "lts/jod": "v22.14.0" }))).toBe("v22.14.0");
    expect(nvmDefaultVersion(home, nvm({ default: "lts/jod", "lts/jod": "v22.9.0" }))).toBe("v22.9.0");
    expect(nvmDefaultVersion(home, nvm({ default: "work", work: "20" }))).toBe("v20.18.0");
  });

  test("ignores system, missing, looping and unsafe aliases", () => {
    expect(nvmDefaultVersion(home, nvm({ default: "system" }))).toBeNull();
    expect(nvmDefaultVersion(home, nvm({}))).toBeNull();
    expect(nvmDefaultVersion(home, nvm({ default: "lts/*" }))).toBeNull();
    expect(nvmDefaultVersion(home, nvm({ default: "a", a: "b", b: "a" }))).toBeNull();
    expect(nvmDefaultVersion(home, nvm({ default: "../../etc/passwd" }))).toBeNull();
    expect(nvmDefaultVersion(home, nvm({ default: "22" }, []))).toBeNull();
  });

  test("finds CodeBuddy under nvm's lts default with a minimal desktop PATH", async () => {
    const directory = realpathSync(await mkdtemp(path.join(tmpdir(), "edgeever-codebuddy-nvm-")));
    try {
      const prefix = path.join(directory, ".nvm", "versions", "node", "v22.14.0");
      const root = path.join(prefix, "lib", "node_modules", "@tencent-ai", "codebuddy-code");
      await mkdir(path.join(root, "bin"), { recursive: true });
      await mkdir(path.join(prefix, "bin"), { recursive: true });
      await mkdir(path.join(directory, ".nvm", "versions", "node", "v20.18.0", "bin"), { recursive: true });
      await mkdir(path.join(directory, ".nvm", "alias", "lts"), { recursive: true });
      await writeFile(path.join(directory, ".nvm", "alias", "default"), "lts/*\n");
      await writeFile(path.join(directory, ".nvm", "alias", "lts", "*"), "lts/jod\n");
      await writeFile(path.join(directory, ".nvm", "alias", "lts", "jod"), "v22.14.0\n");
      await writeFile(path.join(root, "package.json"), officialPackage);
      await writeFile(path.join(root, "bin", "codebuddy"), "#!/usr/bin/env node\n", { mode: 0o755 });
      await symlink(path.join(root, "bin", "codebuddy"), path.join(prefix, "bin", "codebuddy"));
      await writeFile(path.join(prefix, "bin", "node"), "#!/bin/sh\n", { mode: 0o755 });
      const resolved = resolveAcpCommand({ id: "codebuddy" }, {
        platform: "darwin", home: directory, pathEnv: "/usr/bin:/bin",
        existsSync: (candidate) => candidate.startsWith(directory) && existsSync(candidate),
      });
      expect(resolved.ok).toBe(true);
      expect(resolved.command.command).toBe(path.join(prefix, "bin", "node"));
      expect(resolved.command.args).toEqual([path.join(root, "bin", "codebuddy"), "--acp"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
