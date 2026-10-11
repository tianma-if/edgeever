import { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage, ipcMain, session, net, protocol, shell, dialog, safeStorage, clipboard, ClipboardItem, powerMonitor, desktopCapturer, screen } from "electron";
import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { release as operatingSystemRelease } from "node:os";
import { SidecarRpcClient } from "./rpc.mjs";
import { resourceRequestHeaders } from "./resource-request.mjs";
import { downloadContentDispositionFromRequest, isSafeResourceId, parseByteRangeHeader, resourceIdFromRequest } from "./resource-url.mjs";
import { isSupportedAssociatedFile } from "./file-association.mjs";
import { createWeChatShareController } from "./wechat-share-import.mjs";
import { enableMacShareExtension } from "./share-extension-registration.mjs";
import { registerWindowsShareMenu, shareFilePathsFromCommandLine } from "./windows-share-menu.mjs";
import { accountDataDirectory, accountScopeKey } from "./account-scope.mjs";
import { rotateDiagnosticLog } from "./diagnostic-log.mjs";
import { restrictDirectory, restrictFile } from "./file-permissions.mjs";
import {
  STAGED_RESOURCE_PART_BYTES,
  normalizeStagedResourceMetadataInput,
  normalizeStagedResourcePart,
  remapStagedResourceMetadata,
} from "./staged-resource.mjs";
import { cacheStagedResourceBytes, listPendingStagedResources, listStagedResourceMetadata, readStagedResourceMetadata, recordStagedResourceAlias } from "./staged-resource-alias.mjs";
import {
  isMountedDiskImageVolume,
  isMountedInstallerPath,
  mountedInstallerCandidates,
} from "./installation-location.mjs";
import { userDataDirectoryFromArguments } from "./user-data-directory.mjs";
import { isAllowedPrintPreviewUrl } from "./window-open-policy.mjs";
import { showWindow } from "./window-visibility.mjs";
import { globalShortcutAccelerator, normalizeGlobalShortcutBinding, replaceGlobalShortcut, toggleMainWindow } from "./global-shortcut.mjs";
import { trayIconPath } from "./tray-icon.mjs";
import { writeImageClipboard, writeRichClipboard, writeTextClipboard } from "./clipboard-write.mjs";
import { captureScreenToNote, createScreenshotCaptureGuard, screenshotImportIpcPayload, writeScreenshotTempPath } from "./screenshot-capture.mjs";
import { LocalDataResetError, scheduleMacLocalDataReset } from "./local-data-reset.mjs";
import { buildDesktopDiagnosticIssueUrl, normalizeDesktopDiagnostic } from "./desktop-diagnostics.mjs";
import { readDesktopDeviceModel } from "./desktop-device-model.mjs";
import { createRendererStartupGuard } from "./renderer-startup-guard.mjs";
import { waitForChildProcessSpawn } from "./child-process-start.mjs";
import { ScheduledTaskScheduler } from "./scheduled-task-scheduler.mjs";
import { desktopMenuCopy } from "./desktop-menu.mjs";
import { buildEditContextMenuTemplate } from "./edit-context-menu.mjs";
import {
  fetchTrustedWindowsUpdate,
  verifyDownloadedWindowsUpdate,
} from "./windows-update-trust.mjs";
import electronUpdater from "electron-updater";
import { createUpdateDiagnostic } from "./update-diagnostics.mjs";
import { normalizeUpdateProgress } from "./update-progress.mjs";
import { inspectWindowsTaskbarShortcuts } from "./windows-taskbar-diagnostics.mjs";
import { createPluginPublicNetworkRuntime } from "./plugin-public-network.mjs";
import { createAiDirectRuntime } from "./ai-direct.mjs";
import { createAcpHostRuntime, registerAcpIpc } from "./acp-host.mjs";
import { shouldQuitAfterAllWindowsClosed } from "./window-lifecycle.mjs";
import {
  RENDERER_HIBERNATE_PREPARE_TIMEOUT_MS,
  createRendererHibernateController,
  workingSetBytesFromProcessMemoryInfo,
} from "./renderer-hibernate.mjs";
import {
  DESKTOP_APP_ENTRY_URL,
  DESKTOP_APP_ORIGIN,
  DESKTOP_APP_SCHEME,
  createDesktopAppProtocolHandler,
} from "./app-protocol.mjs";
import {
  RENDERER_STORAGE_MIGRATION_MARKER,
  migrateRendererStorageOrigin,
} from "./renderer-storage-migration.mjs";

const { autoUpdater } = electronUpdater;

const linuxUpdateTestMode = process.platform === "linux"
  && process.env.GITHUB_ACTIONS === "true"
  && process.env.EDGE_EVER_DESKTOP_UPDATE_TEST === "1";
const linuxUpdateTestFeedUrl = linuxUpdateTestMode
  ? process.env.EDGE_EVER_DESKTOP_UPDATE_TEST_FEED_URL || ""
  : "";
const requestedUserDataDirectory = linuxUpdateTestMode
  ? process.env.EDGE_EVER_DESKTOP_UPDATE_TEST_USER_DATA || userDataDirectoryFromArguments(process.argv)
  : userDataDirectoryFromArguments(process.argv);
if (requestedUserDataDirectory) app.setPath("userData", requestedUserDataDirectory);

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(currentDirectory, app.isPackaged ? "../../.." : "../../../..");
/**
 * Force Dock to use our multi-resolution app icon. Bundle Info.plist is still
 * the primary source; this covers cases where Launch Services/Dock cache a
 * blank tile after overwrite installs.
 */
const applyMacDockIcon = () => {
  if (process.platform !== "darwin" || !app.dock) return;
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icon.icns"), join(process.resourcesPath, "icon.png")]
    : [
        join(projectRoot, "apps/desktop/assets/icon.icns"),
        join(projectRoot, "apps/desktop/assets/icon.png"),
        join(projectRoot, "apps/web/public/pwa-512x512.png"),
      ];
  for (const iconPath of candidates) {
    if (!existsSync(iconPath)) continue;
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      app.dock.setIcon(image);
      return;
    }
  }
};
const webUrl = process.env.EDGE_EVER_DESKTOP_WEB_URL || "http://127.0.0.1:5173";
// A packaged desktop app is self-hosted-client software: its instance URL must
// come from the user-facing first-run setup, never from the build environment.
// Environment URLs are intentionally limited to local development.
const apiBaseUrl = (!app.isPackaged && (process.env.EDGE_EVER_API_URL || process.env.EDGE_EVER_DESKTOP_WEB_URL)
  ? process.env.EDGE_EVER_API_URL || webUrl
  : "").replace(/\/$/, "");
let configuredApiBaseUrl = apiBaseUrl;
const packagedSidecarName = process.platform === "win32" ? "edgeever-sidecar.exe" : "edgeever-sidecar";
const sidecarPath = process.env.EDGE_EVER_SIDECAR_PATH || (app.isPackaged
  ? join(process.resourcesPath, "sidecar", packagedSidecarName)
  : join(projectRoot, "crates/desktop-sidecar/target/debug", packagedSidecarName));

let mainWindow;
let sidecarProcess;
let sidecar;
let tray;
let isQuitting = false;
let updateState = "idle";
let updateError = null;
let updateProgress = null;
let updateCheckInFlight = null;
let updateDownloadInFlight = null;
let updateCheckTimer = null;
let lastUpdateCheckAt = 0;
let downloadedUpdateVersion = null;
let promptedUpdateVersion = null;
let trustedWindowsUpdate = null;
let windowsDownloadedUpdateVerified = false;
let sidecarScopeKey = "anonymous";
let activeAccountId = null;
let shutdownCleanupStarted = false;
let sidecarRestartTimer = null;
let sidecarRestartAttempts = 0;
let sidecarRestartInFlight = false;
let localDataResetScheduled = false;
let rendererCrashDialogOpen = false;
let rendererStartupFailureDialogOpen = false;
let rendererStartupGuard = null;
let rendererUnresponsiveTimer = null;
const pluginPublicNetwork = createPluginPublicNetworkRuntime();
const aiDirect = createAiDirectRuntime();
let rendererUnresponsiveDialogOpen = false;
let recoveredAfterAbnormalExit = false;
let usePrivateAppProtocol = false;
let rendererOriginMigrationInProgress = false;
const pendingScheduledTaskRuns = [];
const sendScheduledTaskRun = (task, scheduledFor) => {
  const payload = { task, scheduledFor: scheduledFor.toISOString() };
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) {
    pendingScheduledTaskRuns.push(payload);
    return;
  }
  mainWindow.webContents.send("desktop:scheduled-task", payload);
};
const scheduledTaskScheduler = new ScheduledTaskScheduler({
  onRun: async (task, scheduledFor) => sendScheduledTaskRun(task, scheduledFor),
  onError: (error, task) => void writeDiagnostic("scheduled-task.scheduler-error", {
    taskId: task?.id,
    message: error instanceof Error ? error.message : String(error),
  }),
});
const updateCheckIntervalMs = 60 * 60 * 1_000;
const updateCheckFocusThrottleMs = 15 * 60 * 1_000;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const windowStatePath = () => join(app.getPath("userData"), "window-state.json");
const globalShortcutPath = () => join(app.getPath("userData"), "global-shortcut.json");
const instanceUrlPath = () => join(app.getPath("userData"), "instance-url");
const sessionTokenPath = () => join(app.getPath("userData"), "session-token");
const crashMarkerPath = () => join(app.getPath("userData"), "last-session-active");
const installationMarkerPath = () => join(app.getPath("userData"), "installation-confirmed");
const logPath = () => join(app.getPath("userData"), "logs", "desktop.log");
let desktopSessionToken = "";
let configuredGlobalShortcut = null;
let registeredGlobalShortcut = null;
let globalShortcutUpdate = Promise.resolve();
const globalShortcutState = () => ({
  binding: configuredGlobalShortcut,
  registered: Boolean(registeredGlobalShortcut && globalShortcut.isRegistered(globalShortcutAccelerator(registeredGlobalShortcut))),
});
const persistGlobalShortcut = async (binding) => {
  const temporaryPath = `${globalShortcutPath()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify({ binding }), { mode: 0o600 });
    await rename(temporaryPath, globalShortcutPath());
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
};
const toggleWindowFromGlobalShortcut = () => toggleMainWindow({
  window: mainWindow,
  showWindow,
  activateApp: process.platform === "darwin" ? () => app.show() : undefined,
});
const loadGlobalShortcut = async () => {
  try {
    const stored = JSON.parse(await readFile(globalShortcutPath(), "utf8"));
    configuredGlobalShortcut = normalizeGlobalShortcutBinding(stored?.binding);
    if (configuredGlobalShortcut === undefined) configuredGlobalShortcut = null;
  } catch {
    configuredGlobalShortcut = null;
  }
  const accelerator = globalShortcutAccelerator(configuredGlobalShortcut);
  if (!accelerator) return;
  try {
    if (globalShortcut.register(accelerator, toggleWindowFromGlobalShortcut)) {
      registeredGlobalShortcut = configuredGlobalShortcut;
      void writeDiagnostic("global-shortcut.registered", { accelerator });
    } else {
      void writeDiagnostic("global-shortcut.registration-failed", { accelerator });
    }
  } catch (error) {
    void writeDiagnostic("global-shortcut.registration-failed", {
      accelerator,
      message: error instanceof Error ? error.message : String(error),
    });
    // Keep the preference so the user can change it when registration fails.
  }
};
const setGlobalShortcut = (value) => {
  const next = normalizeGlobalShortcutBinding(value);
  if (next === undefined) return Promise.resolve({ ...globalShortcutState(), error: "invalid" });
  const update = async () => {
    const result = await replaceGlobalShortcut({
      globalShortcut,
      previous: registeredGlobalShortcut,
      next,
      callback: toggleWindowFromGlobalShortcut,
      persist: persistGlobalShortcut,
    });
    if (!result.ok) {
      void writeDiagnostic("global-shortcut.update-failed", { reason: result.reason });
      return { ...globalShortcutState(), error: result.reason };
    }
    configuredGlobalShortcut = next;
    registeredGlobalShortcut = next;
    return globalShortcutState();
  };
  const result = globalShortcutUpdate.then(update, update);
  globalShortcutUpdate = result.then(() => undefined, () => undefined);
  return result;
};
const sidecarDataDirectory = (accountId = null) => {
  return accountId
    ? accountDataDirectory(app.getPath("userData"), configuredApiBaseUrl, accountId)
    : app.getPath("userData");
};
const legacyDataDirectory = () => app.getPath("userData");
const stagedResourceDirectory = () => join(sidecarDataDirectory(activeAccountId), "resource-outbox");
const resourceCacheDirectory = () => join(sidecarDataDirectory(activeAccountId), "resource-cache");

const migrateLegacyAccountData = async (accountId) => {
  if (!accountId) return;
  const source = legacyDataDirectory();
  const destination = sidecarDataDirectory(accountId);
  if (existsSync(join(destination, "edgeever.sqlite")) || !existsSync(join(source, "edgeever.sqlite"))) return;
  await mkdir(destination, { recursive: true });
  await restrictDirectory(destination);
  for (const name of ["edgeever.sqlite", "edgeever.sqlite-wal", "edgeever.sqlite-shm", "backups", "resource-outbox", "resource-cache"]) {
    const sourcePath = join(source, name);
    if (existsSync(sourcePath)) await rename(sourcePath, join(destination, name));
  }
  void writeDiagnostic("sidecar.legacy-data-migrated", { scope: accountScopeKey(configuredApiBaseUrl, accountId) });
};

protocol.registerSchemesAsPrivileged([{
  scheme: DESKTOP_APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}, {
  scheme: "edgeever-resource",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}, {
  scheme: "edgeever-staged",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const writeDiagnostic = async (event, details = {}) => {
  try {
    const path = logPath();
    await mkdir(join(app.getPath("userData"), "logs"), { recursive: true });
    await restrictDirectory(join(app.getPath("userData"), "logs"));
    await rotateDiagnosticLog(path);
    await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`);
    await restrictFile(path);
  } catch {
    // Diagnostics must never prevent the desktop app from starting or quitting.
  }
};

