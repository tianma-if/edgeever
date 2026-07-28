import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, session, net, protocol, shell } from "electron";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SidecarRpcClient } from "./rpc.mjs";
import { isSafeResourceId, resourceIdFromRequest } from "./resource-url.mjs";
import { isSupportedAssociatedFile } from "./file-association.mjs";
import { accountDataDirectory, accountScopeKey } from "./account-scope.mjs";
import { rotateDiagnosticLog } from "./diagnostic-log.mjs";
import { restrictDirectory, restrictFile } from "./file-permissions.mjs";
import { normalizeStagedResourceInput } from "./staged-resource.mjs";
import { autoUpdater } from "electron-updater";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(currentDirectory, "../../..");
const webUrl = process.env.EDGE_EVER_DESKTOP_WEB_URL || "http://127.0.0.1:5173";
const apiBaseUrl = (process.env.EDGE_EVER_API_URL || (process.env.EDGE_EVER_DESKTOP_WEB_URL ? webUrl : "")).replace(/\/$/, "");
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
let sidecarScopeKey = "anonymous";
let activeAccountId = null;
let shutdownCleanupStarted = false;
let sidecarRestartTimer = null;
let sidecarRestartAttempts = 0;
let sidecarRestartInFlight = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const windowStatePath = () => join(app.getPath("userData"), "window-state.json");
const instanceUrlPath = () => join(app.getPath("userData"), "instance-url");
const crashMarkerPath = () => join(app.getPath("userData"), "last-session-active");
const logPath = () => join(app.getPath("userData"), "logs", "desktop.log");
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
        { label: "Focus Search", accelerator: "CmdOrCtrl+K", click: () => sendDesktopCommand("focus-search") },
        { label: "Toggle Focus Mode", accelerator: "CmdOrCtrl+Shift+F", click: () => sendDesktopCommand("toggle-focus-mode") },
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
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "web", "pwa-192x192.png")
    : join(projectRoot, "apps/web/public/pwa-192x192.png");
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("EdgeEver");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show EdgeEver", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: "Sync now", click: () => sendDesktopCommand("sync-now") },
    { label: "Backup now", click: () => sendDesktopCommand("backup-now") },
    ...(updateState === "available" ? [{ label: "Download update", click: () => void autoUpdater.downloadUpdate() }] : []),
    ...(updateState === "downloaded" ? [{ label: "Restart to update", click: () => autoUpdater.quitAndInstall() }] : []),
    { type: "separator" },
    { label: "Quit EdgeEver", click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus(); });
};

