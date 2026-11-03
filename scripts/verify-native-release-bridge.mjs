import { windowsUpdateInstallerRunning } from "./native-update-windows.mjs";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, createReadStream, statSync, renameSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";

if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Release bridge runs only on disposable CI runners");
const root = resolve(process.argv[2]);
const previous = join(root, "previous");
const candidate = join(root, "candidate");
const evidence = join(root, "evidence");
const installed = join(root, "installed");
const profile = join(root, "profile");
for (const path of [evidence, installed, profile]) mkdirSync(path, { recursive: true });
// Acknowledge only the isolated installation's first-run confirmation.
writeFileSync(join(profile, "installation-confirmed"), new Date().toISOString());
const candidateName = readdirSync(candidate).find((name) => process.platform === "darwin" ? name.endsWith(".zip") : name.endsWith(".exe"));
const version = /EdgeEver-(\d+\.\d+\.\d+)-/.exec(candidateName)?.[1];
if (!version) throw new Error("Candidate installer version missing");
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const wait = (ms) => new Promise((yes) => setTimeout(yes, ms));
const until = async (fn, description) => {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await wait(200); }
  throw new Error(`Timed out: ${description}`);
};
let executable, expectedAsar;
if (process.platform === "darwin") {
  const oldZip = readdirSync(previous).find((name) => name.endsWith(".zip"));
  for (const [archive, destination] of [[join(previous, oldZip), installed], [join(candidate, candidateName), join(root, "expected")]]) {
    const result = spawnSync("ditto", ["-x", "-k", archive, destination], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  executable = join(installed, "EdgeEver.app/Contents/MacOS/EdgeEver");
  expectedAsar = join(root, "expected/EdgeEver.app/Contents/Resources/app.asar");
  const path = join(candidate, candidateName);
  const checksum = createHash("sha512").update(readFileSync(path)).digest("base64");
  writeFileSync(join(candidate, "latest-mac.yml"), `version: ${version}\nfiles:\n  - url: ${candidateName}\n    sha512: ${checksum}\n    size: ${statSync(path).size}\npath: ${candidateName}\nsha512: ${checksum}\n`);
} else {
  const oldExe = readdirSync(previous).find((name) => name.endsWith(".exe"));
  console.log("Installing published Windows predecessor into the isolated directory");
  const result = spawnSync(join(previous, oldExe), ["/S", `/D=${installed}`], {
    stdio: "ignore", timeout: 120_000, windowsHide: true,
    env: { ...process.env, EDGE_EVER_DISABLE_AUTO_UPDATE: "1" },
  });
  if (result.status !== 0) throw new Error(`Old release NSIS installation failed: ${result.status}`);
  executable = join(installed, "EdgeEver.exe");
  spawnSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='EdgeEver.exe'" | Where-Object { $_.ExecutablePath -eq $env:BRIDGE_INSTALLED_EXE } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`], {
    stdio: "ignore", env: { ...process.env, BRIDGE_INSTALLED_EXE: executable }, timeout: 30_000,
  });
  console.log("Published Windows predecessor installed");
  // The updated application's version plus updater-verified signed installer
  // hashes establish provenance. The bridge does not extract/repack NSIS.
}
const logPath = join(profile, "logs/desktop.log");
const installedAsar = process.platform === "darwin" ? join(dirname(executable), "../Resources/app.asar") : join(installed, "resources/app.asar");
const originalAsarDigest = digest(installedAsar);
const server = createServer((request, response) => {
  const name = basename(new URL(request.url, "http://127.0.0.1").pathname);
  const allowed = [candidateName, "latest-mac.yml", "latest.yml", "latest-windows.json", "latest-windows.json.sig"];
  if (!allowed.includes(name) || !existsSync(join(candidate, name))) { response.writeHead(404).end(); return; }
  const path = join(candidate, name);
  response.writeHead(200, { "Content-Length": statSync(path).size });
  createReadStream(path).pipe(response);
});
await new Promise((yes) => server.listen(0, "127.0.0.1", yes));
const feed = `http://127.0.0.1:${server.address().port}/`;
const children = [];
const launch = async (update) => {
  let endpoint;
  const child = spawn(executable, ["--inspect=127.0.0.1:0", `--user-data-dir=${profile}`], {
    env: { ...process.env, EDGE_EVER_DISABLE_AUTO_UPDATE: update ? "0" : "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
    const path = join(evidence, update ? "old-process.log" : "new-process.log");
    writeFileSync(path, chunk, { flag: "a" });
    endpoint ||= /Debugger listening on (ws:\/\/[^\s]+)/.exec(String(chunk))?.[1];
  });
  await until(() => endpoint, "isolated loopback main-process debugger");
  const socket = new WebSocket(endpoint);
  await new Promise((yes, no) => { socket.addEventListener("open", yes, { once: true }); socket.addEventListener("error", no, { once: true }); });
  let serial = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id && pending.has(message.id)) { const callbacks = pending.get(message.id); pending.delete(message.id); if (message.error) callbacks.reject(new Error(JSON.stringify(message.error))); else callbacks.resolve(message.result); }
  });
  const send = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Debugger command timed out: ${method}`)); }, 20_000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolveCall(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  // The inspector can accept connections before Electron registers its built-in
  // module. Wait for that registration without pausing native startup.
  await until(async () => {
    const ready = await send("Runtime.evaluate", {
      expression: `(() => { try { return !!process.getBuiltinModule('module').createRequire(process.resourcesPath + '/app.asar/package.json')('electron').app; } catch { return false; } })()`,
      returnByValue: true,
    });
    return ready.result?.value === true;
  }, "Electron main-process module registration");
  console.log(`Configuring ${update ? "old" : "updated"} application through its isolated debugger`);
  const expression = `(() => {
    const req = process.getBuiltinModule('module').createRequire(process.resourcesPath + '/app.asar/package.json');
    const { app, net, dialog } = req('electron');
    app.isInApplicationsFolder = () => true;
    app.on('web-contents-created', (_event, contents) => {
      contents.on('console-message', (...args) => {
        const details = args.find(value => value && typeof value === 'object' && typeof value.message === 'string');
        const message = details?.message ?? args.filter(value => typeof value === 'string').join(' ');
        req('node:fs').appendFileSync(${JSON.stringify(join(evidence, update ? "old-renderer.jsonl" : "new-renderer.jsonl"))}, JSON.stringify({message}) + '\\n');
      });
    });
    const configure = () => {
    req('node:fs').writeFileSync(${JSON.stringify(join(evidence, update ? "old-version.json" : "new-version.json"))}, JSON.stringify({version: app.getVersion(), executable: process.execPath}));
    if (${JSON.stringify(update)}) {
      const { autoUpdater } = req('electron-updater');
      autoUpdater.setFeedURL({provider:'generic',url:${JSON.stringify(feed)}});
      autoUpdater.disableDifferentialDownload = true;
      const fetch = net.fetch.bind(net);
      net.fetch = (url, options) => {
        const value = String(url);
        const prefix = 'https://github.com/tianma-if/edgeever/releases/download/v${version}/';
        return fetch(value.startsWith(prefix) ? ${JSON.stringify(feed)} + value.slice(prefix.length) : url, options);
      };
      const install = autoUpdater.quitAndInstall.bind(autoUpdater);
      autoUpdater.quitAndInstall = (silent) => { autoUpdater.autoRunAppAfterInstall = false; return install(silent, false); };
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1);
        return {response: options.buttons?.some(button => /restart|重启/i.test(button)) ? 0 : 1, checkboxChecked:false};
      };
    }
    };
    if (app.isReady()) configure(); else app.once('ready', configure);
    return true;
  })()`;
  console.log("Applying feed selection and dialog automation; package bytes and trust remain unchanged");
  const evaluated = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (evaluated.exceptionDetails) throw new Error(JSON.stringify(evaluated.exceptionDetails));
  console.log("Application startup continues without a debugger pause");
  socket.close(); // Node must not wait for an attached debugger during quit.
  return child;
};
const result = { platform: process.platform, arch: process.arch, candidateVersion: version, candidateRun: process.env.CANDIDATE_RUN };
try {
  await launch(true);
  await until(() => {
    try { return digest(installedAsar) !== originalAsarDigest && (!expectedAsar || digest(installedAsar) === digest(expectedAsar)); } catch { return false; }
  }, "official old release installs the real candidate payload");
  await until(() => children[0].exitCode !== null, "old release exits");
  if (process.platform === "win32") {
    // NSIS copies app.asar before renderer resources. Wait for the installer,
    // not just a changed ASAR, before launching the updated application.
    await until(() => !windowsUpdateInstallerRunning(candidateName), "Windows installer completes all resource copies");
    await wait(1_000);
  }
  if (existsSync(logPath)) renameSync(logPath, join(evidence, "old-desktop.log"));
  await launch(false);
  await until(() => {
    if (!existsSync(logPath)) return false;
    const value = readFileSync(logPath, "utf8");
    return value.includes('"renderer.bootstrap-ready"') && value.includes('"sidecar.ready"');
  }, "updated application opens the same isolated user profile");
  const newVersion = JSON.parse(readFileSync(join(evidence, "new-version.json"), "utf8"));
  if (newVersion.version !== version) throw new Error(`Installed version mismatch: ${newVersion.version}`);
  result.ok = true;
  result.old = JSON.parse(readFileSync(join(evidence, "old-version.json"), "utf8"));
  result.new = newVersion;
  result.installedAsarSha256 = digest(installedAsar);
} catch (error) { result.ok = false; result.error = error.stack; process.exitCode = 1; }
finally {
  if (existsSync(logPath)) writeFileSync(join(evidence, "new-desktop.log"), readFileSync(logPath));
  writeFileSync(join(evidence, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  server.closeAllConnections(); server.close();
}