let cachedDesktopDeviceModel;

const desktopDeviceModel = () => {
  if (cachedDesktopDeviceModel === undefined) {
    cachedDesktopDeviceModel = readDesktopDeviceModel() || "unknown";
  }
  return cachedDesktopDeviceModel;
};

const desktopRuntimeSystemInfo = () => ({
  appVersion: app.getVersion(),
  autoUpdateSupported: true,
  platform: process.platform,
  architecture: process.arch,
  deviceModel: desktopDeviceModel(),
  osVersion: process.getSystemVersion?.() || "unknown",
  osRelease: operatingSystemRelease(),
  electron: process.versions.electron || "unknown",
  chrome: process.versions.chrome || "unknown",
  dataDir: sidecarDataDirectory(activeAccountId),
});

const desktopDiagnosticSystemInfo = async () => {
  let gpu = "unknown";
  let gpuFeatures = "unknown";
  try {
    const gpuInfo = await app.getGPUInfo("basic");
    gpu = (gpuInfo.gpuDevice || []).map((device) => [
      device.active === true ? "active" : "inactive",
      device.deviceString,
      device.vendorId,
      device.deviceId,
      device.driverVendor,
      device.driverVersion,
    ].filter((value) => value !== undefined && value !== "").join(":"))
      .join(", ") || "unknown";
  } catch {
    // GPU diagnostics are useful but must never block issue reporting.
  }
  try {
    gpuFeatures = Object.entries(app.getGPUFeatureStatus()).map(([name, status]) => `${name}=${status}`).join(", ");
  } catch {
    // Some renderer failures can also make GPU feature inspection unavailable.
  }
  return {
    ...desktopRuntimeSystemInfo(),
    gpu,
    gpuFeatures,
  };
};

const openDesktopDiagnosticIssue = async (details) => {
  const diagnostic = normalizeDesktopDiagnostic(details);
  await writeDiagnostic("renderer.issue-opened", diagnostic);
  await shell.openExternal(buildDesktopDiagnosticIssueUrl({
    diagnostic,
    systemInfo: await desktopDiagnosticSystemInfo(),
  }));
};

const handleRendererProcessGone = async (details) => {
  if (isQuitting || details.reason === "clean-exit" || rendererCrashDialogOpen) return;
  rendererCrashDialogOpen = true;
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: isChinese ? "EdgeEver 页面意外停止" : "EdgeEver page stopped unexpectedly",
      message: isChinese ? "问题已记录，可以重新加载页面继续使用。" : "The problem was recorded. You can reload the page to continue.",
      detail: isChinese
        ? "如需反馈，可先检查 EdgeEver 自动生成并脱敏的公开 GitHub Issue，再决定是否提交。"
        : "To report it, review the redacted public GitHub Issue generated by EdgeEver before submitting.",
      buttons: isChinese ? ["报告到 GitHub", "重新加载", "关闭"] : ["Report to GitHub", "Reload", "Close"],
      defaultId: 1,
      cancelId: 2,
    });
    if (result.response === 0) await openDesktopDiagnosticIssue({ kind: "renderer-process-gone", ...details });
    if (result.response === 0 || result.response === 1) mainWindow?.webContents.reload();
  } finally {
    rendererCrashDialogOpen = false;
  }
};

const showRendererStartupFailure = async (details) => {
  if (isQuitting || rendererStartupFailureDialogOpen || !mainWindow || mainWindow.isDestroyed()) return;
  rendererStartupFailureDialogOpen = true;
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  const reason = String(details?.message || details?.errorDescription || details?.kind || "unknown").slice(0, 1000);
  await writeDiagnostic("renderer.startup-failed", { ...details, reason });
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: isChinese ? "EdgeEver 启动失败" : "EdgeEver failed to start",
      message: isChinese ? "页面没有成功启动。错误已经写入诊断日志。" : "The page did not start successfully. The error was written to the diagnostic log.",
      detail: `${reason}\n\n${logPath()}`,
      buttons: isChinese ? ["打开日志位置", "重新加载", "关闭"] : ["Show log", "Reload", "Close"],
      defaultId: 1,
      cancelId: 2,
    });
    if (result.response === 0) shell.showItemInFolder(logPath());
    if (result.response === 1 && mainWindow && !mainWindow.isDestroyed()) {
      armRendererStartupGuard();
      mainWindow.webContents.reload();
    }
  } finally {
    rendererStartupFailureDialogOpen = false;
  }
};

const armRendererStartupGuard = () => {
  rendererStartupGuard?.complete();
  rendererStartupGuard = createRendererStartupGuard({
    onFailure: (details) => { void showRendererStartupFailure(details); },
  });
  rendererStartupGuard.arm();
};

const clearRendererUnresponsiveTimer = () => {
  if (!rendererUnresponsiveTimer) return;
  clearTimeout(rendererUnresponsiveTimer);
  rendererUnresponsiveTimer = null;
};

const showRendererUnresponsive = async () => {
  rendererUnresponsiveTimer = null;
  if (isQuitting || rendererUnresponsiveDialogOpen || !mainWindow || mainWindow.isDestroyed()) return;
  rendererUnresponsiveDialogOpen = true;
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: isChinese ? "EdgeEver 页面无响应" : "EdgeEver page is not responding",
      message: isChinese ? "页面持续无响应。你可以重新加载或先查看诊断信息。" : "The page remains unresponsive. You can reload it or review diagnostics first.",
      buttons: isChinese ? ["报告到 GitHub", "重新加载", "继续等待"] : ["Report to GitHub", "Reload", "Keep waiting"],
      defaultId: 1,
      cancelId: 2,
    });
    if (result.response === 0) await openDesktopDiagnosticIssue({ kind: "renderer-unresponsive" });
    if ((result.response === 0 || result.response === 1) && mainWindow && !mainWindow.isDestroyed()) {
      armRendererStartupGuard();
      mainWindow.webContents.reload();
    }
  } finally {
    rendererUnresponsiveDialogOpen = false;
  }
};

const showMainStartupFailure = async (error) => {
  const message = String(error?.message || error).slice(0, 2000);
  await writeDiagnostic("main.startup-failed", { message, stack: error?.stack });
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  const options = {
    type: "error",
    title: isChinese ? "EdgeEver 无法启动" : "EdgeEver could not start",
    message: isChinese ? "桌面应用启动失败。错误已经写入诊断日志。" : "The desktop application failed to start. The error was written to the diagnostic log.",
    detail: `${message}\n\n${logPath()}`,
    buttons: isChinese ? ["打开日志位置", "关闭"] : ["Show log", "Close"],
    defaultId: 0,
    cancelId: 1,
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response === 0) shell.showItemInFolder(logPath());
  app.quit();
};

const execFileAsync = (command, argumentsList) => new Promise((resolve, reject) => {
  execFile(command, argumentsList, { encoding: "utf8" }, (error, stdout, stderr) => {
    if (error) {
      error.stderr = stderr;
      reject(error);
      return;
    }
    resolve({ stdout, stderr });
  });
});