const registerResourceProtocol = () => {
  protocol.handle("edgeever-resource", async (request) => {
    const resourceId = resourceIdFromRequest(request.url);
    if (!resourceId) return new Response("Invalid resource", { status: 400 });

    const directory = resourceCacheDirectory();
    const bytesPath = join(directory, `${resourceId}.bin`);
    const metadataPath = join(directory, `${resourceId}.json`);

    try {
      const bytes = await readFile(bytesPath);
      let metadata = {};
      try { metadata = JSON.parse(await readFile(metadataPath, "utf8")); } catch {}
      return new Response(bytes, { headers: { "Content-Type": metadata.contentType || "application/octet-stream", "Cache-Control": "no-store" } });
    } catch {
      // Fall through to the instance while online, then persist the response.
    }

    if (!configuredApiBaseUrl) return new Response("Resource is not cached", { status: 504 });
    const sourceUrl = `${configuredApiBaseUrl}/api/v1/resources/${encodeURIComponent(resourceId)}/blob`;
    try {
      const cookies = await session.defaultSession.cookies.get({ url: sourceUrl });
      const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
      const response = await net.fetch(sourceUrl, cookieHeader ? { headers: { Cookie: cookieHeader } } : undefined);
      if (!response.ok) return new Response("Resource request failed", { status: response.status });
      const body = Buffer.from(await response.arrayBuffer());
      await mkdir(directory, { recursive: true });
      await restrictDirectory(directory);
      await writeFile(bytesPath, body, { mode: 0o600 });
      await writeFile(metadataPath, JSON.stringify({ contentType: response.headers.get("content-type") || "application/octet-stream" }), { mode: 0o600 });
      await restrictFile(bytesPath);
      await restrictFile(metadataPath);
      return new Response(body, { headers: { "Content-Type": response.headers.get("content-type") || "application/octet-stream", "Cache-Control": "no-store" } });
    } catch (error) {
      void writeDiagnostic("resource.cache-failed", { resourceId, message: error.message });
      return new Response("Resource unavailable", { status: 504 });
    }
  });

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

const configureAutoUpdater = () => {
  if (!app.isPackaged || process.env.EDGE_EVER_DISABLE_AUTO_UPDATE === "1") return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", () => { updateState = "available"; refreshTrayMenu(); void writeDiagnostic("update.available"); });
  autoUpdater.on("download-progress", (progress) => { void writeDiagnostic("update.download-progress", { percent: progress.percent }); });
  autoUpdater.on("update-downloaded", () => { updateState = "downloaded"; refreshTrayMenu(); void writeDiagnostic("update.downloaded"); });
  autoUpdater.on("error", (error) => { void writeDiagnostic("update.error", { message: error.message }); });
  void autoUpdater.checkForUpdates().catch((error) => writeDiagnostic("update.check-failed", { message: error.message }));
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
      preload: join(currentDirectory, "../preload/index.mjs"),
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

  if (app.isPackaged && !process.env.EDGE_EVER_DESKTOP_WEB_URL) {
    await mainWindow.loadFile(join(process.resourcesPath, "web/index.html"));
  } else {
    await mainWindow.loadURL(webUrl);
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("edgeever-resource://") || url.startsWith("edgeever-staged://")) return { action: "allow" };
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    void writeDiagnostic("renderer.gone", details);
  });
  mainWindow.webContents.on("unresponsive", () => { void writeDiagnostic("renderer.unresponsive"); });
  mainWindow.webContents.on("responsive", () => { void writeDiagnostic("renderer.responsive"); });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(webUrl) || url.startsWith("edgeever-resource://") || url.startsWith("edgeever-staged://")) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
  });
  buildApplicationMenu();
};

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    app.quit();
    return;
  }
  await loadConfiguredApiBaseUrl();
  app.setAsDefaultProtocolClient("edgeever");
  const previousSessionWasActive = existsSync(crashMarkerPath());
  void writeDiagnostic(previousSessionWasActive ? "session.recovered-after-abnormal-exit" : "session.started");
  await writeFile(crashMarkerPath(), new Date().toISOString());
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  registerResourceProtocol();
  await startSidecar();
  createTray();

  ipcMain.handle("desktop:sidecar-request", async (_event, method, params) => {
    if (!sidecar) throw new Error("EdgeEver sidecar is unavailable");
    return sidecar.request(method, params);
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
  ipcMain.handle("desktop:set-api-base-url", async (_event, value) => {
    const normalized = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
    if (normalized) {
      let parsed;
      try { parsed = new URL(normalized); } catch { throw new Error("Desktop API URL must be a valid HTTP(S) URL"); }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Desktop API URL must use HTTP(S)");
    }
    if (normalized === configuredApiBaseUrl) return configuredApiBaseUrl;
    configuredApiBaseUrl = normalized;
    void writeFile(instanceUrlPath(), configuredApiBaseUrl);
    if (sidecar) {
      await stopSidecar();
      const nextSidecar = await startSidecar(activeAccountId);
      if (!nextSidecar) throw new Error("EdgeEver sidecar is unavailable after changing instance");
      await nextSidecar.waitUntilReady();
    }
    return configuredApiBaseUrl;
  });
  ipcMain.handle("desktop:update-status", () => ({ state: updateState }));
  ipcMain.handle("desktop:download-update", () => autoUpdater.downloadUpdate());
  ipcMain.handle("desktop:install-update", () => autoUpdater.quitAndInstall());
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
  ipcMain.handle("desktop:read-staged-resource", async (_event, id) => {
    if (!isSafeResourceId(id)) throw new Error("Invalid staged resource id");
    const directory = stagedResourceDirectory();
    const metadata = JSON.parse(await readFile(join(directory, `${id}.json`), "utf8"));
    const bytes = await readFile(join(directory, `${id}.bin`));
    return { ...metadata, bytes: new Uint8Array(bytes) };
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
  configureAutoUpdater();
  handleOpenTarget(process.argv);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  void importMarkdownFile(filePath);
});

app.on("second-instance", (_event, commandLine) => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
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
  tray?.destroy();
  void (async () => {
    await stopSidecar();
    await unlink(crashMarkerPath()).catch(() => {});
    await writeDiagnostic("session.quit");
    app.quit();
  })();
});
