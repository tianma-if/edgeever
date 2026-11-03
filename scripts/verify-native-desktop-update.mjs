import { windowsUpdateInstallerRunning, stopWindowsUpdateFixtures } from "./native-update-windows.mjs";
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync, mkdirSync, chmodSync, appendFileSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve, basename, dirname } from "node:path";
import { createHash } from "node:crypto";

if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== "tianma-if/edgeever") {
  throw new Error("Native installer verification is restricted to the official disposable CI runners");
}
const root = resolve(process.argv[2]);
const versions = JSON.parse(readFileSync(join(root, "versions.json"), "utf8"));
const [oldVersion, intermediateVersion, latestVersion] = versions;
const evidence = join(root, "evidence");
mkdirSync(evidence, { recursive: true });
const report = { platform: process.platform, arch: process.arch, sourceSha: process.env.GITHUB_SHA, versions,
  instrumentation: "Full EdgeEver builds with isolated app identity, local feed, command harness and ephemeral Windows trust key; production update controller and native installers are unchanged.",
  scenarios: [] };
let feedVersion = intermediateVersion;
let corruptSignature = false;
let corruptPackage = false;
const requests = [];
const metadataName = process.platform === "darwin" ? "latest-mac.yml" : process.platform === "win32" ? "latest.yml" : "latest-linux.yml";
const packageName = (version) => process.platform === "darwin" ? `EdgeEver-${version}-mac-${process.arch}.zip`
  : process.platform === "win32" ? `EdgeEver-${version}-windows-x64.exe` : `EdgeEver-${version}-linux-x64.AppImage`;
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const parts = pathname.split("/").filter(Boolean);
  let version = feedVersion;
  let name;
  if (parts[0] === "feed" && parts.length === 2) name = parts[1];
  else if (parts[0] === "release" && parts.length === 3 && versions.includes(parts[1])) {
    version = parts[1]; name = parts[2];
  }
  if (!name || basename(name) !== name || ![metadataName, "latest-windows.json", "latest-windows.json.sig", packageName(version)].includes(name)) {
    response.writeHead(404).end(); return;
  }
  const path = join(root, version, name);
  if (!existsSync(path)) { response.writeHead(404).end(); return; }
  requests.push({ at: new Date().toISOString(), version, name });
  if (corruptSignature && name === "latest-windows.json.sig") {
    const signature = JSON.parse(readFileSync(path, "utf8"));
    signature.signature = Buffer.alloc(64).toString("base64");
    response.writeHead(200).end(JSON.stringify(signature)); return;
  }
  response.writeHead(200, { "Content-Length": statSync(path).size, "Content-Type": name.endsWith(".yml") ? "text/yaml" : "application/octet-stream" });
  if (corruptPackage && name === packageName(version)) {
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] ^= 1;
    response.end(bytes); return;
  }
  createReadStream(path).pipe(response);
});
await new Promise((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
const feed = `http://127.0.0.1:${server.address().port}`;
let commandId = 0;
const children = [];
const readEvents = (path) => !existsSync(path) ? [] : readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const wait = (ms) => new Promise((yes) => setTimeout(yes, ms));
const until = async (predicate, description, timeout = 180_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await wait(200);
  }
  throw new Error(`Timed out: ${description}`);
};
const installBaseline = async (directory) => {
  const installed = join(directory, "installed");
  mkdirSync(installed, { recursive: true });
  if (process.platform === "darwin") {
    const unpack = spawnSync("ditto", ["-x", "-k", join(root, oldVersion, packageName(oldVersion)), installed], { encoding: "utf8" });
    if (unpack.status !== 0) throw new Error(unpack.stderr);
    const bundle = join(installed, "EdgeEver Update Verification.app");
    const metadata = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", join(bundle, "Contents/Info.plist")], { encoding: "utf8" });
    if (metadata.status !== 0) throw new Error("Cannot read the signed fixture's CFBundleExecutable");
    return join(bundle, "Contents/MacOS", metadata.stdout.trim());
  }
  if (process.platform === "win32") {
    stopWindowsUpdateFixtures();
    const installer = join(root, oldVersion, packageName(oldVersion));
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = spawnSync(installer, ["/S", `/D=${installed}`], {
      stdio: "ignore", windowsHide: true, timeout: 120_000,
      env: { ...process.env, EDGE_EVER_DISABLE_AUTO_UPDATE: "1" },
    });
      if (result.status === 0) break;
      stopWindowsUpdateFixtures();
      await wait(2_000);
    }
    if (result.status !== 0) throw new Error(`Baseline NSIS install failed: ${result.status}`);
    const executable = join(installed, "EdgeEverUpdateVerifier.exe");
    spawnSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='EdgeEverUpdateVerifier.exe'" | Where-Object { $_.ExecutablePath -eq $env:VERIFIER_INSTALLED_EXE } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }`], {
      stdio: "ignore", env: { ...process.env, VERIFIER_INSTALLED_EXE: executable }, timeout: 30_000,
    });
    return executable;
  }
  const appImage = join(installed, "EdgeEver.AppImage");
  await cp(join(root, oldVersion, packageName(oldVersion)), appImage);
  chmodSync(appImage, 0o755);
  return appImage;
};
const stopFixture = async (events) => {
  // Only PIDs written by the isolated test app are eligible for termination.
  for (const entry of events.filter((value) => value.event === "boot")) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(entry.pid), "/T", "/F"], { stdio: "ignore" });
    else { try { process.kill(entry.pid, "SIGTERM"); } catch {} }
  }
};

