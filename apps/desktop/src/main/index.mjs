import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, session, net, protocol, shell, dialog, safeStorage, clipboard, powerMonitor } from "electron";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { release as operatingSystemRelease } from "node:os";
import { SidecarRpcClient } from "./rpc.mjs";
import { resourceRequestHeaders } from "./resource-request.mjs";
import { cachedResourceResponse, isSafeResourceId, resourceIdFromRequest } from "./resource-url.mjs";
import { isSupportedAssociatedFile } from "./file-association.mjs";
import { accountDataDirectory, accountScopeKey } from "./account-scope.mjs";
import { rotateDiagnosticLog } from "./diagnostic-log.mjs";
import { restrictDirectory, restrictFile } from "./file-permissions.mjs";
import { normalizeStagedResourceInput, remapStagedResourceMetadata } from "./staged-resource.mjs";
import {
  isMountedDiskImageVolume,
  isMountedInstallerPath,
  mountedInstallerCandidates,
} from "./installation-location.mjs";
import { userDataDirectoryFromArguments } from "./user-data-directory.mjs";
import { isAllowedPrintPreviewUrl } from "./window-open-policy.mjs";
import { showWindow } from "./window-visibility.mjs";
import { trayIconPath } from "./tray-icon.mjs";
import { writeRichClipboard } from "./clipboard-write.mjs";
import { LocalDataResetError, scheduleMacLocalDataReset } from "./local-data-reset.mjs";
import { buildDesktopDiagnosticIssueUrl, normalizeDesktopDiagnostic } from "./desktop-diagnostics.mjs";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

const requestedUserDataDirectory = userDataDirectoryFromArguments(process.argv);
if (requestedUserDataDirectory) app.setPath("userData", requestedUserDataDirectory);

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(currentDirectory, "../../..");
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
let updateCheckInFlight = null;
let updateDownloadInFlight = null;
let updateCheckTimer = null;
let lastUpdateCheckAt = 0;
let downloadedUpdateVersion = null;
let promptedUpdateVersion = null;
let sidecarScopeKey = "anonymous";
let activeAccountId = null;
let shutdownCleanupStarted = false;
let sidecarRestartTimer = null;
let sidecarRestartAttempts = 0;
let sidecarRestartInFlight = false;
let localDataResetScheduled = false;
let rendererCrashDialogOpen = false;
const updateCheckIntervalMs = 60 * 60 * 1_000;
const updateCheckFocusThrottleMs = 15 * 60 * 1_000;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const windowStatePath = () => join(app.getPath("userData"), "window-state.json");
const instanceUrlPath = () => join(app.getPath("userData"), "instance-url");
const sessionTokenPath = () => join(app.getPath("userData"), "session-token");
const crashMarkerPath = () => join(app.getPath("userData"), "last-session-active");
const installationMarkerPath = () => join(app.getPath("userData"), "installation-confirmed");
const logPath = () => join(app.getPath("userData"), "logs", "desktop.log");
let desktopSessionToken = "";
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
    appVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
    osVersion: process.getSystemVersion?.() || "unknown",
    osRelease: operatingSystemRelease(),
    electron: process.versions.electron || "unknown",
    chrome: process.versions.chrome || "unknown",
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
let rendererReady = false;