const ejectMountedMacInstallers = async () => {
  if (!app.isPackaged || process.platform !== "darwin" || isMountedInstallerPath(app.getAppPath())) return;

  let volumeNames;
  let diskImageInfo;
  try {
    const entries = await readdir("/Volumes", { withFileTypes: true });
    volumeNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    ({ stdout: diskImageInfo } = await execFileAsync("/usr/bin/hdiutil", ["info"]));
  } catch (error) {
    void writeDiagnostic("installation.volume-scan-failed", { message: error.message });
    return;
  }

  for (const candidate of mountedInstallerCandidates(volumeNames)) {
    if (!isMountedDiskImageVolume(diskImageInfo, candidate.volumePath)) continue;
    const infoPlist = join(candidate.appPath, "Contents", "Info.plist");
    if (!existsSync(infoPlist)) continue;
    try {
      const { stdout } = await execFileAsync("/usr/bin/plutil", [
        "-extract",
        "CFBundleIdentifier",
        "raw",
        "-o",
        "-",
        infoPlist,
      ]);
      if (stdout.trim() !== "org.edgeever.desktop") continue;
      let ejectError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await execFileAsync("/usr/sbin/diskutil", ["eject", candidate.volumePath]);
          ejectError = null;
          break;
        } catch (error) {
          ejectError = error;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (ejectError) throw ejectError;
      void writeDiagnostic("installation.volume-ejected", { volumePath: candidate.volumePath });
    } catch (error) {
      void writeDiagnostic("installation.volume-eject-failed", {
        volumePath: candidate.volumePath,
        message: error.message,
      });
    }
  }
};

process.on("uncaughtException", (error) => { void writeDiagnostic("main.uncaught-exception", { message: error.message, stack: error.stack }); });
process.on("unhandledRejection", (reason) => { void writeDiagnostic("main.unhandled-rejection", { message: reason instanceof Error ? reason.message : String(reason) }); });

const readWindowState = async () => {
  try {
    const state = JSON.parse(await readFile(windowStatePath(), "utf8"));
    return { width: Number(state.width) || 1440, height: Number(state.height) || 960, x: Number.isFinite(state.x) ? state.x : undefined, y: Number.isFinite(state.y) ? state.y : undefined, isMaximized: Boolean(state.isMaximized) };
  } catch {
    return { width: 1440, height: 960, x: undefined, y: undefined, isMaximized: false };
  }
};

const saveWindowState = async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  await writeFile(windowStatePath(), JSON.stringify({ ...bounds, isMaximized: mainWindow.isMaximized() }));
};

const loadConfiguredApiBaseUrl = async () => {
  try {
    const stored = (await readFile(instanceUrlPath(), "utf8")).trim().replace(/\/$/, "");
    if (stored.startsWith("http://") || stored.startsWith("https://")) configuredApiBaseUrl = stored;
  } catch {
    // A first-run desktop app has no configured instance yet.
  }
};

const loadDesktopSessionToken = async () => {
  try {
    const encrypted = await readFile(sessionTokenPath());
    desktopSessionToken = safeStorage.decryptString(encrypted);
  } catch {
    // Existing installations have no main-process credential until the
    // renderer migrates the legacy localStorage token after upgrading.
    desktopSessionToken = "";
  }
};

const saveDesktopSessionToken = async (value) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized.length > 4096) throw new Error("Desktop session token is too long");
  desktopSessionToken = normalized;
  const encrypted = safeStorage.encryptString(normalized);
  const temporaryPath = `${sessionTokenPath()}.tmp`;
  await writeFile(temporaryPath, encrypted, { mode: 0o600 });
  await restrictFile(temporaryPath);
  await rename(temporaryPath, sessionTokenPath());
  await restrictFile(sessionTokenPath());
};

const pendingDesktopCommands = [];

const sendDesktopCommand = (command) => {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) {
    pendingDesktopCommands.push(command);
    return;
  }
  mainWindow.webContents.send("desktop:command", command);
};

const importMarkdownFile = async (filePath) => {
  if (!isSupportedAssociatedFile(filePath)) return;
  try {
    const content = await readFile(filePath, "utf8");
    if (Buffer.byteLength(content, "utf8") > 8 * 1024 * 1024) {
      void writeDiagnostic("file-import-rejected", { filePath, reason: "file-too-large" });
      return;
    }
    const payload = { name: basename(filePath), content };
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading() || !rendererReady) {
      pendingMarkdownImport = payload;
      return;
    }
    mainWindow.webContents.send("desktop:import-markdown", payload);
  } catch (error) {
    void writeDiagnostic("file-import-failed", { filePath, message: error.message });
  }
};

let pendingMarkdownImport = null;
let pendingScreenshotImport = null;
const screenshotCaptureGuard = createScreenshotCaptureGuard();
const sentScreenshotCaptureIds = new Set();
let rendererReady = false;

const getRendererHibernateBackgroundState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { focused: false, visible: false, quitting: isQuitting, loading: false };
  }
  return {
    focused: mainWindow.isFocused(),
    visible: mainWindow.isVisible() && !mainWindow.isMinimized(),
    quitting: isQuitting,
    loading: mainWindow.webContents.isLoading(),
  };
};

const getRendererWorkingSetBytes = async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return 0;
  try {
    return workingSetBytesFromProcessMemoryInfo(await mainWindow.webContents.getProcessMemoryInfo());
  } catch {
    return 0;
  }
};

const prepareRendererForHibernate = () => new Promise((resolve) => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
    resolve("unavailable");
    return;
  }
  const timeout = setTimeout(() => {
    ipcMain.removeListener("desktop:hibernate-prepared", onPrepared);
    resolve("timeout");
  }, RENDERER_HIBERNATE_PREPARE_TIMEOUT_MS);
  const onPrepared = (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    clearTimeout(timeout);
    ipcMain.removeListener("desktop:hibernate-prepared", onPrepared);
    resolve("ready");
  };
  ipcMain.on("desktop:hibernate-prepared", onPrepared);
  mainWindow.webContents.send("desktop:hibernate-prepare");
});

const reloadHibernatedRenderer = () => {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused() || isQuitting) return;
  rendererReady = false;
  armRendererStartupGuard();
  mainWindow.webContents.reload();
};

const rendererHibernate = createRendererHibernateController({
  getBackgroundState: getRendererHibernateBackgroundState,
  getMemoryBytes: getRendererWorkingSetBytes,
  prepareRenderer: prepareRendererForHibernate,
  reloadRenderer: reloadHibernatedRenderer,
  onDiagnostic: (event, details) => { void writeDiagnostic(event, details); },
});

const syncRendererHibernate = () => {
  if (isQuitting || !mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) {
    rendererHibernate.cancel();
    return;
  }
  rendererHibernate.noteBackground();
};

const flushPendingMarkdownImport = () => {
  if (!pendingMarkdownImport || !rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  const payload = pendingMarkdownImport;
  pendingMarkdownImport = null;
  mainWindow.webContents.send("desktop:import-markdown", payload);
};

const sendScreenshotImport = (payload) => {
  const ipcPayload = screenshotImportIpcPayload(payload);
  if (!ipcPayload.bytes.byteLength) return;
  if (ipcPayload.captureId && sentScreenshotCaptureIds.has(ipcPayload.captureId)) return;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading() || !rendererReady) {
    pendingScreenshotImport = ipcPayload;
    return;
  }
  pendingScreenshotImport = null;
  if (ipcPayload.captureId) sentScreenshotCaptureIds.add(ipcPayload.captureId);
  mainWindow.webContents.send("desktop:import-screenshot", ipcPayload);
};

const flushPendingScreenshotImport = () => {
  if (!pendingScreenshotImport || !rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  const payload = pendingScreenshotImport;
  pendingScreenshotImport = null;
  if (!payload.bytes?.byteLength) return;
  if (payload.captureId && sentScreenshotCaptureIds.has(payload.captureId)) return;
  if (payload.captureId) sentScreenshotCaptureIds.add(payload.captureId);
  mainWindow.webContents.send("desktop:import-screenshot", payload);
};

const captureScreenshotToNote = async () => {
  if (!screenshotCaptureGuard.tryBegin()) return;
  const copy = desktopMenuCopy(app.getLocale());
  const wasVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  const revealWindow = () => {
    if (process.platform === "darwin") app.show();
    showWindow(mainWindow);
  };
  try {
    if (process.platform === "darwin") app.hide();
    else if (wasVisible) mainWindow.hide();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const captured = await captureScreenToNote({
      platform: process.platform,
      locale: app.getLocale(),
      outputPath: process.platform === "darwin" ? writeScreenshotTempPath(app.getPath("temp")) : undefined,
      desktopCapturer,
      screen,
    });
    if (!captured) {
      if (wasVisible) revealWindow();
      return;
    }
    revealWindow();
    sendScreenshotImport(captured);
  } catch (error) {
    if (wasVisible) revealWindow();
    void writeDiagnostic("screenshot.failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await dialog.showMessageBox({
      type: "warning",
      message: copy.screenshotFailed,
    });
  } finally {
    screenshotCaptureGuard.end();
  }
};

const flushPendingDesktopCommands = () => {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  while (pendingDesktopCommands.length > 0) {
    mainWindow.webContents.send("desktop:command", pendingDesktopCommands.shift());
  }
};

const flushPendingScheduledTaskRuns = () => {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  while (pendingScheduledTaskRuns.length > 0) {
    mainWindow.webContents.send("desktop:scheduled-task", pendingScheduledTaskRuns.shift());
  }
};

const pendingWeChatImports = [];
let wechatShareController = null;

const wechatShare = () => {
  wechatShareController ??= createWeChatShareController({
    downloadsPath: () => app.getPath("downloads"),
    tempPath: () => app.getPath("temp"),
    sendToRenderer: (payload) => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading() || !rendererReady) {
        pendingWeChatImports.push(payload);
        return;
      }
      mainWindow.webContents.send("desktop:import-wechat-chat", payload);
    },
    onActivity: () => {
      if (process.platform === "darwin") app.show();
      showWindow(mainWindow);
    },
    writeDiagnostic: (event, details) => { void writeDiagnostic(event, details); },
  });
  return wechatShareController;
};

const flushPendingWeChatImports = () => {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  while (pendingWeChatImports.length > 0) {
    mainWindow.webContents.send("desktop:import-wechat-chat", pendingWeChatImports.shift());
  }
};

const handleProtocolUrl = (target) => {
  if (typeof target !== "string" || !target.startsWith("edgeever://")) return;
  try {
    const url = new URL(target);
    if (url.hostname === "wechat-import" || url.hostname === "share-import") {
      void wechatShare().importFromProtocolUrl(target);
      return;
    }
    const memoMatch = url.pathname.match(/^\/memo\/([^/]+)$/);
    if (memoMatch) sendDesktopCommand(`open-memo:${decodeURIComponent(memoMatch[1])}`);
  } catch {
    // Ignore malformed protocol invocations.
  }
};

const pendingShareFiles = [];

const importSharedCommandLineFiles = (commandLine) => {
  const sharedFiles = shareFilePathsFromCommandLine(commandLine);
  if (!protocolUrlsReady) {
    pendingShareFiles.push(...sharedFiles);
    return sharedFiles.length > 0;
  }
  for (const filePath of sharedFiles) void wechatShare().importLocalFile(filePath);
  return sharedFiles.length > 0;
};

const handleOpenTarget = (commandLine) => {
  const target = commandLine.find((value) => value.startsWith("edgeever://"));
  if (target) handleProtocolUrl(target);
  if (importSharedCommandLineFiles(commandLine)) return;
  const associatedFile = commandLine.find((value) => !value.startsWith("-") && isSupportedAssociatedFile(value));
  if (associatedFile) void importMarkdownFile(associatedFile);
};