try {
  for (const scenario of ["install-latest", "quit-latest", "reject-corrupt-update"]) {
    const directory = join(evidence, scenario);
    mkdirSync(directory, { recursive: true });
    feedVersion = intermediateVersion;
    const eventsPath = join(directory, "events.jsonl");
    const commandPath = join(directory, "command.json");
    const profile = join(directory, "profile");
    mkdirSync(profile, { recursive: true });
    const env = { ...process.env,
      EDGE_EVER_UPDATE_VERIFIER_PROFILE: profile, EDGE_EVER_UPDATE_VERIFIER_LOG: eventsPath,
      EDGE_EVER_UPDATE_VERIFIER_COMMAND: commandPath, EDGE_EVER_UPDATE_VERIFIER_FEED: feed,
      EDGE_EVER_UPDATE_VERIFIER_PUBLIC_KEY: join(root, "public-key.pem"),
    };
    // Squirrel/LaunchServices can relaunch without inheriting environment.
    // Every signed fixture embeds only this fixed config path, never secrets.
    writeFileSync(join(root, "runtime.json"), JSON.stringify({
      EDGE_EVER_UPDATE_VERIFIER_PROFILE: profile, EDGE_EVER_UPDATE_VERIFIER_LOG: eventsPath,
      EDGE_EVER_UPDATE_VERIFIER_COMMAND: commandPath, EDGE_EVER_UPDATE_VERIFIER_FEED: feed,
      EDGE_EVER_UPDATE_VERIFIER_PUBLIC_KEY: join(root, "public-key.pem"),
    }));
    const executable = await installBaseline(directory);
    const launch = () => {
      if (!existsSync(executable)) throw new Error(`Installed fixture executable missing: ${executable}`);
      const child = spawn(executable, [], { env, stdio: ["ignore", "pipe", "pipe"] });
      child.on("error", (error) => appendFileSync(join(directory, "process.log"), `${error.stack}\n`));
      child.stdout.on("data", (data) => appendFileSync(join(directory, "process.log"), data));
      child.stderr.on("data", (data) => appendFileSync(join(directory, "process.log"), data));
      children.push(child);
      return child;
    };
    const events = () => readEvents(eventsPath);
    const command = async (action) => {
      const id = ++commandId;
      writeFileSync(commandPath, JSON.stringify({ id, action }));
      return until(() => events().find((entry) => entry.id === id), `command ${action}`);
    };
    try {
      launch();
      await until(() => events().some((entry) => entry.event === "ready" && entry.version === intermediateVersion), "intermediate package downloaded");
      feedVersion = latestVersion;
      if (scenario === "reject-corrupt-update") {
        if (process.platform === "win32") corruptSignature = true;
        else corruptPackage = true;
        const result = await command("check");
        const diagnostics = readEvents(join(profile, "logs/desktop.log"));
        if (!diagnostics.some((entry) => entry.event === "update.check-failed" || entry.event === "update.download-failed")) {
          throw new Error(`Corrupt metadata/package was not rejected: ${JSON.stringify(result)}`);
        }
        if (diagnostics.some((entry) => entry.event === "update.install-confirmed")) throw new Error("An invalid update triggered installation");
        corruptSignature = false;
        corruptPackage = false;
        await command("check");
        await until(() => events().some((entry) => entry.event === "ready" && entry.version === latestVersion), "valid replacement recovers after corruption");
      }
      if (scenario === "quit-latest") {
        await command("quit");
        await until(() => {
          const log = readEvents(join(profile, "logs/desktop.log"));
          return log.some((entry) => entry.event === "session.quit");
        }, "normal application shutdown");
        const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
        const expected = process.platform === "darwin"
          ? join(root, latestVersion, process.arch === "arm64" ? "mac-arm64" : "mac", "EdgeEver Update Verification.app/Contents/Resources/app.asar")
          : process.platform === "win32" ? join(root, latestVersion, "win-unpacked/resources/app.asar")
          : join(root, latestVersion, packageName(latestVersion));
        const installedPayload = process.platform === "darwin" ? join(dirname(executable), "../Resources/app.asar")
          : process.platform === "win32" ? join(dirname(executable), "resources/app.asar") : executable;
        const recordedDigest = join(root, latestVersion, "payload.sha256");
        const expectedDigest = existsSync(recordedDigest) ? readFileSync(recordedDigest, "utf8").trim() : digest(expected);
        await until(() => {
          try { return digest(installedPayload) === expectedDigest; } catch { return false; }
        }, "native installation replaces the actual installed payload", 240_000);
        if (process.platform === "win32") {
          await until(() => !windowsUpdateInstallerRunning(packageName(latestVersion)), "Windows native installer completes");
        }
        await wait(1_000);
        if (events().filter((entry) => entry.event === "boot").length !== 1) throw new Error("Normal quit relaunched the application");
        // Confirm the installed executable itself now contains the new version.
        launch();
      } else {
        await command("install");
      }
      await until(() => events().some((entry) => entry.event === "boot" && entry.version === latestVersion), "latest installed application launches", 240_000);
      await until(() => {
        const entries = readEvents(join(profile, "logs/desktop.log"));
        const lastSession = entries.findLastIndex((entry) => entry.event === "session.started");
        const currentSession = entries.slice(lastSession);
        return currentSession.some((entry) => entry.event === "renderer.bootstrap-ready") && currentSession.some((entry) => entry.event === "sidecar.ready");
      }, "latest installed renderer and sidecar are ready");
      const diagnostics = readEvents(join(profile, "logs/desktop.log"));
      const installs = diagnostics.filter((entry) => entry.event === "update.install-confirmed");
      const boots = events().filter((entry) => entry.event === "boot").map((entry) => entry.version);
      if (boots.includes(intermediateVersion) || installs.length !== 1 || installs[0].version !== latestVersion) {
        throw new Error(`Unexpected installation sequence: ${JSON.stringify({ boots, installs })}`);
      }
      if (process.platform === "linux") {
        const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
        if (digest(executable) !== digest(join(root, latestVersion, packageName(latestVersion)))) throw new Error("Installed AppImage digest differs from the selected release");
      }
      report.scenarios.push({ scenario, ok: true, boots, installs, executable });
      writeFileSync(join(directory, "result.json"), JSON.stringify(report.scenarios.at(-1), null, 2));
    } finally {
      await stopFixture(events());
      if (process.platform === "win32") {
        stopWindowsUpdateFixtures();
        await until(() => !windowsUpdateInstallerRunning(packageName(latestVersion)), "previous fixture installer releases its process lock");
      }
      await wait(1_000);
    }
  }
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  writeFileSync(join(evidence, "requests.json"), JSON.stringify(requests, null, 2));
  writeFileSync(join(evidence, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  for (const child of children) { if (child.exitCode === null) child.kill("SIGTERM"); }
  server.closeAllConnections();
  server.close();
  // Keep logs; remove installed fixture apps and anonymous databases from artifacts.
  for (const scenario of ["install-latest", "quit-latest", "reject-corrupt-update"]) {
    await rm(join(evidence, scenario, "installed"), { recursive: true, force: true }).catch(() => {});
  }
}
