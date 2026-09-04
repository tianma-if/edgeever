import { readFile } from "node:fs/promises";

const FILE_SECRET_NAMES = [
  "EDGE_EVER_AUTH_PASSWORD",
  "EDGE_EVER_AUTH_PASSWORD_HASH",
  // Legacy decryption fallback for credentials saved by older releases.
  "EDGE_EVER_STORAGE_ENCRYPTION_KEY",
  "EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY",
  "EDGE_EVER_S3_ACCESS_KEY_ID",
  "EDGE_EVER_S3_SECRET_ACCESS_KEY",
];

export const loadSelfHostedEnvironment = async (environment = process.env) => {
  const resolved = { ...environment };

  for (const name of FILE_SECRET_NAMES) {
    const fileName = `${name}_FILE`;
    const filePath = environment[fileName]?.trim();
    if (!filePath) continue;
    if (environment[name] !== undefined) {
      throw new Error(`Set either ${name} or ${fileName}, not both`);
    }

    resolved[name] = (await readFile(filePath, "utf8")).replace(/[\r\n]+$/, "");
    delete resolved[fileName];
  }

  return resolved;
};