const buildApplicationMenu = () => {
  const copy = desktopMenuCopy(app.getLocale());
  const template = [
    ...(process.platform === "darwin" ? [{ label: app.name, submenu: [{ label: copy.about, role: "about" }, { type: "separator" }, { label: copy.hide, role: "hide" }, { label: copy.quit, role: "quit" }] }] : []),
    {
      label: copy.file,
      submenu: [
        { label: copy.newMemo, accelerator: "CmdOrCtrl+N", click: () => sendDesktopCommand("new-memo") },
        { label: copy.newNotebook, accelerator: "CmdOrCtrl+Shift+N", click: () => sendDesktopCommand("new-notebook") },
        { type: "separator" },
        { label: copy.close, role: "close" },
      ],
    },
    {
      label: copy.edit,
      submenu: [
        { label: copy.undo, role: "undo" }, { label: copy.redo, role: "redo" }, { type: "separator" },
        { label: copy.cut, role: "cut" }, { label: copy.copy, role: "copy" }, { label: copy.paste, role: "paste" }, { label: copy.selectAll, role: "selectAll" },
      ],
    },
    {
      label: copy.view,
      submenu: [
        { label: copy.focusSearch, accelerator: "CmdOrCtrl+Shift+F", click: () => sendDesktopCommand("focus-search") },
        { label: copy.toggleFocusMode, click: () => sendDesktopCommand("toggle-focus-mode") },
        { type: "separator" },
        { label: copy.toggleFullScreen, role: "togglefullscreen" }, { label: copy.resetZoom, role: "resetZoom" }, { label: copy.zoomIn, role: "zoomIn" }, { label: copy.zoomOut, role: "zoomOut" },
      ],
    },
    {
      label: copy.window,
      submenu: [{ label: copy.minimize, role: "minimize" }, { label: copy.zoom, role: "zoom" }, ...(process.platform === "darwin" ? [{ label: copy.front, role: "front" }] : [])],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const buildTrayContextMenu = () => {
  const copy = desktopMenuCopy(app.getLocale());
  return Menu.buildFromTemplate([
    { label: copy.show, click: () => showWindow(mainWindow) },
    { label: copy.screenshotToNote, click: () => void captureScreenshotToNote() },
    ...(updateState === "downloaded" ? [{ label: copy.restartToUpdate, click: () => installDownloadedUpdate() }] : []),
    { type: "separator" },
    { label: copy.quit, click: () => { isQuitting = true; app.quit(); } },
  ]);
};

const createTray = () => {
  if (tray && !tray.isDestroyed?.()) {
    tray.setContextMenu(buildTrayContextMenu());
    return;
  }
  const iconPath = trayIconPath({
    isPackaged: app.isPackaged,
    platform: process.platform,
    projectRoot,
    resourcesPath: process.resourcesPath,
  });
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("EdgeEver");
  tray.setContextMenu(buildTrayContextMenu());
  tray.on("double-click", () => showWindow(mainWindow));
};

const handleResourceProtocolRequest = async (request) => {
  const resourceId = resourceIdFromRequest(request.url);
  if (!resourceId) return new Response("Invalid resource", { status: 400 });
  const downloadDisposition = downloadContentDispositionFromRequest(request.url);

  const directory = resourceCacheDirectory();
  const bytesPath = join(directory, `${resourceId}.bin`);
  const metadataPath = join(directory, `${resourceId}.json`);

  const fileResponse = async (path, contentType, rangeHeader) => {
    const { size } = await stat(path);
    const range = parseByteRangeHeader(rangeHeader, size);
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Type": contentType || "application/octet-stream",
    });
    if (downloadDisposition) headers.set("Content-Disposition", downloadDisposition);
    if (range.kind === "invalid") {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const selected = range.kind === "range" ? range : { offset: 0, length: size };
    headers.set("Content-Length", String(selected.length));
    if (range.kind === "range") {
      headers.set("Content-Range", `bytes ${selected.offset}-${selected.offset + selected.length - 1}/${size}`);
    }
    const stream = createReadStream(path, {
      start: selected.offset,
      end: selected.offset + selected.length - 1,
    });
    return new Response(Readable.toWeb(stream), {
      status: range.kind === "range" ? 206 : 200,
      headers,
    });
  };

  try {
    let metadata = {};
    try { metadata = JSON.parse(await readFile(metadataPath, "utf8")); } catch {}
    return await fileResponse(bytesPath, metadata.contentType, request.headers.get("range"));
  } catch {
    // Fall through to the instance while online, then persist the response.
  }

  if (!configuredApiBaseUrl) return new Response("Resource is not cached", { status: 504 });
  const sourceUrl = `${configuredApiBaseUrl}/api/v1/resources/${encodeURIComponent(resourceId)}/blob`;
  try {
    const cookies = await session.defaultSession.cookies.get({ url: sourceUrl });
    const headers = resourceRequestHeaders({ cookies, sessionToken: desktopSessionToken });
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) headers.set("range", rangeHeader);
    const response = await net.fetch(sourceUrl, { headers });
    if (!response.ok) return new Response("Resource request failed", { status: response.status });
    if (response.status === 206) {
      const responseHeaders = new Headers({
        "Accept-Ranges": response.headers.get("accept-ranges") || "bytes",
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("content-type") || "application/octet-stream",
      });
      for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
        const value = response.headers.get(name);
        if (value) responseHeaders.set(name, value);
      }
      if (downloadDisposition) responseHeaders.set("Content-Disposition", downloadDisposition);
      return new Response(response.body, { status: 206, headers: responseHeaders });
    }
    if (!response.body) return new Response("Resource response body is empty", { status: 502 });
    await mkdir(directory, { recursive: true });
    await restrictDirectory(directory);
    const temporaryPath = `${bytesPath}.download-${crypto.randomUUID()}`;
    const output = await open(temporaryPath, "w", 0o600);
    const reader = response.body.getReader();
    let finished = false;
    const cleanup = async () => {
      if (!finished) {
        finished = true;
        await output.close().catch(() => {});
        await rm(temporaryPath, { force: true }).catch(() => {});
      }
    };
    const streamedBody = new ReadableStream({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            await output.close();
            await rename(temporaryPath, bytesPath);
            await writeFile(metadataPath, JSON.stringify({ contentType: response.headers.get("content-type") || "application/octet-stream" }), { mode: 0o600 });
            await restrictFile(bytesPath);
            await restrictFile(metadataPath);
            finished = true;
            controller.close();
            return;
          }
          await output.write(next.value);
          controller.enqueue(next.value);
        } catch (error) {
          await cleanup();
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => {});
        await cleanup();
      },
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "no-store");
    if (downloadDisposition) responseHeaders.set("Content-Disposition", downloadDisposition);
    return new Response(streamedBody, { status: 200, headers: responseHeaders });
  } catch (error) {
    void writeDiagnostic("resource.cache-failed", { resourceId, message: error.message });
    return new Response("Resource unavailable", { status: 504 });
  }
};

const registerResourceProtocol = () => {
  protocol.handle("edgeever-resource", handleResourceProtocolRequest);

  protocol.handle("edgeever-staged", async (request) => {
    const stagedId = resourceIdFromRequest(request.url);
    if (!stagedId) return new Response("Invalid staged resource", { status: 400 });

    const directory = stagedResourceDirectory();
    try {
      const metadata = await readStagedResourceMetadata(directory, stagedId);
      const path = join(directory, `${stagedId}.bin`);
      const size = await stat(path).then((details) => details.size).catch(() => null);
      if (size === null && isSafeResourceId(metadata.resourceId)) {
        const target = new URL(`edgeever-resource://resource/${encodeURIComponent(metadata.resourceId)}`);
        target.search = new URL(request.url).search;
        return handleResourceProtocolRequest(new Request(target, { headers: request.headers }));
      }
      if (size === null) throw new Error("Staged bytes are missing");
      const stream = createReadStream(path);
      const headers = new Headers({
        "Content-Type": metadata.type || "application/octet-stream",
        "Content-Length": String(size),
        "Cache-Control": "no-store",
      });
      const downloadDisposition = downloadContentDispositionFromRequest(request.url);
      if (downloadDisposition) headers.set("Content-Disposition", downloadDisposition);
      return new Response(Readable.toWeb(stream), {
        headers,
      });
    } catch (error) {
      void writeDiagnostic("resource.staged-read-failed", { stagedId, message: error.message });
      return new Response("Staged resource unavailable", { status: 404 });
    }
  });
};

const registerDesktopAppProtocol = () => {
  protocol.handle(DESKTOP_APP_SCHEME, createDesktopAppProtocolHandler({
    webRoot: join(process.resourcesPath, "web"),
  }));
};

const preparePackagedRendererOrigin = async () => {
  if (!app.isPackaged || process.env.EDGE_EVER_DESKTOP_WEB_URL) return;
  if (process.env.EDGE_EVER_FORCE_FILE_RENDERER === "1") {
    void writeDiagnostic("renderer.app-protocol-disabled");
    return;
  }

  const bridgePath = join(process.resourcesPath, "web/desktop-storage-bridge.html");
  rendererOriginMigrationInProgress = true;
  try {
    const result = await migrateRendererStorageOrigin({
      createWindow: () => new BrowserWindow({
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      }),
      legacyBridgeUrl: pathToFileURL(bridgePath).href,
      targetBridgeUrl: `${DESKTOP_APP_ORIGIN}/desktop-storage-bridge.html`,
      markerPath: join(app.getPath("userData"), RENDERER_STORAGE_MIGRATION_MARKER),
    });
    usePrivateAppProtocol = true;
    void writeDiagnostic("renderer.origin-ready", { state: result.state, counts: result.counts });
  } catch (error) {
    usePrivateAppProtocol = false;
    void writeDiagnostic("renderer.origin-migration-failed", {
      message: String(error?.message || error).slice(0, 2000),
    });
  } finally {
    rendererOriginMigrationInProgress = false;
  }
};

const refreshTrayMenu = () => {
  if (isQuitting) return;
  if (!tray || tray.isDestroyed?.()) {
    createTray();
    return;
  }
  tray.setContextMenu(buildTrayContextMenu());
};

const desktopUpdateStatus = () => ({
  state: updateState,
  version: downloadedUpdateVersion,
  error: updateError,
  progress: updateProgress,
});

const recordUpdateError = (error, stage) => {
  updateError = createUpdateDiagnostic(error, {
    stage, version: app.getVersion(), platform: process.platform, arch: process.arch,
  });
};

const publishDesktopUpdateStatus = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:update-status-changed", desktopUpdateStatus());
};