const flushPendingMarkdownImport = () => {
  if (!pendingMarkdownImport || !rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  const payload = pendingMarkdownImport;
  pendingMarkdownImport = null;
  mainWindow.webContents.send("desktop:import-markdown", payload);
};

const flushPendingDesktopCommands = () => {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  while (pendingDesktopCommands.length > 0) {
    mainWindow.webContents.send("desktop:command", pendingDesktopCommands.shift());
  }
};

const handleOpenTarget = (commandLine) => {
  const target = commandLine.find((value) => value.startsWith("edgeever://"));
  if (target) {
    try {
      const url = new URL(target);
      const memoMatch = url.pathname.match(/^\/memo\/([^/]+)$/);
      if (memoMatch) sendDesktopCommand(`open-memo:${decodeURIComponent(memoMatch[1])}`);
    } catch {
      // Ignore malformed protocol invocations.
    }
  }
  const associatedFile = commandLine.find((value) => !value.startsWith("-") && isSupportedAssociatedFile(value));
  if (associatedFile) void importMarkdownFile(associatedFile);
};

const buildApplicationMenu = () => {
  const template = [
    ...(process.platform === "darwin" ? [{ label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "quit" }] }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Note", accelerator: "CmdOrCtrl+N", click: () => sendDesktopCommand("new-memo") },
        { label: "New Notebook", accelerator: "CmdOrCtrl+Shift+N", click: () => sendDesktopCommand("new-notebook") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Focus Search", accelerator: "CmdOrCtrl+Shift+F", click: () => sendDesktopCommand("focus-search") },
        { label: "Toggle Focus Mode", click: () => sendDesktopCommand("toggle-focus-mode") },
        { type: "separator" },
        { role: "togglefullscreen" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, ...(process.platform === "darwin" ? [{ role: "front" }] : [])],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const createTray = () => {
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
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show EdgeEver", click: () => showWindow(mainWindow) },
    { label: "Sync now", click: () => sendDesktopCommand("sync-now") },
    { label: "Backup now", click: () => sendDesktopCommand("backup-now") },
    ...(updateState === "downloaded" ? [{ label: "Restart to update", click: () => installDownloadedUpdate() }] : []),
    { type: "separator" },
    { label: "Quit EdgeEver", click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => showWindow(mainWindow));
};

const handleResourceProtocolRequest = async (request) => {
  const resourceId = resourceIdFromRequest(request.url);
  if (!resourceId) return new Response("Invalid resource", { status: 400 });

  const directory = resourceCacheDirectory();
  const bytesPath = join(directory, `${resourceId}.bin`);
  const metadataPath = join(directory, `${resourceId}.json`);

  try {
    const bytes = await readFile(bytesPath);
    let metadata = {};
    try { metadata = JSON.parse(await readFile(metadataPath, "utf8")); } catch {}
    return cachedResourceResponse(bytes, metadata.contentType, request.headers.get("range"));
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
    const body = Buffer.from(await response.arrayBuffer());
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
      return new Response(body, { status: 206, headers: responseHeaders });
    }
    await mkdir(directory, { recursive: true });
    await restrictDirectory(directory);
    await writeFile(bytesPath, body, { mode: 0o600 });
    await writeFile(metadataPath, JSON.stringify({ contentType: response.headers.get("content-type") || "application/octet-stream" }), { mode: 0o600 });
    await restrictFile(bytesPath);
    await restrictFile(metadataPath);
    return cachedResourceResponse(body, response.headers.get("content-type"), null);
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
      const metadata = JSON.parse(await readFile(join(directory, `${stagedId}.json`), "utf8"));
      const bytes = await readFile(join(directory, `${stagedId}.bin`));
      return new Response(bytes, {
        headers: {
          "Content-Type": metadata.type || "application/octet-stream",
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      void writeDiagnostic("resource.staged-read-failed", { stagedId, message: error.message });
      return new Response("Staged resource unavailable", { status: 404 });
    }
  });
};

const refreshTrayMenu = () => {
  if (!tray) return;
  tray.destroy();
  createTray();
};

const desktopUpdateStatus = () => ({
  state: updateState,
  version: downloadedUpdateVersion,
});

const publishDesktopUpdateStatus = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:update-status-changed", desktopUpdateStatus());
};

const installDownloadedUpdate = () => {
  if (updateState !== "downloaded") return { started: false };
  // The normal window close handler hides the app. Mark this as a real quit
  // before electron-updater closes windows so installation can proceed.
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
  return { started: true };
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
  void writeDiagnostic("update.check-started", { reason });
  updateCheckInFlight = autoUpdater.checkForUpdates()
    .then((result) => {
      if (result?.downloadPromise) {
        updateDownloadInFlight = result.downloadPromise
          .catch(async (error) => {
            updateState = "idle";
            refreshTrayMenu();
            await writeDiagnostic("update.download-failed", { reason, message: error.message });
          })
          .finally(() => { updateDownloadInFlight = null; });
      }
      return result;
    })
    .catch(async (error) => {
      await writeDiagnostic("update.check-failed", { reason, message: error.message });
      throw error;
    })
    .finally(() => { updateCheckInFlight = null; });
  return throwOnError ? updateCheckInFlight : updateCheckInFlight.catch(() => null);
};

const configureAutoUpdater = () => {
  if (!app.isPackaged || process.env.EDGE_EVER_DISABLE_AUTO_UPDATE === "1") return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.on("update-available", (info) => {
    updateState = "available";
    downloadedUpdateVersion = info?.version || null;
    refreshTrayMenu();
    publishDesktopUpdateStatus();
    void writeDiagnostic("update.available", { version: info?.version });
  });
  autoUpdater.on("update-not-available", () => {
    updateState = "idle";
    downloadedUpdateVersion = null;
    refreshTrayMenu();
    publishDesktopUpdateStatus();
    void writeDiagnostic("update.not-available");
  });
  autoUpdater.on("download-progress", (progress) => { void writeDiagnostic("update.download-progress", { percent: progress.percent }); });
  autoUpdater.on("update-downloaded", (info) => {
    updateState = "downloaded";
    downloadedUpdateVersion = info?.version || downloadedUpdateVersion;
    refreshTrayMenu();
    publishDesktopUpdateStatus();
    void writeDiagnostic("update.downloaded", { version: downloadedUpdateVersion });
    void promptForDownloadedUpdate(downloadedUpdateVersion).catch((error) => {
      promptedUpdateVersion = null;
      void writeDiagnostic("update.prompt-failed", { message: error.message });
    });
  });
  autoUpdater.on("error", (error) => {
    isQuitting = false;
    if (updateState !== "downloaded") {
      updateState = "idle";
      downloadedUpdateVersion = null;
    }
    refreshTrayMenu();
    publishDesktopUpdateStatus();
    void writeDiagnostic("update.error", { message: error.message });
  });
  void checkForDesktopUpdate("startup", { force: true });
  updateCheckTimer = setInterval(() => {
    void checkForDesktopUpdate("interval", { force: true });
  }, updateCheckIntervalMs);
  powerMonitor.on("resume", () => {
    void checkForDesktopUpdate("resume", { force: true });
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
  sidecarProcess = spawn(sidecarPath, ["--data-dir", sidecarDataDirectory(accountId), "--migrations-dir", migrationsPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  sidecarProcess.stderr.on("data", (chunk) => {
    const message = chunk.toString().trimEnd();
    console.error(`[sidecar] ${message}`);
    void writeDiagnostic("sidecar.stderr", { message });
  });
  const processForExitHandler = sidecarProcess;
  sidecarProcess.on("exit", (code, signal) => {
    void writeDiagnostic("sidecar.exit", { code, signal });
    if (sidecarProcess !== processForExitHandler || isQuitting) return;
    sidecarProcess = null;
    sidecar = null;
    scheduleSidecarRestart();
  });
  sidecar = new SidecarRpcClient(sidecarProcess);
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
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    void writeDiagnostic("renderer.preload-error", {
      preloadPath,
      message: String(error?.message || error).slice(0, 2000),
    });
  });
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
    void writeDiagnostic("renderer.gone", details);
    void handleRendererProcessGone(details);
  });
  mainWindow.webContents.on("unresponsive", () => { void writeDiagnostic("renderer.unresponsive"); });
  mainWindow.webContents.on("responsive", () => { void writeDiagnostic("renderer.responsive"); });

  try {
    if (app.isPackaged && !process.env.EDGE_EVER_DESKTOP_WEB_URL) {
      await mainWindow.loadFile(join(process.resourcesPath, "web/index.html"));
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
    if (url.startsWith(webUrl) || url.startsWith("edgeever-resource://") || url.startsWith("edgeever-staged://")) return;
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

app.whenReady().then(async () => {
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
  const previousSessionWasActive = existsSync(crashMarkerPath());
  void writeDiagnostic(previousSessionWasActive ? "session.recovered-after-abnormal-exit" : "session.started");
  await writeFile(crashMarkerPath(), new Date().toISOString());
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerResourceProtocol();
  await startSidecar();
  createTray();

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
  ipcMain.handle("desktop:set-account-scope", async (_event, accountId) => {
    const normalizedAccountId = typeof accountId === "string" && accountId.trim() ? accountId.trim() : null;
    const nextScopeKey = accountScopeKey(configuredApiBaseUrl, normalizedAccountId);
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
  });
  ipcMain.on("desktop:api-base-url-sync", (event) => { event.returnValue = configuredApiBaseUrl; });
  ipcMain.on("desktop:session-token-sync", (event) => { event.returnValue = desktopSessionToken; });
  ipcMain.handle("desktop:copy-text", (_event, value) => {
    if (typeof value !== "string") throw new Error("Clipboard value must be a string");
    clipboard.writeText(value);
    return clipboard.readText() === value;
  });
  ipcMain.handle("desktop:copy-html", (_event, input) => writeRichClipboard(clipboard, input));
  ipcMain.handle("desktop:set-session-token", async (_event, value) => {
    await saveDesktopSessionToken(value);
    return { stored: Boolean(desktopSessionToken) };
  });
  ipcMain.handle("desktop:clear-session-token", async () => {
    await saveDesktopSessionToken("");
    return { stored: false };
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
    await checkForDesktopUpdate("manual", { force: true, throwOnError: true });
    return desktopUpdateStatus();
  });
  ipcMain.handle("desktop:download-update", () => autoUpdater.downloadUpdate());
  ipcMain.handle("desktop:install-update", () => installDownloadedUpdate());
  ipcMain.handle("desktop:stage-resource", async (_event, input) => {
    const { memoId, name, type, bytes } = normalizeStagedResourceInput(input);
    const id = `stage_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const directory = stagedResourceDirectory();
    await mkdir(directory, { recursive: true });
    await restrictDirectory(directory);
    const metadata = { id, memoId, name, type, size: bytes.byteLength };
    const metadataPath = join(directory, `${id}.json`);
    const bytesPath = join(directory, `${id}.bin`);
    await writeFile(metadataPath, JSON.stringify(metadata), { mode: 0o600 });
    await writeFile(bytesPath, Buffer.from(bytes), { mode: 0o600 });
    await restrictFile(metadataPath);
    await restrictFile(bytesPath);
    return { id };
  });
  ipcMain.handle("desktop:list-staged-resources", async () => {
    const directory = stagedResourceDirectory();
    try { await mkdir(directory, { recursive: true }); await restrictDirectory(directory); } catch {}
    const names = await readdir(directory);
    const result = [];
    for (const name of names.filter((value) => value.endsWith(".json"))) {
      try { result.push(JSON.parse(await readFile(join(directory, name), "utf8"))); } catch {}
    }
    return result;
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
    const metadata = JSON.parse(await readFile(join(directory, `${id}.json`), "utf8"));
    const bytes = await readFile(join(directory, `${id}.bin`));
    return { ...metadata, bytes: new Uint8Array(bytes) };
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
  ipcMain.handle("desktop:remove-staged-resource", async (_event, id) => {
    if (!isSafeResourceId(id)) throw new Error("Invalid staged resource id");
    const directory = stagedResourceDirectory();
    await Promise.all([
      unlink(join(directory, `${id}.json`)).catch(() => {}),
      unlink(join(directory, `${id}.bin`)).catch(() => {}),
    ]);
  });

  await createWindow();
  // Inspecting and ejecting mounted disk images invokes macOS command-line
  // tools and may take several seconds. Keep that maintenance off the
  // user-visible critical path so the first installed launch opens promptly.
  await ejectMountedMacInstallers();
  await confirmMacInstallation();
  configureAutoUpdater();
  handleOpenTarget(process.argv);
  app.on("activate", () => {
    if (!showWindow(mainWindow)) void createWindow();
    void checkForDesktopUpdate("activate");
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
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (shutdownCleanupStarted) return;
  event.preventDefault();
  shutdownCleanupStarted = true;
  isQuitting = true;
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
