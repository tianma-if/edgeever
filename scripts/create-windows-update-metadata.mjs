import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WINDOWS_UPDATE_KEY_ID,
  WINDOWS_UPDATE_MANIFEST_NAME,
} from "../apps/desktop/src/main/windows-update-trust.mjs";

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

const hashFile = (path, algorithm, encoding) => new Promise((resolveHash, rejectHash) => {
  const hash = createHash(algorithm);
  const stream = createReadStream(path);
  stream.on("error", rejectHash);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("end", () => resolveHash(hash.digest(encoding)));
});

export const createWindowsUpdateMetadata = async ({ directory, version }) => {
  if (!STABLE_VERSION.test(version)) {
    throw new Error(`Windows update version must be stable X.Y.Z: ${version}`);
  }
  const installerName = `EdgeEver-${version}-windows-x64.exe`;
  const installerPath = join(directory, installerName);
  const stats = statSync(installerPath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error(`Windows installer is missing or empty: ${installerPath}`);
  }
  const [sha512, sha256] = await Promise.all([
    hashFile(installerPath, "sha512", "base64"),
    hashFile(installerPath, "sha256", "hex"),
  ]);
  const releaseDate = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    keyId: WINDOWS_UPDATE_KEY_ID,
    version,
    platform: "win32",
    arch: "x64",
    releaseDate,
    file: {
      name: installerName,
      size: stats.size,
      sha512,
      sha256,
    },
  };
  writeFileSync(
    join(directory, WINDOWS_UPDATE_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(join(directory, "latest.yml"), [
    `version: ${version}`,
    "files:",
    `  - url: ${installerName}`,
    `    sha512: ${sha512}`,
    `    size: ${stats.size}`,
    `path: ${installerName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n"));
  writeFileSync(
    join(directory, "SHA256SUMS-windows.txt"),
    `${sha256}  ${installerName}\n`,
  );
  return manifest;
};

const run = async () => {
  const [directoryValue, version] = process.argv.slice(2);
  if (!directoryValue || !version) {
    throw new Error("Usage: node scripts/create-windows-update-metadata.mjs <directory> <version>");
  }
  const directory = resolve(directoryValue);
  const packageVersion = JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
  if (version !== packageVersion) {
    throw new Error(`Requested version ${version} does not match desktop package version ${packageVersion}`);
  }
  const manifest = await createWindowsUpdateMetadata({ directory, version });
  process.stdout.write(`${basename(directory)}: ${manifest.file.name}\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
