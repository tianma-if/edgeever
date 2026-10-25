import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
  LOGIN_ITEM_NAME,
  START_HIDDEN_ARG,
  commandLineOpensContent,
  createLoginItemController,
  loginItemArgs,
  loginItemSupported,
  loginItemUpdatePayload,
  normalizeLoginItemArgs,
  normalizeLoginItemPatch,
  parseLoginItemPreference,
  shouldStartHidden,
  startupLoginItemPlan,
} from "./login-item.mjs";

const exePath = "C:\\Users\\Example\\AppData\\Local\\Programs\\EdgeEver\\EdgeEver.exe";

const windowsItem = (overrides = {}) => ({
  name: LOGIN_ITEM_NAME,
  path: exePath,
  args: [],
  enabled: true,
  scope: "user",
  ...overrides,
});

describe("login item support", () => {
  test("is available only for a packaged Windows or macOS app", () => {
    expect(loginItemSupported({ platform: "win32", packaged: true })).toBe(true);
    expect(loginItemSupported({ platform: "darwin", packaged: true })).toBe(true);
    expect(loginItemSupported({ platform: "linux", packaged: true })).toBe(false);
    expect(loginItemSupported({ platform: "win32", packaged: false })).toBe(false);
  });

  test("keeps an unreadable preference turned off", () => {
    expect(parseLoginItemPreference("{")).toEqual({ openAtLogin: false, launchMode: "window" });
    expect(parseLoginItemPreference({ openAtLogin: true, launchMode: "tray" })).toEqual({
      openAtLogin: true,
      launchMode: "window",
    });
    expect(parseLoginItemPreference({ openAtLogin: "yes", launchMode: "elsewhere" })).toEqual({
      openAtLogin: false,
      launchMode: "window",
    });
  });

  test("rejects an empty or unknown settings change", () => {
    const current = { openAtLogin: true, launchMode: "window" };
    expect(normalizeLoginItemPatch(current, null)).toBeNull();
    expect(normalizeLoginItemPatch(current, {})).toBeNull();
    expect(normalizeLoginItemPatch(current, { launchMode: "background" })).toBeNull();
    expect(normalizeLoginItemPatch(current, { openAtLogin: "yes" })).toBeNull();
    expect(normalizeLoginItemPatch(current, { launchMode: "tray" })).toEqual({
      openAtLogin: true,
      launchMode: "window",
    });
  });
});

