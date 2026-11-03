import { createRequire } from "node:module";
import { generateKeyPairSync, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createWindowsUpdateMetadata } from "./create-windows-update-metadata.mjs";
import { signWindowsUpdateManifest } from "./sign-windows-update-manifest.mjs";
import { instrumentNativeUpdateMain } from "./native-update-instrumentation.mjs";

if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== "tianma-if/edgeever") {
  throw new Error("Instrumented update builds run only on the official repository's disposable CI runners");
}
const root = process.cwd();
const output = resolve(process.argv[2] || join(process.env.RUNNER_TEMP, "edgeever-update-verification"));
mkdirSync(output, { recursive: true });
const desktop = join(root, "apps/desktop");
const packagePath = join(desktop, "package.json");
const mainPath = join(desktop, "src/main/index.mjs");
const controlPath = join(desktop, "src/main/native-update-verifier.mjs");
const configPath = join(desktop, "build/update-verification.json");
const originalMain = readFileSync(mainPath, "utf8");
const originalPackage = readFileSync(packagePath, "utf8");
const [major, minor, patch] = JSON.parse(originalPackage).version.split(".").map(Number);
const versions = [1, 2, 3].map((step) => `${major}.${minor}.${patch + step}`);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const keyPath = join(output, "signing-key.pem");
writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync(join(output, "public-key.pem"), publicKeyPem);
writeFileSync(join(output, "versions.json"), JSON.stringify(versions));
const instrumented = instrumentNativeUpdateMain(originalMain, join(output, "runtime.json"));
const require = createRequire(join(desktop, "package.json"));
const builderCli = require.resolve("electron-builder/out/cli/cli.js");
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
};
try {
  writeFileSync(mainPath, instrumented);
  copyFileSync("scripts/fixtures/native-update/control.mjs", controlPath);
  mkdirSync(join(desktop, "build"), { recursive: true });
  if (process.platform === "darwin") run("bash", ["scripts/build-macos-share-extension.sh"]);
  for (const version of versions) {
    const metadata = { ...JSON.parse(originalPackage), name: "edgeever-update-verifier", version };
    writeFileSync(packagePath, JSON.stringify(metadata, null, 2));
    const directory = join(output, version);
    const config = {
      extends: "./electron-builder.yml", appId: "org.edgeever.update-verifier",
      productName: "EdgeEver Update Verification", executableName: "EdgeEverUpdateVerifier",
      directories: { output: directory },
      mac: { notarize: false },
      // Keep the test installer isolated from production protocol associations.
      protocols: [], fileAssociations: [], nsis: { include: null },
    };
    writeFileSync(configPath, JSON.stringify(config));
    const target = process.platform === "darwin" ? ["--mac", "zip"] : process.platform === "win32" ? ["--win", "nsis"] : ["--linux", "AppImage"];
    run(process.execPath, [builderCli, "--projectDir", desktop, "--config", configPath, "--publish", "never", ...target, `--${process.arch}`], desktop);
    const payload = process.platform === "darwin"
      ? join(directory, process.arch === "arm64" ? "mac-arm64" : "mac", "EdgeEver Update Verification.app/Contents/Resources/app.asar")
      : process.platform === "win32" ? join(directory, "win-unpacked/resources/app.asar")
      : join(directory, `EdgeEver-${version}-linux-x64.AppImage`);
    writeFileSync(join(directory, "payload.sha256"), createHash("sha256").update(readFileSync(payload)).digest("hex"));
    if (process.platform === "win32") {
      await createWindowsUpdateMetadata({ directory, version });
      signWindowsUpdateManifest({
        manifestPath: join(directory, "latest-windows.json"), signaturePath: join(directory, "latest-windows.json.sig"),
        privateKeyPath: keyPath, expectedPublicKey: publicKeyPem,
      });
    }
  }
} finally {
  writeFileSync(mainPath, originalMain);
  writeFileSync(packagePath, originalPackage);
  rmSync(controlPath, { force: true });
  rmSync(configPath, { force: true });
  rmSync(keyPath, { force: true });
}
