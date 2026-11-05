import { rename, rm, writeFile } from "node:fs/promises";
import { restrictFile } from "./file-permissions.mjs";

export const instanceOrigin = (value) => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
};

export const encodeSessionCredential = (token, baseUrl) => JSON.stringify({ version: 1, token, origin: instanceOrigin(baseUrl) });

export const decodeSessionCredential = (plaintext, baseUrl) => {
  // Previous desktop releases encrypted the bare token. Bind that legacy value
  // only to the instance loaded at startup, before renderer IPC is registered.
  if (!plaintext.startsWith("{")) return { token: plaintext, origin: instanceOrigin(baseUrl) };
  try {
    const value = JSON.parse(plaintext);
    if (value.version === 1 && typeof value.token === "string" && value.token.length <= 4096
      && typeof value.origin === "string" && instanceOrigin(value.origin) === value.origin) return value;
  } catch {}
  return { token: "", origin: null };
};

export const credentialForUrl = (token, origin, url) => origin && origin === instanceOrigin(url) ? token : "";


export const writeSessionCredential = async (path, token, baseUrl, secureStorage) => {
  if (!token) {
    await rm(path, { force: true });
    return;
  }
  const encrypted = secureStorage.encryptString(encodeSessionCredential(token, baseUrl));
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, encrypted, { mode: 0o600 });
  await restrictFile(temporaryPath);
  await rename(temporaryPath, path);
  await restrictFile(path);
};
