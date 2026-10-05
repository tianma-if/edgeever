import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { once } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { finished } from "node:stream/promises";
import { Readable } from "node:stream";
import { Unzip, UnzipInflate } from "fflate";

const require = createRequire(import.meta.url);
const npmCli = path.join(path.dirname(require.resolve("npm")), "bin", "npm-cli.js");
const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const PI_PACKAGE_URL = "https://registry.npmjs.org/pi-acp/latest";
const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SUPPORTED_MAJOR = { codex: 2, antigravity: 1 };

const platformTarget = (platform, arch) => {
  const system = { darwin: "darwin", linux: "linux", win32: "windows" }[platform];
  const cpu = { arm64: "aarch64", x64: "x86_64" }[arch];
  return system && cpu ? `${system}-${cpu}` : null;
};

const compareVersions = (left, right) => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

const commandFile = (root, id, version, platform) => id === "antigravity"
  ? path.join(root, id, version, platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par")
  : path.join(root, id, version, "node_modules", ...(id === "codex" ? ["@agentclientprotocol", "codex-acp"] : ["pi-acp"]), "dist", "index.js");

const antigravityArgs = (platform) => platform === "linux" ? ["--uid="] : [];

export const managedAdapterCommand = (root, id, version, { platform = process.platform, executablePath = process.execPath } = {}) => {
  if (!VERSION_PATTERN.test(version) || !["codex", "antigravity", "piAgent"].includes(id)) return null;
  const file = commandFile(root, id, version, platform);
  if (!existsSync(file)) return null;
  return id !== "antigravity"
    ? { command: executablePath, args: [file], env: { ELECTRON_RUN_AS_NODE: "1" } }
    : { command: file, args: antigravityArgs(platform) };
};

const readRegistry = async (fetchImpl) => {
  const response = await fetchImpl(REGISTRY_URL, { signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok) throw new Error("registry_unavailable");
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 1024 * 1024) throw new Error("registry_too_large");
  const raw = await response.text();
  if (raw.length > 1024 * 1024) throw new Error("registry_too_large");
  const agents = JSON.parse(raw).agents;
  if (!Array.isArray(agents)) throw new Error("invalid_registry");
  return agents;
};

export const selectPiAdapterRelease = (entry) => {
  if (entry?.name !== "pi-acp" || !/^0\.0\.\d+$/.test(entry.version ?? "") || entry.bin?.["pi-acp"] !== "dist/index.js") {
    throw new Error("unsupported_release");
  }
  return { id: "piAgent", version: entry.version, kind: "npm", packageName: `pi-acp@${entry.version}` };
};

const readPiRelease = async (fetchImpl) => {
  const response = await fetchImpl(PI_PACKAGE_URL, { signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 1024 * 1024) throw new Error("registry_unavailable");
  const raw = await response.text();
  if (raw.length > 1024 * 1024) throw new Error("registry_too_large");
  return selectPiAdapterRelease(JSON.parse(raw));
};

export const selectAdapterRelease = (agents, id, { platform = process.platform, arch = process.arch } = {}) => {
  const entry = agents.find((agent) => agent?.id === (id === "codex" ? "codex-acp" : "antigravity-acp"));
  if (!entry || !VERSION_PATTERN.test(entry.version)) throw new Error("unsupported_release");
  if (Number(entry.version.split(".")[0]) !== SUPPORTED_MAJOR[id]) throw new Error("unsupported_release");
  if (id === "codex") {
    const packageName = entry.distribution?.npx?.package;
    if (packageName !== `@agentclientprotocol/codex-acp@${entry.version}`) throw new Error("unsupported_release");
    return { id, version: entry.version, kind: "npm", packageName };
  }
  const target = platformTarget(platform, arch);
  const binary = target && entry.distribution?.binary?.[target];
  const archive = binary?.archive;
  if (!archive || !/^https:\/\/dl\.google\.com\/agy-extensions\/releases\/[^?#]+\.zip$/.test(archive)) {
    throw new Error("unsupported_release");
  }
  const expectedCommand = platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par";
  if (binary.cmd !== `./${expectedCommand}`) throw new Error("unsupported_release");
  if (JSON.stringify(binary.args ?? []) !== JSON.stringify(antigravityArgs(platform))) throw new Error("unsupported_release");
  if (binary.sha256 != null && !/^[a-fA-F0-9]{64}$/.test(binary.sha256)) throw new Error("unsupported_release");
  return { id, version: entry.version, kind: "binary", archive, sha256: binary.sha256 ?? null };
};

const runNpm = (args, cwd, { executablePath = process.execPath, spawnImpl = spawn, npmPath = npmCli } = {}) => new Promise((resolve, reject) => {
  const child = spawnImpl(executablePath, [npmPath, ...args], {
    cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", npm_config_update_notifier: "false" },
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
  timer.unref?.();
  child.once("error", (error) => { clearTimeout(timer); reject(error); });
  child.once("exit", (code) => {
    clearTimeout(timer);
    code === 0 ? resolve() : reject(new Error("adapter_install_failed"));
  });
});

const downloadArchive = async (url, destination, expectedHash, fetchImpl) => {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(120_000), redirect: "error" });
  if (!response.ok || !response.body) throw new Error("adapter_download_failed");
  if (Number(response.headers.get("content-length") || 0) > MAX_ARCHIVE_BYTES) throw new Error("adapter_too_large");
  const handle = await open(destination, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      bytes += chunk.length;
      if (bytes > MAX_ARCHIVE_BYTES) throw new Error("adapter_too_large");
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
        if (!bytesWritten) throw new Error("adapter_download_failed");
        offset += bytesWritten;
      }
    }
  } finally {
    await handle.close();
  }
  if (expectedHash && hash.digest("hex").toLowerCase() !== expectedHash.toLowerCase()) throw new Error("adapter_integrity_failed");
};

const extractAntigravity = async (archive, destination, platform) => {
  const required = platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par";
  const allowed = new Set([required, "localharness_external"]);
  const extracted = new Set();
  let total = 0;
  let failure = null;
  let drain = null;
  const writes = [];
  const unzip = new Unzip((file) => {
    if (!allowed.has(file.name) || extracted.has(file.name) || file.compression !== 8) {
      failure = new Error("invalid_adapter_archive");
      return;
    }
    extracted.add(file.name);
    const output = createWriteStream(path.join(destination, file.name), { flags: "wx", mode: 0o700 });
    const done = finished(output);
    void done.catch(() => {});
    writes.push(done);
    file.ondata = (error, chunk, final) => {
      if (error) { failure = error; output.destroy(error); return; }
      total += chunk.length;
      if (total > MAX_EXTRACTED_BYTES) {
        failure = new Error("adapter_too_large");
        output.destroy(failure);
        return;
      }
      if (chunk.length && !output.write(chunk) && !final) drain = once(output, "drain");
      if (final) output.end();
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for await (const chunk of createReadStream(archive, { highWaterMark: 64 * 1024 })) {
      if (failure) throw failure;
      unzip.push(chunk);
      if (drain) { await drain; drain = null; }
    }
    unzip.push(new Uint8Array(), true);
    if (failure) throw failure;
    await Promise.all(writes);
    if (!extracted.has(required)) throw new Error("invalid_adapter_archive");
  } catch (error) {
    for (const promise of writes) void promise.catch(() => {});
    throw error;
  }
};

export function createAcpAdapterManager({ root, fetchImpl = fetch, platform = process.platform, arch = process.arch, executablePath = process.execPath, spawnImpl = spawn, npmPath = npmCli, installNpmImpl = runNpm, downloadImpl = downloadArchive, extractImpl = extractAntigravity } = {}) {
  if (!root || !path.isAbsolute(root)) throw new Error("invalid_adapter_store");
  const manifestPath = path.join(root, "installed.json");
  const inFlight = new Map();
  let saveQueue = Promise.resolve();
  let state = {};
  try { state = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { /* First run or damaged manifest. */ }
  if (!state || typeof state !== "object" || Array.isArray(state)) state = {};

  const get = (id) => {
    const version = state[id]?.version;
    if (typeof version !== "string") return null;
    const command = managedAdapterCommand(root, id, version, { platform, executablePath });
    return command ? { id, version, command } : null;
  };

  const save = (id, version) => {
    const write = saveQueue.then(async () => {
      const next = { ...state, [id]: { version } };
      await mkdir(root, { recursive: true, mode: 0o700 });
      const temporary = `${manifestPath}.${process.pid}.tmp`;
      const file = await open(temporary, "w", 0o600);
      try { await file.writeFile(JSON.stringify(next)); } finally { await file.close(); }
      await rename(temporary, manifestPath);
      state = next;
    });
    saveQueue = write.catch(() => {});
    return write;
  };

  const install = (id, validate, { updateOnly = false } = {}) => {
    if (!["codex", "antigravity", "piAgent"].includes(id)) return Promise.reject(new Error("unknown_adapter"));
    if (inFlight.has(id)) return inFlight.get(id);
    const task = (async () => {
      const previous = get(id);
      if (updateOnly && !previous) return { updated: false, reason: "not_managed" };
      const release = id === "piAgent"
        ? await readPiRelease(fetchImpl)
        : selectAdapterRelease(await readRegistry(fetchImpl), id, { platform, arch });
      if (previous && compareVersions(release.version, previous.version) <= 0) return { updated: false, version: previous.version };
      const versionRoot = path.join(root, id);
      const target = path.join(versionRoot, release.version);
      const stage = path.join(versionRoot, `.stage-${release.version}-${process.pid}-${Date.now()}`);
      await mkdir(stage, { recursive: true, mode: 0o700 });
      try {
        if (release.kind === "npm") {
          await installNpmImpl(["install", "--prefix", stage, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--registry=https://registry.npmjs.org", release.packageName], stage, { executablePath, spawnImpl, npmPath });
        } else {
          const archive = path.join(stage, "adapter.zip");
          await downloadImpl(release.archive, archive, release.sha256, fetchImpl);
          await extractImpl(archive, stage, platform);
          await rm(archive);
          if (platform !== "win32") await chmod(path.join(stage, "agy_acp_server.par"), 0o700);
        }
        // Inspect the staged command before making it visible to future sessions.
        const stagedFile = release.kind === "npm"
          ? path.join(stage, "node_modules", ...(id === "codex" ? ["@agentclientprotocol", "codex-acp"] : ["pi-acp"]), "dist", "index.js")
          : path.join(stage, platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par");
        if (!existsSync(stagedFile)) throw new Error("adapter_install_failed");
        const stagedCommand = release.kind === "npm"
          ? { command: executablePath, args: [stagedFile], env: { ELECTRON_RUN_AS_NODE: "1" } }
          : { command: stagedFile, args: antigravityArgs(platform) };
        const result = await validate(stagedCommand);
        if (result?.state === "needs_login" && previous) {
          const previousResult = await validate(previous.command);
          if (previousResult?.state !== "needs_login") throw new Error("adapter_probe_failed");
        } else if (result?.state !== "available" && !(result?.state === "needs_login" && !previous)) {
          throw new Error(result?.detail || result?.state || "adapter_probe_failed");
        }
        await rm(target, { recursive: true, force: true });
        await rename(stage, target);
        await save(id, release.version);
        return { updated: true, version: release.version, adapter: result };
      } catch (error) {
        await rm(stage, { recursive: true, force: true });
        throw error;
      }
    })();
    inFlight.set(id, task);
    void task.finally(() => inFlight.delete(id)).catch(() => {});
    return task;
  };

  const prune = async () => {
    for (const id of ["codex", "antigravity", "piAgent"]) {
      const current = get(id)?.version;
      if (!current) continue;
      const folder = path.join(root, id);
      const names = await readdir(folder).catch(() => []);
      const versions = names.filter((name) => VERSION_PATTERN.test(name) && name !== current)
        .sort((a, b) => compareVersions(b, a));
      for (const name of names) {
        if (name.startsWith(".stage-") || (versions.includes(name) && name !== versions[0])) {
          await rm(path.join(folder, name), { recursive: true, force: true });
        }
      }
    }
  };

  return { get, install, prune, installedIds: () => ["codex", "antigravity", "piAgent"].filter((id) => get(id)) };
}
