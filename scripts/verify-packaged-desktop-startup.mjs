import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const requestedExecutablePath = process.argv[2]?.trim();
const executablePath = requestedExecutablePath ? resolve(requestedExecutablePath) : "";
if (!executablePath || !existsSync(executablePath) || !statSync(executablePath).isFile()) {
  throw new Error(`Packaged desktop executable is missing: ${executablePath || "<not provided>"}`);
}

const userDataDirectory = mkdtempSync(join(tmpdir(), "edgeever-packaged-startup-"));
const diagnosticLogPath = join(userDataDirectory, "logs", "desktop.log");
const output = [];
let processError = null;
const child = spawn(executablePath, [`--user-data-dir=${userDataDirectory}`], {
  env: {
    ...process.env,
    EDGE_EVER_DISABLE_AUTO_UPDATE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
const childClosed = new Promise((resolveClosed) => child.once("close", resolveClosed));
child.on("error", (error) => { processError = error; });
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

const timeoutMs = Number(process.env.EDGE_EVER_DESKTOP_STARTUP_TIMEOUT_MS) || 45_000;
const deadline = Date.now() + timeoutMs;
let startupReady = false;
let lastLog = "";
const requiredEvents = new Set(["sidecar.ready", "renderer.bootstrap-ready"]);
const observedEvents = new Set();
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const removeUserDataDirectory = async () => {
  let lastError = null;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await rm(userDataDirectory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code)) break;
      if (attempt < 20) await wait(250);
    }
  }
  console.warn(`Temporary profile cleanup failed without changing the packaged startup result: ${lastError?.message || lastError}`);
};

try {
  while (Date.now() < deadline) {
    if (existsSync(diagnosticLogPath)) {
      lastLog = readFileSync(diagnosticLogPath, "utf8");
      for (const line of lastLog.split(/\r?\n/)) {
        try {
          const event = JSON.parse(line).event;
          if (typeof event === "string") observedEvents.add(event);
        } catch { /* Ignore a partial trailing log line. */ }
      }
      if ([...requiredEvents].every((event) => observedEvents.has(event))) {
        startupReady = true;
        break;
      }
    }
    if (processError || child.exitCode !== null) break;
    await wait(100);
  }

  if (!startupReady) {
    throw new Error([
      `Packaged desktop did not report renderer readiness within ${timeoutMs}ms (exit=${child.exitCode ?? "running"}).`,
      `Missing events: ${[...requiredEvents].filter((event) => !observedEvents.has(event)).join(", ") || "none"}`,
      processError && `Process error: ${processError.message}`,
      lastLog && `Diagnostic log:\n${lastLog}`,
      output.length > 0 && `Process output:\n${output.join("")}`,
    ].filter(Boolean).join("\n\n"));
  }

  console.log(JSON.stringify({ ok: true, executablePath, events: [...requiredEvents] }));
} finally {
  if (child.exitCode === null && child.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGTERM");
    }
    await Promise.race([childClosed, wait(5_000)]);
  }
  await removeUserDataDirectory();
}
