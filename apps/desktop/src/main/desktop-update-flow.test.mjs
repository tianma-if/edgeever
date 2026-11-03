import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const mainSource = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const controllerSource = readFileSync(new URL("./desktop-update-controller.mjs", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../preload/index.cjs", import.meta.url), "utf8");
const noticeSource = readFileSync(new URL("../../../web/src/components/DesktopUpdateNotice.tsx", import.meta.url), "utf8");
const systemInfoSource = readFileSync(new URL("../../../web/src/components/settings/SystemInfoPanel.tsx", import.meta.url), "utf8");
const notebookPaneSource = readFileSync(new URL("../../../web/src/components/NotebookPane.tsx", import.meta.url), "utf8");

describe("desktop update flow", () => {
  test("enables automatic updates for packaged Linux AppImages", () => {
    expect(mainSource).not.toContain('process.platform === "linux" || !app.isPackaged');
    expect(mainSource).toContain('autoUpdateSupported: true');
    expect(mainSource).toContain('process.env.GITHUB_ACTIONS === "true"');
    expect(mainSource).toContain("Linux update verification requires a loopback HTTP feed");
    expect(systemInfoSource).toContain("desktopAutoUpdateSupported");
    expect(systemInfoSource).toContain('t("systemInfo.desktopDownloadLatest")');
  });

  test("routes every desktop platform through one update controller", () => {
    expect(mainSource).toContain("desktopUpdateController = createDesktopUpdateController({");
    expect(mainSource).toContain("platform: process.platform");
    expect(mainSource).not.toContain("windowsUpdateController");
    expect(mainSource).not.toContain('updateState === "downloaded") {');
    expect(mainSource).toContain("desktopUpdateController.check(reason)");
    expect(mainSource).toContain("desktopUpdateController?.install(expectedVersion)");
    expect(mainSource).toContain("desktopUpdateController?.download(reason)");
    expect(controllerSource).toContain("void download(reason)");
    expect(controllerSource).toContain("updater.autoRunAppAfterInstall = true");
  });

  test("provides Windows trust gates and macOS native installation to the shared controller", () => {
    expect(mainSource).toContain("fetchTrustedWindowsUpdate({ ...options, fetchImpl: net.fetch })");
    expect(mainSource).toContain("verifyWindowsPackage: verifyDownloadedWindowsUpdate");
    expect(mainSource).toContain("nativeUpdater: nativeAutoUpdater");
    expect(mainSource).toContain("desktopUpdateController?.handleBeforeQuit(event)");
    expect(mainSource).toContain('downloadTrustedDesktopUpdate("manual-download")');
  });

  test("offers a manual update check in desktop system settings", () => {
    expect(mainSource).toContain('ipcMain.handle("desktop:check-update"');
    expect(mainSource).toContain('checkForDesktopUpdate("manual", { force: true, throwOnError: true })');
    expect(preloadSource).toContain('checkUpdate: () => ipcRenderer.invoke("desktop:check-update")');
    expect(systemInfoSource).toContain('t("systemInfo.desktopCheckForUpdates")');
    expect(systemInfoSource).toContain("desktopBridge!.checkUpdate()");
    expect(systemInfoSource).toContain('t("systemInfo.desktopUpdateCurrent")');
  });

  test("shares precise desktop runtime diagnostics with the system information panel", () => {
    expect(mainSource).toContain('ipcMain.handle("desktop:system-info", () => desktopRuntimeSystemInfo())');
    expect(preloadSource).toContain('systemInfo: () => ipcRenderer.invoke("desktop:system-info")');
    expect(systemInfoSource).toContain("getClientRuntimeDiagnostics");
    expect(systemInfoSource).toContain('t("systemInfo.runtimeEngine")');
    expect(systemInfoSource).toContain('t("systemInfo.deviceModel")');
    expect(systemInfoSource).toContain('t("systemInfo.connectionSection")');
    expect(mainSource).toContain("deviceModel: desktopDeviceModel()");
    expect(systemInfoSource).not.toContain('t("systemInfo.dataDirectory")');
    expect(mainSource).toContain("dataDir: sidecarDataDirectory(activeAccountId)");
  });

  test("rechecks for updates while a packaged app remains open", () => {
    expect(mainSource).toContain('checkForDesktopUpdate("startup", { force: true })');
    expect(mainSource).toContain('checkForDesktopUpdate("interval", { force: true })');
    expect(mainSource).toContain('powerMonitor.on("resume"');
    expect(mainSource).toContain('checkForDesktopUpdate("activate")');
    expect(controllerSource).toContain("if (checkInFlight) return checkInFlight;");
    expect(mainSource).toContain("clearInterval(updateCheckTimer)");
  });

  test("only offers the restart action after the update is downloaded", () => {
    expect(noticeSource).toContain('statusQuery.data?.state === "downloaded"');
    expect(noticeSource).toContain('t("systemInfo.desktopUpdateRestart")');
    expect(noticeSource).not.toContain("downloadUpdate()");
  });

  test("pushes update status and shows a native restart prompt after download", () => {
    expect(mainSource).toContain('mainWindow.webContents.send("desktop:update-status-changed"');
    expect(mainSource).toContain("promptForDownloadedUpdate(version)");
    expect(mainSource).toContain("title: copy.updateReadyTitle");
    expect(preloadSource).toContain('ipcRenderer.on("desktop:update-status-changed"');
    expect(noticeSource).toContain("bridge.onUpdateStatus");
    expect(noticeSource).toContain('role="alert"');
    expect(notebookPaneSource).toContain("<DesktopUpdateNotice />");
    expect(notebookPaneSource).toContain('className="flex items-center gap-1"');
  });

  test("does not hold auto-restart while the GitHub release is newer than the instance", () => {
    expect(mainSource).not.toContain("shouldHoldAutoRestartUpdate");
    expect(mainSource).not.toContain("holdAutoRestartUpdate");
    expect(mainSource).not.toContain("heldUpdateVersion");
    expect(mainSource).not.toContain("update.held-for-instance");
    expect(mainSource).toContain("promptForDownloadedUpdate(version)");
    expect(systemInfoSource).toContain("clientAheadOfInstanceByPlatform");
    expect(systemInfoSource).toContain("isClientAheadOfInstance");
  });

  test("updates the existing tray context menu in-place without destroying the tray instance", () => {
    expect(mainSource).not.toContain("tray.destroy();\n  createTray();");
    expect(mainSource).toContain("tray.setContextMenu(buildTrayContextMenu())");
  });
});
