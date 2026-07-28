import { chmod } from "node:fs/promises";

export const restrictDirectory = async (path) => {
  try { await chmod(path, 0o700); } catch { /* Best effort on platforms without POSIX modes. */ }
};

export const restrictFile = async (path) => {
  try { await chmod(path, 0o600); } catch { /* Best effort on platforms without POSIX modes. */ }
};
