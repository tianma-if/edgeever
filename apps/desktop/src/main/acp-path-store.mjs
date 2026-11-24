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

// This store must remain outside all renderer-writable resource directories.
export const createAcpPathStore = (filename) => {
  let recorded = null;
  const ready = readFile(filename, "utf8").then((text) => {
    const value = JSON.parse(text)?.antigravity;
    if (typeof value === "string" && path.isAbsolute(value) && !value.includes("\0")) recorded = value;
  }).catch(() => {});
  return {
    async get() { await ready; return recorded; },
    async set(value) {
      await ready;
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      const temporary = `${filename}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ antigravity: value }), { mode: 0o600 });
      await rename(temporary, filename);
      recorded = value;
    },
  };
};