describe("login item startup plan", () => {
  test("writes a missing Windows entry and refreshes a stale path or argument", () => {
    expect(startupLoginItemPlan({
      platform: "win32",
      packaged: true,
      saved: { openAtLogin: true, launchMode: "window" },
      os: { launchItems: [] },
      executablePath: exePath,
    }).action).toBe("apply");

    const stale = startupLoginItemPlan({
      platform: "win32",
      packaged: true,
      saved: { openAtLogin: true, launchMode: "tray" },
      os: { launchItems: [windowsItem({ path: "C:\\Old\\EdgeEver.exe", args: [] })] },
      executablePath: exePath,
    });
    expect(stale.action).toBe("apply");
    expect(loginItemUpdatePayload({
      openAtLogin: true,
      launchMode: stale.launchMode,
      executablePath: exePath,
      platform: "win32",
    })).toEqual({
      openAtLogin: true,
      path: exePath,
      name: LOGIN_ITEM_NAME,
      args: [],
      enabled: true,
    });
  });

  test("does not turn a Windows entry back on after Task Manager disables it", () => {
    const plan = startupLoginItemPlan({
      platform: "win32",
      packaged: true,
      saved: { openAtLogin: true, launchMode: "tray" },
      os: { launchItems: [windowsItem({ enabled: false, args: [START_HIDDEN_ARG] })] },
      executablePath: exePath,
    });
    expect(plan).toMatchObject({ action: "persist-off", openAtLogin: false, status: "disabled-by-system" });
  });

  test("leaves a matching Windows entry untouched and removes one the user turned off", () => {
    expect(startupLoginItemPlan({
      platform: "win32",
      packaged: true,
      saved: { openAtLogin: true, launchMode: "tray" },
      os: { launchItems: [windowsItem({ args: [START_HIDDEN_ARG] })] },
      executablePath: exePath,
    }).action).toBe("apply");
    expect(startupLoginItemPlan({
      platform: "win32",
      packaged: true,
      saved: { openAtLogin: true, launchMode: "window" },
      os: { launchItems: [windowsItem({ args: [exePath, "--"] })] },
      executablePath: exePath,
    }).action).toBe("none");
    expect(normalizeLoginItemArgs([exePath, "--"], exePath)).toEqual([]);
    expect(startupLoginItemPlan({
      platform: "win32",
      packaged: true,
      saved: { openAtLogin: false, launchMode: "window" },
      os: { launchItems: [windowsItem()] },
      executablePath: exePath,
    }).action).toBe("remove");
  });

  test("follows macOS login-item status without rewriting an approved entry", () => {
    expect(startupLoginItemPlan({
      platform: "darwin",
      packaged: true,
      saved: { openAtLogin: true, launchMode: "tray" },
      os: { openAtLogin: false, status: "not-registered" },
      executablePath: "/Applications/EdgeEver.app/Contents/MacOS/EdgeEver",
    })).toMatchObject({ action: "persist-off", openAtLogin: false });
    expect(startupLoginItemPlan({
      platform: "darwin",
      packaged: true,
      saved: { openAtLogin: true, launchMode: "window" },
      os: { openAtLogin: true, status: "requires-approval" },
      executablePath: "/Applications/EdgeEver.app/Contents/MacOS/EdgeEver",
    })).toMatchObject({ action: "none", status: "requires-approval", openAtLogin: true });
    expect(startupLoginItemPlan({
      platform: "darwin",
      packaged: true,
      saved: { openAtLogin: true, launchMode: "window" },
      os: { openAtLogin: false, status: "not-found" },
      executablePath: "/Applications/EdgeEver.app/Contents/MacOS/EdgeEver",
    }).action).toBe("apply");
    expect(loginItemArgs("window")).toEqual([]);
    expect(loginItemUpdatePayload({
      openAtLogin: true,
      launchMode: "tray",
      executablePath: "/Applications/EdgeEver.app/Contents/MacOS/EdgeEver",
      platform: "darwin",
    })).toEqual({ openAtLogin: true });
  });

  test("keeps the saved choice when the system setting cannot be read", () => {
    expect(startupLoginItemPlan({
      platform: "win32",
      packaged: true,
      saved: { openAtLogin: true, launchMode: "tray" },
      os: null,
      osReadable: false,
      executablePath: exePath,
    })).toMatchObject({ action: "none", openAtLogin: true, launchMode: "window" });
    expect(startupLoginItemPlan({
      platform: "linux",
      packaged: true,
      saved: { openAtLogin: true, launchMode: "tray" },
      os: null,
      executablePath: "/app/EdgeEver.AppImage",
    }).supported).toBe(false);
  });
});

describe("hidden login launch", () => {
  test("opens the main window after login, including an older hidden launch", () => {
    expect(shouldStartHidden({ argv: ["EdgeEver.exe", START_HIDDEN_ARG], launchMode: "tray" })).toBe(false);
    expect(shouldStartHidden({
      argv: ["EdgeEver.exe"],
      wasOpenedAtLogin: true,
      launchMode: "tray",
    })).toBe(false);
    expect(shouldStartHidden({
      argv: ["EdgeEver.exe"],
      wasOpenedAtLogin: true,
      launchMode: "window",
    })).toBe(false);
    expect(shouldStartHidden({
      argv: ["EdgeEver.exe", START_HIDDEN_ARG, "--share-file", "D:\\Notes\\a.md"],
      opensContent: commandLineOpensContent(
        ["EdgeEver.exe", START_HIDDEN_ARG, "--share-file", "D:\\Notes\\a.md"],
        { isAssociatedFile: (value) => value.endsWith(".md") },
      ),
    })).toBe(false);
    expect(commandLineOpensContent(["EdgeEver.exe", "edgeever://memo/1"])).toBe(true);
    expect(commandLineOpensContent(["EdgeEver.exe", "--share-file"])).toBe(false);
  });
});

