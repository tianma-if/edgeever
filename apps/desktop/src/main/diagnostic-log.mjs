import { rename, stat, unlink } from "node:fs/promises";

export const rotateDiagnosticLog = async (path, maxBytes = 5 * 1024 * 1024) => {
  try {
    const metadata = await stat(path);
    if (metadata.size <= maxBytes) return false;
  } catch {
    return false;
  }

  const archivePath = `${path}.1`;
  await unlink(archivePath).catch(() => {});
  await rename(path, archivePath);
  return true;
};
