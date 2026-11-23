import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const validateTrustedAcpPath = async (filename, { excludedRoot } = {}) => {
  const selected = await realpath(filename);
  if (excludedRoot) {
    const root = await realpath(excludedRoot);
    const child = path.relative(root, selected);
    if (!child || (child !== ".." && !child.startsWith(`..${path.sep}`) && !path.isAbsolute(child))) {
      throw new Error("Choose an ACP executable outside EdgeEver's client data directory");
    }
  }
  const info = await stat(selected);
  if (!info.isFile()) throw new Error("The ACP executable must be a file");
  if (process.platform !== "win32") {
    if (info.mode & 0o022) throw new Error("The ACP executable must not be writable by other users");
    for (let directory = path.dirname(selected);; directory = path.dirname(directory)) {
      if ((await stat(directory)).mode & 0o022) throw new Error("The ACP executable directory must not be writable by other users");
      if (path.dirname(directory) === directory) break;
    }
  }
  return selected;
};

const VALID_LAUNCH_MODES = new Set(["cli", "standalone"]);

export const antigravityLaunchModeForPath = (filePath, platform = process.platform) => {
  if (typeof filePath !== "string" || !filePath) return "standalone";
  const name = platform === "win32" ? path.win32.basename(filePath) : path.posix.basename(filePath);
  return (platform === "win32" ? /^agy(?:\.exe)?$/i.test(name) : name === "agy") ? "cli" : "standalone";
};

// This store must remain outside all renderer-writable resource directories.
export const createAcpPathStore = (filename) => {
  let recorded = null;
  let recordedMode = null;
  const ready = readFile(filename, "utf8").then((text) => {
    const parsed = JSON.parse(text);
    const value = parsed?.antigravity;
    if (typeof value === "string" && path.isAbsolute(value) && !value.includes("\0")) {
      recorded = value;
      recordedMode = VALID_LAUNCH_MODES.has(parsed?.antigravityMode) ? parsed.antigravityMode : null;
    }
  }).catch(() => {});
  const persist = async (value, mode) => {
    await ready;
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${process.pid}.tmp`;
    const nextMode = value && VALID_LAUNCH_MODES.has(mode) ? mode : null;
    const payload = nextMode ? { antigravity: value, antigravityMode: nextMode } : { antigravity: value };
    await writeFile(temporary, JSON.stringify(payload), { mode: 0o600 });
    await rename(temporary, filename);
    recorded = value;
    recordedMode = nextMode;
  };
  return {
    async get() { await ready; return recorded; },
    async getEntry() { await ready; return recorded ? { path: recorded, mode: recordedMode } : null; },
    async set(value) { await persist(value, null); },
    async setEntry(entry) { await persist(entry?.path ?? null, entry?.mode ?? null); },
  };
};
