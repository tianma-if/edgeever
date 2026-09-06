import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, openSync, closeSync, readFileSync, readSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { listPackage } from "@electron/asar";
import { assertMacIcnsComplete } from "./desktop-icns.mjs";
import { isVisualCppRuntimeDll, readPeImportedDlls } from "./pe-imports.mjs";

const outputDirectory = join(process.cwd(), "release", "desktop");
const version = JSON.parse(
  readFileSync(join(process.cwd(), "apps", "desktop", "package.json"), "utf8"),
).version;

const walk = (directory) => {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) result.push(...walk(path));
    else result.push(path);
  }
  return result;
};

const files = walk(outputDirectory);
const matchingPrefix = (prefix) => files.filter((path) => basename(path).startsWith(prefix));
const requestedPlatform = process.env.EDGE_EVER_VERIFY_TARGET ?? process.platform;
const requestedArch = process.env.EDGE_EVER_DESKTOP_ARCH ?? process.arch;
const listAsarFiles = (asarPath) => new Set(
  listPackage(asarPath).map((path) => path.replaceAll("\\", "/")),
);

const verifyMachOArch = (path, arch, label) => {
  const result = spawnSync("lipo", ["-archs", path], { encoding: "utf8" });
  const expectedArch = arch === "x64" ? "x86_64" : arch;
  assert.equal(result.status, 0, `${label} architecture inspection failed: ${result.stderr || result.stdout}`);
  assert.deepEqual(result.stdout.trim().split(/\s+/), [expectedArch], `${label} must contain only ${expectedArch}`);
};

const verifyPeX64 = (path, label) => {
  const descriptor = openSync(path, "r");
  try {
    const dosHeader = Buffer.alloc(64);
    assert.equal(readSync(descriptor, dosHeader, 0, dosHeader.length, 0), dosHeader.length, `${label} DOS header is incomplete`);
    assert.equal(dosHeader.toString("ascii", 0, 2), "MZ", `${label} is not a PE executable`);
    const peOffset = dosHeader.readUInt32LE(0x3c);
    const peHeader = Buffer.alloc(6);
    assert.equal(readSync(descriptor, peHeader, 0, peHeader.length, peOffset), peHeader.length, `${label} PE header is incomplete`);
    assert.equal(peHeader.toString("ascii", 0, 4), "PE\0\0", `${label} PE signature is invalid`);
    assert.equal(peHeader.readUInt16LE(4), 0x8664, `${label} must target Windows x64`);
  } finally {
    closeSync(descriptor);
  }
};

for (const sidecarPath of files.filter((path) => /[\\/]resources[\\/]sidecar[\\/]edgeever-sidecar(?:\.exe)?$/i.test(path))) {
  const bundleRoot = sidecarPath.replace(/[\\/]resources[\\/]sidecar[\\/]edgeever-sidecar(?:\.exe)?$/i, "");
  assert.ok(existsSync(join(bundleRoot, "resources", "web", "index.html")), `Desktop bundle is missing the Web renderer: ${bundleRoot}`);
  assert.ok(existsSync(join(bundleRoot, "resources", "migrations")), `Desktop bundle is missing migrations: ${bundleRoot}`);
}