const installDownloadedUpdate = () => {
  if (
    updateState !== "downloaded" ||
    (process.platform === "win32" && !windowsDownloadedUpdateVerified)
  ) return { started: false };
  // The normal window close handler hides the app. Mark this as a real quit
  // before electron-updater closes windows so installation can proceed.
  isQuitting = true;
  // Keep Windows updates silent and reuse the registered installation directory.
  autoUpdater.quitAndInstall(process.platform === "win32", true);
  return { started: true };
};

const trackDesktopUpdateDownload = (downloadPromise, reason) => {
  updateDownloadInFlight = Promise.resolve(downloadPromise)
    .catch(async (error) => {
      updateState = "idle";
      updateProgress = null;
      downloadedUpdateVersion = null;
      windowsDownloadedUpdateVerified = false;
      refreshTrayMenu();
      recordUpdateError(error, "download");
      publishDesktopUpdateStatus();
      await writeDiagnostic("update.download-failed", { reason, message: error.message });
    })
    .finally(() => { updateDownloadInFlight = null; });
  return updateDownloadInFlight;
};

const downloadTrustedDesktopUpdate = (reason) => {
  if (updateDownloadInFlight) return updateDownloadInFlight;
  if (process.platform === "win32" && !trustedWindowsUpdate) {
    return Promise.reject(new Error("Windows update metadata has not passed the signature gate"));
  }
  return trackDesktopUpdateDownload(autoUpdater.downloadUpdate(), reason);
};

const promptForDownloadedUpdate = async (version) => {
  const promptKey = version || "unknown";
  if (isQuitting || promptedUpdateVersion === promptKey) return;
  promptedUpdateVersion = promptKey;
  showWindow(mainWindow);
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: isChinese ? "EdgeEver 更新已就绪" : "EdgeEver update ready",
    message: isChinese
      ? `EdgeEver v${version || "最新版"} 已下载完成。`
      : `EdgeEver v${version || "latest"} has been downloaded.`,
    detail: isChinese
      ? "现在重启即可完成安装。也可以选择稍后，EdgeEver 会在您退出应用时自动安装。"
      : "Restart now to finish installing it. You can also choose Later; EdgeEver will install it automatically when you quit the app.",
    buttons: [isChinese ? "重启以更新" : "Restart to Update", isChinese ? "稍后" : "Later"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (result.response === 0) {
    void writeDiagnostic("update.install-confirmed", { version });
    installDownloadedUpdate();
  } else {
    void writeDiagnostic("update.install-deferred", { version });
  }
};

const checkForDesktopUpdate = (reason, { force = false, throwOnError = false } = {}) => {
  if (!app.isPackaged || process.env.EDGE_EVER_DISABLE_AUTO_UPDATE === "1" || updateState === "downloaded") {
    return Promise.resolve(null);
  }
  if (updateCheckInFlight) {
    return throwOnError ? updateCheckInFlight : updateCheckInFlight.catch(() => null);
  }
  if (updateDownloadInFlight) return Promise.resolve(null);
  const now = Date.now();
  if (!force && now - lastUpdateCheckAt < updateCheckFocusThrottleMs) return Promise.resolve(null);
  lastUpdateCheckAt = now;
  updateError = null;
  publishDesktopUpdateStatus();
  let diagnosticStage = "check";
  void writeDiagnostic("update.check-started", { reason });
  updateCheckInFlight = autoUpdater.checkForUpdates()
    .then(async (result) => {
      if (process.platform === "win32" && result?.isUpdateAvailable) {
        diagnosticStage = "verify-windows-metadata";
        trustedWindowsUpdate = await fetchTrustedWindowsUpdate({
          version: result.updateInfo.version,
          updateInfo: result.updateInfo,
          fetchImpl: net.fetch,
        });
        windowsDownloadedUpdateVerified = false;
        void writeDiagnostic("update.windows-manifest-verified", {
          version: trustedWindowsUpdate.version,
          keyId: trustedWindowsUpdate.keyId,
        });
        void downloadTrustedDesktopUpdate(reason);
      }
      if (result?.downloadPromise) {
        trackDesktopUpdateDownload(result.downloadPromise, reason);
      }
      return result;
    })
    .catch(async (error) => {
      updateState = "idle";
      updateProgress = null;
      downloadedUpdateVersion = null;
      trustedWindowsUpdate = null;
      windowsDownloadedUpdateVerified = false;
      refreshTrayMenu();
      recordUpdateError(error, diagnosticStage);
      publishDesktopUpdateStatus();
      await writeDiagnostic("update.check-failed", { reason, message: error.message });
      throw error;
    })
    .finally(() => { updateCheckInFlight = null; });
  return throwOnError ? updateCheckInFlight : updateCheckInFlight.catch(() => null);
};

const configureAutoUpdater = () => {
  if (!app.isPackaged || process.env.EDGE_EVER_DISABLE_AUTO_UPDATE === "1") return;
  if (linuxUpdateTestMode) {
    if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(linuxUpdateTestFeedUrl)) {
      throw new Error("Linux update verification requires a loopback HTTP feed");
    }
    autoUpdater.setFeedURL({ provider: "generic", url: linuxUpdateTestFeedUrl });
    autoUpdater.disableDifferentialDownload = true;
    void writeDiagnostic("update.test-started", {
      version: app.getVersion(),
      appImage: process.env.APPIMAGE || null,
    });
  }
  autoUpdater.autoDownload = process.platform !== "win32";
  autoUpdater.autoInstallOnAppQuit = process.platform !== "win32";
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.on("update-available", (info) => {
    updateState = "available";
    updateProgress = null;
    downloadedUpdateVersion = info?.version || null;
    if (process.platform === "win32") {
      trustedWindowsUpdate = null;
      windowsDownloadedUpdateVerified = false;
    }
    refreshTrayMenu();
    publishDesktopUpdateStatus();
    void writeDiagnostic("update.available", { version: info?.version });
  });
  autoUpdater.on("update-not-available", () => {
    updateState = "idle";
    updateProgress = null;
    downloadedUpdateVersion = null;
    trustedWindowsUpdate = null;
    windowsDownloadedUpdateVerified = false;
    refreshTrayMenu();
    publishDesktopUpdateStatus();
    const diagnosticWritten = writeDiagnostic("update.not-available");
    if (linuxUpdateTestMode) {
      void diagnosticWritten.finally(() => setTimeout(() => app.quit(), 100));
    }
  });
  autoUpdater.on("download-progress", (progress) => {
    updateProgress = normalizeUpdateProgress(progress);
    publishDesktopUpdateStatus();
    void writeDiagnostic("update.download-progress", { percent: progress.percent });
  });
  autoUpdater.on("update-downloaded", (info) => {
    void (async () => {
      if (process.platform === "win32") {
        if (!trustedWindowsUpdate || trustedWindowsUpdate.version !== info?.version) {
          throw new Error("Downloaded Windows update has no matching trusted manifest");
        }
        await verifyDownloadedWindowsUpdate({
          path: info.downloadedFile,
          manifest: trustedWindowsUpdate,
        });
        windowsDownloadedUpdateVerified = true;
        autoUpdater.autoInstallOnAppQuit = true;
      }
      updateState = "downloaded";
      updateProgress = null;
      updateError = null;
      downloadedUpdateVersion = info?.version || downloadedUpdateVersion;
      refreshTrayMenu();
      publishDesktopUpdateStatus();
      await writeDiagnostic("update.downloaded", { version: downloadedUpdateVersion });
      if (linuxUpdateTestMode) {
        installDownloadedUpdate();
        return;
      }
      await promptForDownloadedUpdate(downloadedUpdateVersion).catch((error) => {
        promptedUpdateVersion = null;
        void writeDiagnostic("update.prompt-failed", { message: error.message });
      });
    })().catch(async (error) => {
      if (process.platform !== "win32") {
        await writeDiagnostic("update.download-handler-failed", { message: error.message });
        return;
      }
      autoUpdater.autoInstallOnAppQuit = false;
      updateState = "idle";
      updateProgress = null;
      downloadedUpdateVersion = null;
      windowsDownloadedUpdateVerified = false;
      refreshTrayMenu();
      recordUpdateError(error, "verify-windows-package");
      publishDesktopUpdateStatus();
      await writeDiagnostic("update.windows-package-blocked", { message: error.message });
    });
  });
  autoUpdater.on("error", (error) => {
    isQuitting = false;
    if (updateState !== "downloaded") {
      updateState = "idle";
      updateProgress = null;
      downloadedUpdateVersion = null;
      windowsDownloadedUpdateVerified = false;
    }
    refreshTrayMenu();
    recordUpdateError(error, updateDownloadInFlight ? "download" : "check");
    publishDesktopUpdateStatus();
    void writeDiagnostic("update.error", { message: error.message });
  });
  void checkForDesktopUpdate("startup", { force: true });
  updateCheckTimer = setInterval(() => {
    void checkForDesktopUpdate("interval", { force: true });
  }, updateCheckIntervalMs);
  powerMonitor.on("resume", () => {
    void checkForDesktopUpdate("resume", { force: true });
    void scheduledTaskScheduler.runMissedOccurrences();
  });
};

const startSidecar = async (accountId = null) => {
  if (!existsSync(sidecarPath)) {
    console.warn(`[desktop] sidecar not found: ${sidecarPath}`);
    void writeDiagnostic("sidecar.missing", { sidecarPath });
    return null;
  }

  await migrateLegacyAccountData(accountId);
  const migrationsPath = app.isPackaged ? join(process.resourcesPath, "migrations") : join(projectRoot, "migrations");
  sidecarScopeKey = accountScopeKey(configuredApiBaseUrl, accountId);
  activeAccountId = accountId;
  const spawnedProcess = spawn(sidecarPath, ["--data-dir", sidecarDataDirectory(accountId), "--migrations-dir", migrationsPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  sidecarProcess = spawnedProcess;
  let spawnedSuccessfully = false;
  spawnedProcess.stderr.on("data", (chunk) => {
    const message = chunk.toString().trimEnd();
    console.error(`[sidecar] ${message}`);
    void writeDiagnostic("sidecar.stderr", { message });
  });
  spawnedProcess.on("error", (error) => {
    void writeDiagnostic("sidecar.spawn-error", { message: error.message, code: error.code });
    if (sidecarProcess !== spawnedProcess) return;
    sidecarProcess = null;
    sidecar = null;
    if (spawnedSuccessfully && !isQuitting) scheduleSidecarRestart();
  });
  spawnedProcess.on("exit", (code, signal) => {
    void writeDiagnostic("sidecar.exit", { code, signal });
    if (sidecarProcess !== spawnedProcess || isQuitting) return;
    sidecarProcess = null;
    sidecar = null;
    if (spawnedSuccessfully) scheduleSidecarRestart();
  });
  await waitForChildProcessSpawn(spawnedProcess);
  spawnedSuccessfully = true;
  if (spawnedProcess.exitCode !== null || sidecarProcess !== spawnedProcess) {
    throw new Error(`EdgeEver sidecar exited during startup (${spawnedProcess.exitCode ?? "unknown"})`);
  }
  sidecar = new SidecarRpcClient(spawnedProcess);
  return sidecar;
};

const stopSidecar = async () => {
  const processToStop = sidecarProcess;
  sidecar = null;
  sidecarProcess = null;
  if (!processToStop) return;
  const exited = new Promise((resolve) => processToStop.once("exit", resolve));
  processToStop.stdin.end();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1000))]);
  if (!processToStop.killed) processToStop.kill();
};

