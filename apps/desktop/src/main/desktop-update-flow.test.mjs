import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const mainSource = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../preload/index.cjs", import.meta.url), "utf8");
const noticeSource = readFileSync(new URL("../../../web/src/components/DesktopUpdateNotice.tsx", import.meta.url), "utf8");
const systemInfoSource = readFileSync(new URL("../../../web/src/components/settings/SystemInfoPanel.tsx", import.meta.url), "utf8");
const notebookPaneSource = readFileSync(new URL("../../../web/src/components/NotebookPane.tsx", import.meta.url), "utf8");

describe("desktop update flow", () => {
  test("downloads updates in the background and relaunches after installation", () => {
    expect(mainSource).toContain('autoUpdater.autoDownload = process.platform !== "win32"');
    expect(mainSource).toContain("autoUpdater.autoRunAppAfterInstall = true");
    expect(mainSource).toContain("isQuitting = true;\n  autoUpdater.quitAndInstall(false, true)");
    expect(mainSource).toContain("result?.downloadPromise");
    expect(mainSource).toContain("downloadTrustedDesktopUpdate(reason)");
  });

  test("fails closed around unsigned Windows automatic updates", () => {
    expect(mainSource).toContain("fetchTrustedWindowsUpdate({");
    expect(mainSource).toContain("verifyDownloadedWindowsUpdate({");
    expect(mainSource).toContain('autoUpdater.autoInstallOnAppQuit = process.platform !== "win32"');
    expect(mainSource).toContain("windowsDownloadedUpdateVerified = true");
    expect(mainSource).toContain('writeDiagnostic("update.windows-package-blocked"');
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
    expect(systemInfoSource).toContain('t("systemInfo.connectionSection")');
  });

  test("rechecks for updates while a packaged app remains open", () => {
    expect(mainSource).toContain('checkForDesktopUpdate("startup", { force: true })');
    expect(mainSource).toContain('checkForDesktopUpdate("interval", { force: true })');
    expect(mainSource).toContain('powerMonitor.on("resume"');
    expect(mainSource).toContain('checkForDesktopUpdate("activate")');
    expect(mainSource).toContain("if (updateCheckInFlight) {");
    expect(mainSource).toContain("return throwOnError ? updateCheckInFlight : updateCheckInFlight.catch(() => null)");
    expect(mainSource).toContain("clearInterval(updateCheckTimer)");
  });

  test("only offers the restart action after the update is downloaded", () => {
    expect(noticeSource).toContain('statusQuery.data?.state === "downloaded"');
    expect(noticeSource).toContain('t("systemInfo.desktopUpdateRestart")');
    expect(noticeSource).not.toContain("downloadUpdate()");
  });

  test("pushes update status and shows a native restart prompt after download", () => {
    expect(mainSource).toContain('mainWindow.webContents.send("desktop:update-status-changed"');
    expect(mainSource).toContain("promptForDownloadedUpdate(downloadedUpdateVersion)");
    expect(mainSource).toContain('title: isChinese ? "EdgeEver 更新已就绪" : "EdgeEver update ready"');
    expect(preloadSource).toContain('ipcRenderer.on("desktop:update-status-changed"');
    expect(noticeSource).toContain("bridge.onUpdateStatus");
    expect(noticeSource).toContain('role="alert"');
    expect(notebookPaneSource).toContain("<DesktopUpdateNotice />");
    expect(notebookPaneSource).toContain('className="flex items-center gap-1"');
  });
});
