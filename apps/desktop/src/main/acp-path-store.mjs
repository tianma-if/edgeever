import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const ACP_OPEN_DIALOG_PROPERTIES = ["openFile", "noResolveAliases"];

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

export const chooseTrustedAcpPath = async ({ showOpenDialog, title, excludedRoot, validatePath = validateTrustedAcpPath }) => {
  const selection = await showOpenDialog({ properties: [...ACP_OPEN_DIALOG_PROPERTIES], title });
  if (selection?.canceled || !selection?.filePaths?.[0]) return null;
  return validatePath(selection.filePaths[0], { excludedRoot });
};

const VALID_ANTIGRAVITY_MODES = new Set(["standalone", "cli"]);

export const normalizeAntigravityMode = (mode) => (VALID_ANTIGRAVITY_MODES.has(mode) ? mode : "standalone");

const validStoredPath = (value) => (
  typeof value === "string" && path.isAbsolute(value) && !value.includes("\0") ? value : null
);

// This store must remain outside all renderer-writable resource directories.
export const createAcpPathStore = (filename) => {
  let standalonePath = null;
  let cliPath = null;
  let mode = "standalone";
  let writeSeq = 0;
  const ready = readFile(filename, "utf8").then((text) => {
    const parsed = JSON.parse(text);
    standalonePath = validStoredPath(parsed?.antigravity);
    cliPath = validStoredPath(parsed?.antigravityCli);
    mode = normalizeAntigravityMode(parsed?.antigravityMode);
  }).catch(() => {});
  let writeQueue = ready;

  const activePath = () => (mode === "cli" ? cliPath : standalonePath);

  const enqueuePersist = (mutate) => {
    const task = writeQueue.then(async () => {
      const next = mutate({ standalonePath, cliPath, mode });
      const nextStandalone = validStoredPath(next.standalonePath);
      const nextCli = validStoredPath(next.cliPath);
      const nextMode = normalizeAntigravityMode(next.mode);
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      const temporary = `${filename}.${process.pid}.${++writeSeq}.tmp`;
      const payload = {
        antigravity: nextStandalone,
        ...(nextCli ? { antigravityCli: nextCli } : {}),
        ...(nextMode !== "standalone" ? { antigravityMode: nextMode } : {}),
      };
      await writeFile(temporary, JSON.stringify(payload), { mode: 0o600 });
      await rename(temporary, filename);
      standalonePath = nextStandalone;
      cliPath = nextCli;
      mode = nextMode;
    });
    writeQueue = task.catch(() => {});
    return task;
  };

  return {
    async get() { await writeQueue; return activePath(); },
    async getEntry() {
      await writeQueue;
      return { mode, path: activePath(), standalonePath, cliPath };
    },
    async set(value) {
      await enqueuePersist((state) => (
        state.mode === "cli" ? { ...state, cliPath: value ?? null } : { ...state, standalonePath: value ?? null }
      ));
    },
    async setPath(value, targetMode = null) {
      await enqueuePersist((state) => {
        const effectiveMode = targetMode ? normalizeAntigravityMode(targetMode) : state.mode;
        return effectiveMode === "cli"
          ? { ...state, cliPath: value ?? null }
          : { ...state, standalonePath: value ?? null };
      });
    },
    async setMode(nextMode) {
      if (!VALID_ANTIGRAVITY_MODES.has(nextMode)) throw new Error("invalid_antigravity_mode");
      await enqueuePersist((state) => ({ ...state, mode: nextMode }));
    },
    async clearAll() {
      await enqueuePersist(() => ({ standalonePath: null, cliPath: null, mode: "standalone" }));
    },
  };
};