const scheduleSidecarRestart = () => {
  if (isQuitting || shutdownCleanupStarted || sidecarRestartTimer || sidecarRestartInFlight) return;
  sidecarRestartAttempts += 1;
  const delayMs = Math.min(30_000, 500 * 2 ** Math.min(sidecarRestartAttempts - 1, 6));
  sidecarRestartTimer = setTimeout(async () => {
    sidecarRestartTimer = null;
    if (isQuitting || sidecarProcess || sidecarRestartInFlight) return;
    sidecarRestartInFlight = true;
    try {
      const restarted = await startSidecar(activeAccountId);
      if (!restarted) throw new Error("EdgeEver sidecar is unavailable");
      await restarted.waitUntilReady();
      void writeDiagnostic("sidecar.restarted", { attempt: sidecarRestartAttempts, delayMs });
    } catch (error) {
      void writeDiagnostic("sidecar.restart-failed", { attempt: sidecarRestartAttempts, message: error.message });
      await stopSidecar();
      sidecarRestartInFlight = false;
      scheduleSidecarRestart();
    } finally {
      sidecarRestartInFlight = false;
    }
  }, delayMs);
};

// Restores the standard browser editing menu (Cut/Copy/Paste/Paste as plain
// text/Select all, spelling suggestions, Copy link address). Pages that call
// preventDefault() on the DOM contextmenu event never reach this handler.
const attachEditContextMenu = (contents) => {
  contents.on("context-menu", (_event, params) => {
    const template = buildEditContextMenuTemplate(params, desktopMenuCopy(app.getLocale()), {
      replaceMisspelling: (word) => contents.replaceMisspelling(word),
      addToDictionary: (word) => contents.session.addWordToSpellCheckerDictionary(word),
      copyLink: (url) => clipboard.writeText(url),
    });
    if (!template.length) return;
    const window = BrowserWindow.fromWebContents(contents) ?? undefined;
    Menu.buildFromTemplate(template).popup(window ? { window } : {});
  });
};

const createWindow = async () => {
  const state = await readWindowState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: join(currentDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  rendererReady = false;
  armRendererStartupGuard();
  if (state.isMaximized) mainWindow.maximize();
  mainWindow.on("resize", () => void saveWindowState());
  mainWindow.on("move", () => void saveWindowState());
  mainWindow.on("close", (event) => {
    void saveWindowState();
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  attachEditContextMenu(mainWindow.webContents);
  mainWindow.webContents.on("did-create-window", (childWindow) => attachEditContextMenu(childWindow.webContents));
  mainWindow.on("hide", syncRendererHibernate);
  mainWindow.on("hide", () => globalShortcut.setSuspended(false));
  mainWindow.on("show", syncRendererHibernate);
  mainWindow.on("minimize", syncRendererHibernate);
  mainWindow.on("restore", syncRendererHibernate);
  mainWindow.on("blur", syncRendererHibernate);
  mainWindow.on("focus", syncRendererHibernate);

  // Install startup diagnostics before navigation. A renderer exception can
  // happen while loadFile/loadURL is still resolving, so listeners registered
  // afterwards miss the only useful evidence and leave users with a blank
  // window and an empty diagnostic log.
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    void writeDiagnostic("renderer.load-failed", {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
    if (isMainFrame && errorCode !== -3) {
      rendererStartupGuard?.fail({ kind: "load-failed", errorCode, errorDescription, validatedURL });
    }
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    void writeDiagnostic("renderer.preload-error", {
      preloadPath,
      message: String(error?.message || error).slice(0, 2000),
    });
    rendererStartupGuard?.fail({ kind: "preload-error", message: String(error?.message || error).slice(0, 2000) });
  });
  mainWindow.webContents.on("did-start-loading", () => globalShortcut.setSuspended(false));
  mainWindow.webContents.on("console-message", (details) => {
    if (details.level !== "error") return;
    void writeDiagnostic("renderer.console-error", {
      message: String(details.message || "").slice(0, 2000),
      lineNumber: details.lineNumber,
      sourceId: String(details.sourceId || "").slice(0, 1000),
    });
  });
  mainWindow.webContents.on("did-finish-load", () => {
    void writeDiagnostic("renderer.loaded", { url: mainWindow?.webContents.getURL() || "" });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    globalShortcut.setSuspended(false);
    clearRendererUnresponsiveTimer();
    void writeDiagnostic("renderer.gone", details);
    void handleRendererProcessGone(details);
  });
  mainWindow.webContents.on("unresponsive", () => {
    void writeDiagnostic("renderer.unresponsive");
    if (!rendererUnresponsiveTimer && !rendererUnresponsiveDialogOpen) {
      rendererUnresponsiveTimer = setTimeout(() => { void showRendererUnresponsive(); }, 5_000);
    }
  });
  mainWindow.webContents.on("responsive", () => {
    clearRendererUnresponsiveTimer();
    void writeDiagnostic("renderer.responsive");
  });

  try {
    if (app.isPackaged && !process.env.EDGE_EVER_DESKTOP_WEB_URL) {
      if (usePrivateAppProtocol) await mainWindow.loadURL(DESKTOP_APP_ENTRY_URL);
      else await mainWindow.loadFile(join(process.resourcesPath, "web/index.html"));
    } else {
      await mainWindow.loadURL(webUrl);
    }
  } catch (error) {
    void writeDiagnostic("renderer.navigation-rejected", {
      message: String(error?.message || error).slice(0, 2000),
    });
    throw error;
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("edgeever-resource://") || url.startsWith("edgeever-staged://")) return { action: "allow" };
    if (isAllowedPrintPreviewUrl(url, mainWindow.webContents.getURL())) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(webUrl) || url.startsWith(`${DESKTOP_APP_ORIGIN}/`) || url.startsWith("edgeever-resource://") || url.startsWith("edgeever-staged://")) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
  });
  buildApplicationMenu();
};

const confirmMacInstallation = async () => {
  if (!app.isPackaged || process.platform !== "darwin" || existsSync(installationMarkerPath())) return;

  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: isChinese ? "EdgeEver 安装成功" : "EdgeEver installed successfully",
    message: isChinese ? "EdgeEver 已成功安装并正在运行。" : "EdgeEver was installed successfully and is now running.",
    detail: isChinese
      ? "以后可以从“应用程序”文件夹或 Launchpad 启动 EdgeEver。当前窗口已经是安装完成后的应用，不是安装盘。"
      : "You can launch EdgeEver later from the Applications folder or Launchpad. This window is the installed app, not the installer disk.",
    buttons: [isChinese ? "知道了" : "Done"],
  });
  await writeFile(installationMarkerPath(), new Date().toISOString(), { mode: 0o600 });
  await restrictFile(installationMarkerPath());
  void writeDiagnostic("installation.confirmed");
};