describe("login item controller", () => {
  const createHarness = (platform) => {
    const files = new Map();
    let registry = null;
    let openedAtLogin = false;
    const calls = [];
    const controller = createLoginItemController({
      platform,
      packaged: true,
      executablePath: exePath,
      preferencePath: "/user/login-item.json",
      readFile: async (path) => {
        if (!files.has(path)) throw new Error("missing");
        return files.get(path);
      },
      writeFile: async (path, content) => { files.set(path, content); },
      rename: async (from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
      },
      unlink: async (path) => { files.delete(path); },
      getLoginItemSettings: () => ({
        openAtLogin: Boolean(registry),
        wasOpenedAtLogin: openedAtLogin,
        status: registry?.status ?? (registry ? "enabled" : "not-registered"),
        launchItems: registry ? [registry] : [],
      }),
      setLoginItemSettings: (settings) => {
        calls.push(settings);
        if (!settings.openAtLogin) {
          registry = null;
          return;
        }
        registry = {
          name: settings.name,
          path: settings.path,
          args: settings.args ?? [],
          enabled: settings.enabled !== false,
          status: "enabled",
        };
      },
    });
    return {
      controller,
      calls,
      files,
      setRegistry: (value) => { registry = value; },
      setOpenedAtLogin: (value) => { openedAtLogin = value; },
    };
  };

  test("repairs a packaged Windows login item from the saved preference", async () => {
    const harness = createHarness("win32");
    harness.files.set("/user/login-item.json", JSON.stringify({ openAtLogin: true, launchMode: "tray" }));
    const state = await harness.controller.reconcileAtStartup();
    expect(state).toMatchObject({ supported: true, openAtLogin: true, launchMode: "window", status: "enabled" });
    expect(JSON.parse(harness.files.get("/user/login-item.json")).launchMode).toBe("window");
    expect(harness.calls).toEqual([{
      openAtLogin: true,
      path: exePath,
      name: LOGIN_ITEM_NAME,
      args: [],
      enabled: true,
    }]);
  });

  test("remembers a system disable and a failed change", async () => {
    const harness = createHarness("win32");
    harness.files.set("/user/login-item.json", JSON.stringify({ openAtLogin: true, launchMode: "window" }));
    harness.setRegistry(windowsItem({ enabled: false }));
    const disabled = await harness.controller.reconcileAtStartup();
    expect(disabled).toMatchObject({ openAtLogin: false, status: "disabled-by-system" });
    expect(JSON.parse(harness.files.get("/user/login-item.json")).openAtLogin).toBe(false);
    expect(harness.calls).toEqual([]);

    harness.setRegistry(null);
    const turnedOn = await harness.controller.update({ openAtLogin: true, launchMode: "window" });
    expect(turnedOn).toMatchObject({ openAtLogin: true, status: "enabled" });
    await expect(harness.controller.update({ launchMode: "background" })).resolves.toMatchObject({ error: "invalid" });
  });

  test("keeps macOS approval visible and opens the window after login", async () => {
    const harness = createHarness("darwin");
    harness.files.set("/user/login-item.json", JSON.stringify({ openAtLogin: true, launchMode: "tray" }));
    harness.setRegistry({ status: "requires-approval" });
    harness.setOpenedAtLogin(true);
    const state = await harness.controller.reconcileAtStartup();
    expect(state).toMatchObject({ openAtLogin: true, launchMode: "window", status: "requires-approval" });
    expect(harness.calls).toEqual([]);
    expect(harness.controller.wasOpenedAtLogin()).toBe(true);
    expect(shouldStartHidden({
      argv: ["EdgeEver"],
      wasOpenedAtLogin: harness.controller.wasOpenedAtLogin(),
      launchMode: state.launchMode,
    })).toBe(false);
  });
});

describe("desktop login item wiring", () => {
  test("settings, startup, and uninstall share the same login item", () => {
    const main = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
    const preload = readFileSync(new URL("../preload/index.cjs", import.meta.url), "utf8");
    const installer = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "nsis", "installer.nsh"), "utf8");
    const settings = readFileSync(new URL("../../../web/src/components/settings/LoginItemSettingsItem.tsx", import.meta.url), "utf8");
    const preferences = readFileSync(new URL("../../../web/src/components/settings/PreferenceCard.tsx", import.meta.url), "utf8");

    expect(main).toContain("createWindow({ show: !startHidden })");
    expect(main).toContain("if (show && state.isMaximized) mainWindow.maximize();");
    expect(main).toContain('ipcMain.handle("desktop:login-item"');
    expect(main).toContain('ipcMain.handle("desktop:set-login-item"');
    expect(main).toContain("revealMainWindow()");
    expect(preload).toContain('loginItem: () => ipcRenderer.invoke("desktop:login-item")');
    expect(preload).toContain('setLoginItem: (patch) => ipcRenderer.invoke("desktop:set-login-item", patch)');
    expect(settings).toContain('t("settings.loginItem.title")');
    expect(settings).toContain("bridge.loginItem()");
    expect(settings).toContain("bridge.setLoginItem(patch)");
    expect(preferences).toContain("<LoginItemSettingsItem />");
    expect(installer).toContain("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    expect(installer).toContain("DeleteRegValue HKCU \"Software\\Microsoft\\Windows\\CurrentVersion\\Run\" \"EdgeEver\"");
    expect(installer).toContain("DeleteRegValue HKCU \"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run\" \"EdgeEver\"");
  });
});
