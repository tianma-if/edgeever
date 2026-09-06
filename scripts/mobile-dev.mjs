import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

export const LOCAL_ANDROID_REVERSE_PORTS = Object.freeze([8787]);
export const ANDROID_DEVICE_POLL_INTERVAL_MS = 1_000;

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE_DIR = join(PROJECT_ROOT, "apps/mobile");

export const parseAdbDevices = (source) => source
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter(([serial, state]) => serial && state === "device")
  .map(([serial]) => serial);

export const resolveAdbExecutable = (environment = process.env) => {
  for (const sdkRoot of [environment.ANDROID_HOME, environment.ANDROID_SDK_ROOT]) {
    if (!sdkRoot) continue;
    const candidate = join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
    if (existsSync(candidate)) return candidate;
  }
  return "adb";
};

export const buildAdbReverseArguments = (serial, port) => [
  "-s",
  serial,
  "reverse",
  `tcp:${port}`,
  `tcp:${port}`,
];

const startAndroidReverseMonitor = ({
  adbExecutable = resolveAdbExecutable(),
  ports = LOCAL_ANDROID_REVERSE_PORTS,
  pollIntervalMs = ANDROID_DEVICE_POLL_INTERVAL_MS,
} = {}) => {
  const configuredDevices = new Set();
  let unavailableWarningPrinted = false;
  let timer = null;
  let stopped = false;

  const configureConnectedDevices = () => {
    if (stopped) return;
    const devicesResult = spawnSync(adbExecutable, ["devices"], {
      encoding: "utf8",
      timeout: 3_000,
    });
    if (devicesResult.error || devicesResult.status !== 0) {
      if (!unavailableWarningPrinted) {
        const detail = devicesResult.error?.code === "ENOENT"
          ? `cannot find ${adbExecutable}`
          : (devicesResult.stderr?.trim() || devicesResult.error?.message || `exit ${devicesResult.status}`);
        console.warn(`[mobile-dev] Android API forwarding is waiting: ${detail}.`);
        unavailableWarningPrinted = true;
      }
      return;
    }

    unavailableWarningPrinted = false;
    const connectedDevices = new Set(parseAdbDevices(devicesResult.stdout));
    for (const serial of configuredDevices) {
      if (!connectedDevices.has(serial)) configuredDevices.delete(serial);
    }

    for (const serial of connectedDevices) {
      if (configuredDevices.has(serial)) continue;
      let configured = true;
      for (const port of ports) {
        const reverseResult = spawnSync(adbExecutable, buildAdbReverseArguments(serial, port), {
          encoding: "utf8",
          timeout: 3_000,
        });
        if (reverseResult.error || reverseResult.status !== 0) {
          configured = false;
          const detail = reverseResult.stderr?.trim() || reverseResult.error?.message || `exit ${reverseResult.status}`;
          console.warn(`[mobile-dev] Failed to forward ${serial} tcp:${port}: ${detail}`);
        }
      }
      if (configured) {
        configuredDevices.add(serial);
        console.log(`[mobile-dev] ${serial}: ${ports.map((port) => `tcp:${port} -> host tcp:${port}`).join(", ")}`);
      }
    }
  };

  configureConnectedDevices();
  timer = setInterval(configureConnectedDevices, pollIntervalMs);
  timer.unref();
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
};

const runMobileDevelopment = () => {
  const command = process.argv[2] ?? "start";
  if (!new Set(["start", "run:android"]).has(command)) {
    console.error("Usage: bun scripts/mobile-dev.mjs [start|run:android]");
    process.exit(1);
  }

  const stopAndroidReverseMonitor = startAndroidReverseMonitor();
  const expo = spawn(process.execPath, ["--cwd", MOBILE_DIR, "expo", command], {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: "inherit",
  });

  const forwardSignal = (signal) => {
    if (!expo.killed) expo.kill(signal);
  };
  process.once("SIGINT", forwardSignal);
  process.once("SIGTERM", forwardSignal);
  expo.once("error", (error) => {
    stopAndroidReverseMonitor();
    console.error(`[mobile-dev] Cannot start Expo: ${error.message}`);
    process.exitCode = 1;
  });
  expo.once("exit", (code, signal) => {
    stopAndroidReverseMonitor();
    process.exitCode = code ?? (signal ? 1 : 0);
  });
};

if (import.meta.main) runMobileDevelopment();