const startApplication = async () => {
  applyMacDockIcon();
  if (app.isPackaged && isMountedInstallerPath(app.getAppPath())) {
    const isChinese = app.getLocale().toLowerCase().startsWith("zh");
    const result = await dialog.showMessageBox({
      type: "info",
      title: isChinese ? "安装 EdgeEver" : "Install EdgeEver",
      message: isChinese
        ? "将 EdgeEver 安装到“应用程序”文件夹并启动。"
        : "Install EdgeEver in the Applications folder and launch it.",
      detail: isChinese
        ? "安装完成后，EdgeEver 会自动重启正式副本并推出安装盘，避免 macOS 同时显示两个 EdgeEver 入口。"
        : "After installation, EdgeEver relaunches the installed copy and ejects the installer disk so macOS does not keep two EdgeEver entries.",
      buttons: [isChinese ? "安装并启动" : "Install and Launch", isChinese ? "取消" : "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response !== 0) {
      app.quit();
      return;
    }
    try {
      const moved = app.moveToApplicationsFolder({
        conflictHandler: (conflictType) => conflictType !== "existsAndRunning",
      });
      if (moved) return;
    } catch (error) {
      void writeDiagnostic("installation.move-failed", { message: error.message });
    }
    await dialog.showMessageBox({
      type: "error",
      title: isChinese ? "无法完成安装" : "Could Not Install",
      message: isChinese
        ? "请先退出正在运行的 EdgeEver，然后重新打开安装盘并重试。"
        : "Quit the running copy of EdgeEver, reopen the installer disk, and try again.",
      buttons: [isChinese ? "知道了" : "OK"],
    });
    app.quit();
    return;
  }
  if (!hasSingleInstanceLock) {
    app.quit();
    return;
  }
  await loadConfiguredApiBaseUrl();
  await loadDesktopSessionToken();
  app.setAsDefaultProtocolClient("edgeever");
  recoveredAfterAbnormalExit = existsSync(crashMarkerPath());
  void writeDiagnostic(recoveredAfterAbnormalExit ? "session.recovered-after-abnormal-exit" : "session.started");
  void inspectWindowsTaskbarShortcuts({
    platform: process.platform, packaged: app.isPackaged,
    appData: app.getPath("appData"), executable: app.getPath("exe"),
    readdir, readShortcutLink: (path) => shell.readShortcutLink(path), existsSync,
  }).then((result) => {
    if (result) return writeDiagnostic("windows.taskbar-shortcuts", result);
  }).catch((error) => { void writeDiagnostic("windows.taskbar-shortcuts-unavailable", { message: error.message }); });
  await writeFile(crashMarkerPath(), new Date().toISOString());
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerDesktopAppProtocol();
  registerResourceProtocol();
  await preparePackagedRendererOrigin();
  const initialSidecar = await startSidecar();
  if (!initialSidecar) throw new Error("EdgeEver sidecar is unavailable");
  await initialSidecar.waitUntilReady();
  void writeDiagnostic("sidecar.ready", { scope: sidecarScopeKey });
  createTray();
  await loadGlobalShortcut();

  ipcMain.on("desktop:local-data-reset-available-sync", (event) => {
    event.returnValue = process.platform === "darwin" && app.isPackaged && !requestedUserDataDirectory;
  });
  ipcMain.handle("desktop:sidecar-request", async (_event, method, params) => {
    if (!sidecar) throw new Error("EdgeEver sidecar is unavailable");
    const result = await sidecar.request(method, params);
    if (method === "resource.delete" && isSafeResourceId(params?.resourceId)) {
      const directory = resourceCacheDirectory();
      await Promise.all([
        unlink(join(directory, `${params.resourceId}.bin`)).catch(() => {}),
        unlink(join(directory, `${params.resourceId}.json`)).catch(() => {}),
      ]);
    }
    return result;
  });
  ipcMain.handle("desktop:sidecar-status", () => ({ available: Boolean(sidecar), path: sidecarPath, scope: sidecarScopeKey }));
  ipcMain.handle("desktop:system-info", () => desktopRuntimeSystemInfo());
  ipcMain.handle("desktop:global-shortcut", (event) => {
    if (event.sender !== mainWindow?.webContents) return null;
    return globalShortcutState();
  });
  ipcMain.handle("desktop:set-global-shortcut", (event, binding) => {
    if (event.sender !== mainWindow?.webContents) return null;
    return setGlobalShortcut(binding);
  });
  ipcMain.handle("desktop:capture-global-shortcut", (event, capturing) => {
    if (event.sender !== mainWindow?.webContents || typeof capturing !== "boolean") return false;
    globalShortcut.setSuspended(capturing);
    return true;
  });
  ipcMain.handle("desktop:set-account-scope", async (_event, accountId) => {
    const normalizedAccountId = typeof accountId === "string" && accountId.trim() ? accountId.trim() : null;
    const nextScopeKey = accountScopeKey(configuredApiBaseUrl, normalizedAccountId);
    scheduledTaskScheduler.clear();
    if (sidecar && sidecarScopeKey === nextScopeKey) {
      await sidecar.waitUntilReady();
      return { ready: true, scope: nextScopeKey };
    }
    await stopSidecar();
    const nextSidecar = await startSidecar(normalizedAccountId);
    if (!nextSidecar) throw new Error("EdgeEver sidecar is unavailable");
    await nextSidecar.waitUntilReady();
    return { ready: true, scope: nextScopeKey };
  });
  ipcMain.on("desktop:renderer-ready", (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    rendererReady = true;
    flushPendingDesktopCommands();
    flushPendingMarkdownImport();
    flushPendingScreenshotImport();
    flushPendingWeChatImports();
    flushPendingScheduledTaskRuns();
  });
  ipcMain.on("desktop:renderer-bootstrap-ready", (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (rendererStartupGuard?.complete()) void writeDiagnostic("renderer.bootstrap-ready");
  });
  ipcMain.on("desktop:api-base-url-sync", (event) => { event.returnValue = configuredApiBaseUrl; });
  ipcMain.on("desktop:session-token-sync", (event) => { event.returnValue = desktopSessionToken; });
  ipcMain.on("desktop:recovered-after-abnormal-exit-sync", (event) => { event.returnValue = recoveredAfterAbnormalExit; });
  ipcMain.handle("desktop:copy-text", (_event, value) => writeTextClipboard(clipboard, value));
  ipcMain.handle("desktop:copy-html", (_event, input) => writeRichClipboard(clipboard, ClipboardItem, input));
  ipcMain.handle("desktop:copy-image", (_event, bytes) => writeImageClipboard(clipboard, ClipboardItem, bytes));
  ipcMain.handle("desktop:set-session-token", async (_event, value) => {
    await saveDesktopSessionToken(value);
    return { stored: Boolean(desktopSessionToken) };
  });
  ipcMain.handle("desktop:clear-session-token", async () => {
    scheduledTaskScheduler.clear();
    await saveDesktopSessionToken("");
    return { stored: false };
  });
  ipcMain.handle("desktop:public-network-fetch", async (event, requestId, input) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Public network requests must come from the main window");
    return pluginPublicNetwork.fetch(requestId, input);
  });
  ipcMain.on("desktop:cancel-public-network-fetch", (event, requestId) => {
    if (event.sender === mainWindow?.webContents && typeof requestId === "string") pluginPublicNetwork.cancel(requestId);
  });
  ipcMain.handle("desktop:ai-direct-open", async (event, requestId, input) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("AI provider requests must come from the main window");
    const sender = event.sender;
    return aiDirect.open(requestId, input, {
      onData: (bytes) => {
        if (sender.isDestroyed()) return;
        sender.send("desktop:ai-direct-chunk", requestId, { type: "data", bytes });
      },
      onEnd: () => {
        if (sender.isDestroyed()) return;
        sender.send("desktop:ai-direct-chunk", requestId, { type: "end" });
      },
      onError: (error) => {
        if (sender.isDestroyed()) return;
        sender.send("desktop:ai-direct-chunk", requestId, {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
  });
  ipcMain.on("desktop:ai-direct-cancel", (event, requestId) => {
    if (event.sender === mainWindow?.webContents && typeof requestId === "string") aiDirect.cancel(requestId);
  });
  const acpRuntime = registerAcpIpc(ipcMain, createAcpHostRuntime({
    adapterStore: join(app.getPath("userData"), "acp-adapters"),
    mcpScriptPath: app.isPackaged
      ? join(process.resourcesPath, "mcp-bridge", "edgeever-mcp-stdio.mjs")
      : join(projectRoot, "scripts", "edgeever-mcp-stdio.mjs"),
    mcpAccess: () => {
      const baseUrl = configuredApiBaseUrl;
      const sessionToken = desktopSessionToken;
      const accountId = activeAccountId;
      return {
        baseUrl,
        sessionToken,
        accountId,
        isCurrent: () => configuredApiBaseUrl === baseUrl && desktopSessionToken === sessionToken && activeAccountId === accountId,
      };
    },
  }), { allowInstall: (sender) => sender === mainWindow?.webContents });
  await acpRuntime.pruneAdapters().catch(() => {});
  const refreshAdapters = () => { void acpRuntime.installDetected().catch(() => []).then(() => acpRuntime.updateInstalled()).catch(() => {}); };
  const firstAdapterRefresh = setTimeout(refreshAdapters, 10_000);
  firstAdapterRefresh.unref?.();
  const adapterRefreshInterval = setInterval(refreshAdapters, 24 * 60 * 60 * 1000);
  adapterRefreshInterval.unref?.();
  ipcMain.handle("desktop:sync-scheduled-tasks", async (event, tasks) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Scheduled tasks must come from the main window");
    if (!Array.isArray(tasks) || tasks.length > 1_000) throw new Error("Invalid scheduled task list");
    await scheduledTaskScheduler.reconcile(tasks);
    return { scheduled: scheduledTaskScheduler.entries.size };
  });
  ipcMain.handle("desktop:record-renderer-error", async (event, details) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Renderer diagnostics must come from the main window");
    await writeDiagnostic("renderer.react-error", normalizeDesktopDiagnostic(details));
    return { recorded: true };
  });
  ipcMain.handle("desktop:open-renderer-issue", async (event, details) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Renderer issue reports must come from the main window");
    await openDesktopDiagnosticIssue(details);
    return { opened: true };
  });
  ipcMain.handle("desktop:clear-local-data", async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Local data reset must come from the main window");
    if (process.platform !== "darwin" || !app.isPackaged) throw new Error("Local data reset is only available in the packaged macOS app");
    if (requestedUserDataDirectory) throw new Error("Local data reset is unavailable with a custom user-data directory");
    if (localDataResetScheduled) return { scheduled: true };

    try {
      await scheduleMacLocalDataReset({
        appDataDirectory: app.getPath("appData"),
        executablePath: app.getPath("exe"),
        parentPid: process.pid,
        userDataDirectory: app.getPath("userData"),
      });
    } catch (error) {
      await writeDiagnostic("local-data-reset.schedule-failed", {
        code: error instanceof LocalDataResetError ? error.code : "unexpected",
        message: error instanceof Error ? error.message : String(error),
        cause: error instanceof LocalDataResetError && error.cause instanceof Error ? error.cause.message : undefined,
      });
      return {
        scheduled: false,
        errorCode: error instanceof LocalDataResetError ? error.code : "unexpected",
      };
    }

    // Only begin shutting down once the detached reset helper has definitely
    // started. From this point on, exiting lets that helper remove userData and
    // relaunch the app, so non-critical cleanup failures must not strand the
    // application in a half-stopped state.
    localDataResetScheduled = true;
    isQuitting = true;
    shutdownCleanupStarted = true;
    const forcedExitTimer = setTimeout(() => app.exit(0), 5000);
    forcedExitTimer.unref();
    if (sidecarRestartTimer) {
      clearTimeout(sidecarRestartTimer);
      sidecarRestartTimer = null;
    }
    try {
      tray?.destroy();
      tray = null;
    } catch (error) {
      void writeDiagnostic("local-data-reset.tray-cleanup-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await stopSidecar().catch((error) => writeDiagnostic("local-data-reset.sidecar-stop-failed", {
      message: error instanceof Error ? error.message : String(error),
    }));
    const storageResults = await Promise.allSettled([
      Promise.resolve().then(() => session.defaultSession.clearStorageData()),
      Promise.resolve().then(() => session.defaultSession.clearCache()),
    ]);
    const storageFailure = storageResults.find((result) => result.status === "rejected");
    if (storageFailure) {
      void writeDiagnostic("local-data-reset.storage-cleanup-failed", {
        message: storageFailure.reason instanceof Error ? storageFailure.reason.message : String(storageFailure.reason),
      });
    }

    clearTimeout(forcedExitTimer);
    setTimeout(() => app.exit(0), 50).unref();
    return { scheduled: true };
  });
  ipcMain.handle("desktop:set-api-base-url", async (_event, value) => {
    const normalized = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
    if (normalized) {
      let parsed;
      try { parsed = new URL(normalized); } catch { throw new Error("Desktop API URL must be a valid HTTP(S) URL"); }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Desktop API URL must use HTTP(S)");
    }
    if (normalized === configuredApiBaseUrl) return configuredApiBaseUrl;
    scheduledTaskScheduler.clear();
    configuredApiBaseUrl = normalized;
    await writeFile(instanceUrlPath(), configuredApiBaseUrl);
    if (sidecar) {
      await stopSidecar();
      const nextSidecar = await startSidecar(activeAccountId);
      if (!nextSidecar) throw new Error("EdgeEver sidecar is unavailable after changing instance");
      await nextSidecar.waitUntilReady();
    }
    return configuredApiBaseUrl;
  });
  ipcMain.handle("desktop:update-status", () => desktopUpdateStatus());
  ipcMain.handle("desktop:check-update", async () => {
    try {
      await checkForDesktopUpdate("manual", { force: true, throwOnError: true });
    } catch (error) {
      // Return structured details rather than losing them in Electron IPC errors.
      if (!updateError) recordUpdateError(error, "check");
    }
    return desktopUpdateStatus();
  });
  ipcMain.handle("desktop:download-update", () => downloadTrustedDesktopUpdate("manual-download"));
  ipcMain.handle("desktop:install-update", () => installDownloadedUpdate());
  ipcMain.handle("desktop:stage-resource-begin", async (_event, input) => {
    const { memoId, name, type, size } = normalizeStagedResourceMetadataInput(input);
    const id = `stage_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const directory = stagedResourceDirectory();
    await mkdir(directory, { recursive: true });
    await restrictDirectory(directory);
    const metadata = { id, memoId, name, type, size };
    const pendingMetadataPath = join(directory, `${id}.pending.json`);
    const pendingBytesPath = join(directory, `${id}.pending.bin`);
    await writeFile(pendingMetadataPath, JSON.stringify(metadata), { mode: 0o600 });
    await writeFile(pendingBytesPath, new Uint8Array(), { mode: 0o600 });
    await restrictFile(pendingMetadataPath);
    await restrictFile(pendingBytesPath);
    return { id, partSize: STAGED_RESOURCE_PART_BYTES };
  });
  ipcMain.handle("desktop:stage-resource-append", async (_event, id, value) => {
    if (!isSafeResourceId(id)) throw new Error("Invalid staged resource id");
    const bytes = normalizeStagedResourcePart(value);
    const directory = stagedResourceDirectory();
    const pendingMetadataPath = join(directory, `${id}.pending.json`);
    const pendingBytesPath = join(directory, `${id}.pending.bin`);
    const metadata = JSON.parse(await readFile(pendingMetadataPath, "utf8"));
    const current = await stat(pendingBytesPath);
    if (current.size + bytes.byteLength > metadata.size) {
      throw new Error("Staged resource received more bytes than declared");
    }
    await appendFile(pendingBytesPath, bytes);
    return { receivedBytes: current.size + bytes.byteLength };
  });
  ipcMain.handle("desktop:stage-resource-complete", async (_event, id) => {
    if (!isSafeResourceId(id)) throw new Error("Invalid staged resource id");
    const directory = stagedResourceDirectory();
    const pendingMetadataPath = join(directory, `${id}.pending.json`);
    const pendingBytesPath = join(directory, `${id}.pending.bin`);
    const metadata = JSON.parse(await readFile(pendingMetadataPath, "utf8"));
    const current = await stat(pendingBytesPath);
    if (current.size !== metadata.size) throw new Error("Staged resource is incomplete");
    const metadataPath = join(directory, `${id}.json`);
    const bytesPath = join(directory, `${id}.bin`);
    await rename(pendingBytesPath, bytesPath);
    await writeFile(metadataPath, JSON.stringify(metadata), { mode: 0o600 });
    await restrictFile(metadataPath);
    await restrictFile(bytesPath);
    await unlink(pendingMetadataPath).catch(() => {});
    return { id };
  });
  ipcMain.handle("desktop:stage-resource-abort", async (_event, id) => {
    if (!isSafeResourceId(id)) throw new Error("Invalid staged resource id");
    const directory = stagedResourceDirectory();
    await Promise.all([
      unlink(join(directory, `${id}.pending.json`)).catch(() => {}),
      unlink(join(directory, `${id}.pending.bin`)).catch(() => {}),
    ]);
  });
  ipcMain.handle("desktop:list-staged-resources", async () => {
    const directory = stagedResourceDirectory();
    try { await mkdir(directory, { recursive: true }); await restrictDirectory(directory); } catch {}
    return listPendingStagedResources(directory);
  });
  ipcMain.handle("desktop:list-staged-resource-aliases", async (_event, memoId) => {
    const metadata = await listStagedResourceMetadata(stagedResourceDirectory());
    return metadata.filter((item) => (!memoId || item.memoId === memoId) && isSafeResourceId(item.resourceId))
      .map((item) => ({ id: item.id, memoId: item.memoId, resourceId: item.resourceId }));
  });
  ipcMain.handle("desktop:record-staged-resource-alias", async (_event, id, uploadedUrl) => {
    const cacheDirectory = resourceCacheDirectory();
    const resourceId = await cacheStagedResourceBytes(stagedResourceDirectory(), cacheDirectory, id, uploadedUrl);
    await Promise.all([
      restrictDirectory(cacheDirectory),
      restrictFile(join(cacheDirectory, `${resourceId}.bin`)),
      restrictFile(join(cacheDirectory, `${resourceId}.json`)),
    ]);
    const result = await recordStagedResourceAlias(stagedResourceDirectory(), id, uploadedUrl);
    await restrictFile(join(stagedResourceDirectory(), `${id}.json`));
    return { id: result.id, resourceId: result.resourceId };
  });
  ipcMain.handle("desktop:remap-staged-resource-memo-ids", async (_event, mappings) => {
    if (!Array.isArray(mappings) || mappings.length === 0) return { updated: 0 };
    const directory = stagedResourceDirectory();
    try { await mkdir(directory, { recursive: true }); await restrictDirectory(directory); } catch {}
    const names = await readdir(directory);
    let updated = 0;
    for (const name of names.filter((value) => value.endsWith(".json"))) {
      const metadataPath = join(directory, name);
      try {
        const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
        const remapped = remapStagedResourceMetadata(metadata, mappings);
        if (remapped === metadata) continue;
        await writeFile(metadataPath, JSON.stringify(remapped), { mode: 0o600 });
        await restrictFile(metadataPath);
        updated += 1;
      } catch {}
    }
    return { updated };
  });
  ipcMain.handle("desktop:read-staged-resource", async (_event, id) => {
    if (!isSafeResourceId(id)) throw new Error("Invalid staged resource id");
    const directory = stagedResourceDirectory();
    const metadata = await readStagedResourceMetadata(directory, id);
    const bytes = await readFile(join(directory, `${id}.bin`)).catch(async (error) => {
      if (!isSafeResourceId(metadata.resourceId)) throw error;
      const response = await handleResourceProtocolRequest(new Request(`edgeever-resource://resource/${encodeURIComponent(metadata.resourceId)}`));
      if (!response.ok) throw new Error(`Resource request failed (${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    });
    return { ...metadata, bytes: new Uint8Array(bytes) };
  });
  ipcMain.handle("desktop:read-staged-resource-part", async (_event, id, start, length) => {
    if (!isSafeResourceId(id)) throw new Error("Invalid staged resource id");
    if (!Number.isSafeInteger(start) || start < 0) throw new Error("Invalid staged resource offset");
    if (!Number.isSafeInteger(length) || length <= 0 || length > STAGED_RESOURCE_PART_BYTES) {
      throw new Error("Invalid staged resource part length");
    }
    const path = join(stagedResourceDirectory(), `${id}.bin`);
    const details = await stat(path);
    if (start >= details.size || start + length > details.size) throw new Error("Invalid staged resource range");
    const handle = await open(path, "r");
    try {
      const bytes = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(bytes, 0, length, start);
      if (bytesRead !== length) throw new Error("Staged resource part is incomplete");
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytesRead);
    } finally {
      await handle.close();
    }
  });
  ipcMain.handle("desktop:read-resource", async (_event, id) => {
    if (!isSafeResourceId(id)) throw new Error("Invalid resource id");
    const response = await handleResourceProtocolRequest(new Request(
      `edgeever-resource://resource/${encodeURIComponent(id)}`,
    ));
    if (!response.ok) throw new Error(`Resource request failed (${response.status})`);
    return {
      type: response.headers.get("content-type") || "application/octet-stream",
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  });
  ipcMain.handle("desktop:read-wechat-import-media", async (_event, importId, mediaId) => (
    wechatShare().readMedia(importId, mediaId)
  ));
  ipcMain.handle("desktop:finish-wechat-import", async (_event, importId, success) => {
    await wechatShare().finish(importId, success === true);
  });
  ipcMain.handle("desktop:retry-wechat-import", (_event, importId) => wechatShare().retry(importId));
  ipcMain.handle("desktop:remove-staged-resource", async (_event, id) => {
    if (!isSafeResourceId(id)) throw new Error("Invalid staged resource id");
    const directory = stagedResourceDirectory();
    const alias = await readStagedResourceMetadata(directory, id).catch(() => null);
    await Promise.all([
      ...(isSafeResourceId(alias?.resourceId) ? [] : [unlink(join(directory, `${id}.json`)).catch(() => {})]),
      unlink(join(directory, `${id}.bin`)).catch(() => {}),
      unlink(join(directory, `${id}.pending.json`)).catch(() => {}),
      unlink(join(directory, `${id}.pending.bin`)).catch(() => {}),
    ]);
  });

  await createWindow();
  // Inspecting and ejecting mounted disk images invokes macOS command-line
  // tools and may take several seconds. Keep that maintenance off the
  // user-visible critical path so the first installed launch opens promptly.
  await ejectMountedMacInstallers();
  await confirmMacInstallation();
  void enableMacShareExtension({
    platform: process.platform,
    packaged: app.isPackaged,
    executablePath: process.execPath,
    exists: existsSync,
    execFile,
  }).then((result) => {
    if (result.enabled) void writeDiagnostic("share-extension.enabled");
  }).catch((error) => {
    void writeDiagnostic("share-extension.enable-failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
  void registerWindowsShareMenu({
    platform: process.platform,
    packaged: app.isPackaged,
    exePath: process.execPath,
    locale: app.getLocale(),
    execFile,
  }).then((result) => {
    if (result.registered) void writeDiagnostic("windows-share-menu.registered");
  }).catch((error) => {
    void writeDiagnostic("windows-share-menu.register-failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
  configureAutoUpdater();
  handleOpenTarget(process.argv);
  protocolUrlsReady = true;
  while (pendingProtocolUrls.length > 0) handleProtocolUrl(pendingProtocolUrls.shift());
  while (pendingShareFiles.length > 0) void wechatShare().importLocalFile(pendingShareFiles.shift());
  if (process.platform === "darwin" && app.isPackaged) {
    void wechatShare().importPending();
    setInterval(() => { void wechatShare().importPending(); }, 2_000).unref();
  }
  app.on("activate", () => {
    if (!showWindow(mainWindow)) void createWindow();
    void checkForDesktopUpdate("activate");
  });
};

const pendingProtocolUrls = [];
let protocolUrlsReady = false;
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (!protocolUrlsReady) {
    pendingProtocolUrls.push(url);
    return;
  }
  handleProtocolUrl(url);
});

void app.whenReady().then(startApplication).catch((error) => {
  void showMainStartupFailure(error).catch((dialogError) => {
    console.error("Failed to show the desktop startup error", dialogError);
    app.quit();
  });
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  void importMarkdownFile(filePath);
});

app.on("second-instance", (_event, commandLine) => {
  showWindow(mainWindow);
  handleOpenTarget(commandLine);
});

app.on("window-all-closed", () => {
  if (shouldQuitAfterAllWindowsClosed({ rendererOriginMigrationInProgress })) app.quit();
});

app.on("before-quit", (event) => {
  if (shutdownCleanupStarted) return;
  event.preventDefault();
  shutdownCleanupStarted = true;
  isQuitting = true;
  globalShortcut.unregisterAll();
  scheduledTaskScheduler.clear();
  rendererStartupGuard?.complete();
  clearRendererUnresponsiveTimer();
  if (sidecarRestartTimer) {
    clearTimeout(sidecarRestartTimer);
    sidecarRestartTimer = null;
  }
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  tray?.destroy();
  void (async () => {
    await stopSidecar();
    await unlink(crashMarkerPath()).catch(() => {});
    await writeDiagnostic("session.quit");
    app.quit();
  })();
});
