import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const outputDirectory = join(process.cwd(), "release", "desktop");
const version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version;

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

for (const sidecarPath of files.filter((path) => /[\\/]resources[\\/]sidecar[\\/]edgeever-sidecar(?:\.exe)?$/i.test(path))) {
  const bundleRoot = sidecarPath.replace(/[\\/]resources[\\/]sidecar[\\/]edgeever-sidecar(?:\.exe)?$/i, "");
  assert.ok(existsSync(join(bundleRoot, "resources", "web", "index.html")), `Desktop bundle is missing the Web renderer: ${bundleRoot}`);
  assert.ok(existsSync(join(bundleRoot, "resources", "migrations")), `Desktop bundle is missing migrations: ${bundleRoot}`);
}

if (requestedPlatform === "darwin") {
  assert.ok(existsSync(join(outputDirectory, `EdgeEver-${version}-mac-arm64.dmg`)), "macOS package must contain the current arm64 DMG");
  const sidecar = join(outputDirectory, "mac-arm64", "EdgeEver.app", "Contents", "Resources", "sidecar", "edgeever-sidecar");
  assert.ok(existsSync(sidecar), `macOS app bundle is missing the sidecar: ${sidecar}`);
} else if (requestedPlatform === "win32") {
  const installer = matchingPrefix(`EdgeEver-${version}-windows-`).some((path) => path.endsWith(".exe"));
  const unpacked = existsSync(join(outputDirectory, "win-arm64-unpacked", "EdgeEver.exe"));
  assert.ok(installer || unpacked, "Windows package must contain the current NSIS installer or an unpacked executable");
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