if (requestedPlatform === "darwin") {
  assert.ok(["arm64", "x64"].includes(requestedArch), `Unsupported macOS architecture: ${requestedArch}`);
  assert.ok(existsSync(join(outputDirectory, `EdgeEver-${version}-mac-${requestedArch}.dmg`)), `macOS package must contain the current ${requestedArch} DMG`);
  assert.ok(existsSync(join(outputDirectory, `EdgeEver-${version}-mac-${requestedArch}.dmg.blockmap`)), `macOS package must contain the current ${requestedArch} DMG blockmap`);
  assert.ok(existsSync(join(outputDirectory, `EdgeEver-${version}-mac-${requestedArch}.zip`)), `macOS package must contain the current ${requestedArch} update ZIP`);
  assert.ok(existsSync(join(outputDirectory, `EdgeEver-${version}-mac-${requestedArch}.zip.blockmap`)), `macOS package must contain the current ${requestedArch} ZIP blockmap`);
  const unpackedDirectory = requestedArch === "x64" ? "mac" : `mac-${requestedArch}`;
  const unpackedApp = join(outputDirectory, unpackedDirectory, "EdgeEver.app");
  assert.ok(existsSync(unpackedApp), "macOS package must contain the unpacked app bundle");
  const executable = join(unpackedApp, "Contents", "MacOS", "EdgeEver");
  const appResources = join(unpackedApp, "Contents", "Resources");
  const sidecar = join(appResources, "sidecar", "edgeever-sidecar");
  assert.ok(existsSync(sidecar), `macOS app bundle is missing the sidecar: ${sidecar}`);
  verifyMachOArch(executable, requestedArch, "Electron executable");
  verifyMachOArch(sidecar, requestedArch, "Rust sidecar");
  const asarPath = join(appResources, "app.asar");
  assert.ok(existsSync(asarPath), `macOS app bundle is missing app.asar: ${asarPath}`);
  const asarFiles = listAsarFiles(asarPath);
  assert.ok(asarFiles.has("/src/preload/index.cjs"), "macOS app bundle must contain the sandbox-compatible CommonJS preload");
  assert.ok(!asarFiles.has("/src/preload/index.mjs"), "macOS app bundle must not contain the unsupported ESM preload");
  const appIconPath = join(appResources, "icon.icns");
  assert.ok(existsSync(appIconPath), `macOS app bundle is missing icon.icns: ${appIconPath}`);
  assertMacIcnsComplete(readFileSync(appIconPath), appIconPath);
  const infoPlist = readFileSync(join(unpackedApp, "Contents", "Info.plist"), "utf8");
  assert.match(infoPlist, /CFBundleIconFile/, "macOS Info.plist must declare CFBundleIconFile");
  // LaunchServices registers unpacked build products as additional document
  // handlers. The signed DMG/ZIP are the release artifacts, so discard the
  // disposable unpacked bundle once its contents have passed verification.
  rmSync(unpackedApp, { recursive: true, force: true });
} else if (requestedPlatform === "win32") {
  assert.equal(requestedArch, "x64", `Windows release package must target x64, received: ${requestedArch}`);
  const installer = join(outputDirectory, `EdgeEver-${version}-windows-x64.exe`);
  const unpackedDirectory = join(outputDirectory, "win-unpacked");
  const executable = join(unpackedDirectory, "EdgeEver.exe");
  const resources = join(unpackedDirectory, "resources");
  const sidecar = join(resources, "sidecar", "edgeever-sidecar.exe");
  assert.ok(existsSync(installer), `Windows package must contain the current x64 NSIS installer: ${installer}`);
  assert.ok(existsSync(executable), `Windows package must contain the unpacked x64 executable: ${executable}`);
  assert.ok(existsSync(sidecar), `Windows package must contain the x64 sidecar: ${sidecar}`);
  assert.ok(existsSync(join(resources, "web", "index.html")), "Windows app bundle is missing the Web renderer");
  assert.ok(existsSync(join(resources, "migrations")), "Windows app bundle is missing migrations");
  verifyPeX64(executable, "Electron executable");
  verifyPeX64(sidecar, "Rust sidecar");
  const sidecarRuntimeImports = readPeImportedDlls(sidecar).filter(isVisualCppRuntimeDll);
  assert.deepEqual(
    sidecarRuntimeImports,
    [],
    `Windows sidecar must statically link the Visual C++ runtime; found: ${sidecarRuntimeImports.join(", ")}`,
  );
  const asarPath = join(resources, "app.asar");
  assert.ok(existsSync(asarPath), `Windows app bundle is missing app.asar: ${asarPath}`);
  const asarFiles = listAsarFiles(asarPath);
  assert.ok(asarFiles.has("/src/preload/index.cjs"), "Windows app bundle must contain the sandbox-compatible CommonJS preload");
  assert.ok(!asarFiles.has("/src/preload/index.mjs"), "Windows app bundle must not contain the unsupported ESM preload");
} else if (requestedPlatform === "linux") {
  assert.ok(matchingPrefix(`EdgeEver-${version}-linux-`).some((path) => path.endsWith(".AppImage")), "Linux package must contain the current AppImage");
  const unpacked = files.find((path) => path.endsWith("/resources/sidecar/edgeever-sidecar") && path.includes("linux-") && path.includes("-unpacked"));
  if (unpacked) {
    const root = unpacked.slice(0, unpacked.indexOf("/resources/sidecar/edgeever-sidecar"));
    assert.ok(existsSync(join(root, "resources", "web", "index.html")), "Linux app bundle is missing the Web renderer");
    assert.ok(existsSync(join(root, "resources", "migrations")), "Linux app bundle is missing migrations");
  }
} else {
  throw new Error(`Unsupported packaging platform: ${requestedPlatform}`);
}

console.log(JSON.stringify({ ok: true, platform: requestedPlatform, artifacts: files.filter((path) => /\.(dmg|exe|AppImage)$/.test(path)) }));
