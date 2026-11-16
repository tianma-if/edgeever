// Run using the packaged Electron executable with ELECTRON_RUN_AS_NODE=1.
// This exercises only temporary files, without launching the app or its updater.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { tmpdir } = require("node:os");
const { dirname, join, resolve, sep } = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const archive = realpathSync(resolve(process.argv[2]));
  const appRequire = createRequire(join(archive, "package.json"));
  const resolveDependency = (name) => {
    const file = appRequire.resolve(name);
    assert.ok(file.startsWith(archive + sep), `${name} resolved outside packaged archive: ${file}`);
    return file;
  };
  const zod = appRequire(resolveDependency("zod"));
  assert.equal(zod.z.string().parse("packaged"), "packaged");
  const esmZod = await import(pathToFileURL(join(dirname(resolveDependency("zod/package.json")), "index.js")).href);
  assert.equal(esmZod.z.string().parse("packaged"), "packaged");
  const sdk = await import(pathToFileURL(resolveDependency("@agentclientprotocol/sdk")).href);
  assert.equal(typeof sdk.ClientSideConnection, "function");
  const imgbed = await import(pathToFileURL(resolveDependency("@edgeever/image-host/imgbed")).href);
  assert.equal(typeof imgbed.createImgBedClient, "function");
  const updater = appRequire(resolveDependency("electron-updater"));
  for (const name of ["MacUpdater", "NsisUpdater", "AppImageUpdater"]) {
    assert.equal(typeof updater[name], "function", `Missing updater: ${name}`);
  }
  const manager = await import(pathToFileURL(join(archive, "src/main/acp-adapter-manager.mjs")).href);
  assert.equal(typeof manager.createAcpAdapterManager, "function");
  const { backgroundNodeExecutable } = await import(pathToFileURL(join(archive, "src/main/background-node.mjs")).href);
  const nodeExecutable = backgroundNodeExecutable(process.execPath);

  const npmCli = join(dirname(resolveDependency("npm")), "bin/npm-cli.js");
  const npmRequire = createRequire(npmCli);
  const tar = npmRequire("tar");
  const root = mkdtempSync(join(tmpdir(), "edgeever-packaged-npm-"));
  try {
    const fixture = join(root, "fixture/package");
    mkdirSync(fixture, { recursive: true });
    writeFileSync(join(fixture, "index.js"), "module.exports = 42;\n");
    for (const version of ["1.0.0", "1.0.1"]) {
      writeFileSync(join(fixture, "package.json"), JSON.stringify({ name: "edgeever-packaging-fixture", version, main: "index.js" }));
      const tarball = join(root, `fixture-${version}.tgz`);
      await tar.c({ gzip: true, cwd: join(root, "fixture"), file: tarball }, ["package"]);
      execFileSync(nodeExecutable, [npmCli, "install", "--prefix", join(root, "installed"),
        "--cache", join(root, "cache"), "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
        "--package-lock=false", tarball], {
        cwd: root,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", npm_config_update_notifier: "false" },
        timeout: 60_000,
        stdio: "pipe",
      });
      const installed = join(root, "installed/node_modules/edgeever-packaging-fixture");
      assert.equal(JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).version, version);
      assert.equal(require(join(installed, "index.js")), 42);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ok: true, packagedDependencies: true, offlineNpmInstallAndUpgrade: true }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
