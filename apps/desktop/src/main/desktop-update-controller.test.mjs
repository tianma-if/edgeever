import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createDesktopUpdateController } from "./desktop-update-controller.mjs";
import { prepareMacUpdate } from "./mac-update-install.mjs";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { BaseUpdater } = require("electron-updater/out/BaseUpdater.js");
const { MacUpdater } = require("electron-updater/out/MacUpdater.js");
const { AppImageUpdater } = require("electron-updater/out/AppImageUpdater.js");
const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

// Use real AppUpdater selection/download bookkeeping and MacUpdater's real
// authenticated loopback proxy. The native Squirrel API and installer process
// are simulated; these tests do not claim OS signing or installation coverage.
const harness = async (platform) => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-desktop-update-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const releases = new Map();
  for (const version of ["2.17.0", "2.18.0", "2.19.0"]) {
    const bytes = Buffer.from(`package ${version}`);
    const name = platform === "darwin" ? `EdgeEver-${version}-mac-arm64.zip` : `EdgeEver-${version}-linux-x64.AppImage`;
    const path = join(directory, name);
    await writeFile(path, bytes);
    releases.set(version, { path, bytes, info: { version, files: [{ url: name, size: bytes.length,
      sha512: createHash("sha512").update(bytes).digest("base64") }] } });
  }
  const h = { latest: "2.17.0", checks: 0, downloads: [], installs: [], errors: [], notices: [],
    prepared: [], quitFallbacks: 0, relaunches: [], checkError: null, downloadError: null, eventVersion: null,
    downloadGate: null, checkGate: null, nativeGate: null, nativeError: null };
  const app = { version: "2.16.1", isPackaged: true, onQuit: (handler) => { h.quitHandler = handler; } };
  const updater = platform === "linux" ? new AppImageUpdater(null, app) : new BaseUpdater(null, app);
  updater.logger = null;
  if (platform === "linux") updater.forceDevUpdateConfig = true;
  const native = new EventEmitter();
  let feed;
  let preparedVersion;
  native.setFeedURL = (options) => { feed = options; };
  native.getFeedURL = () => feed?.url;
  native.checkForUpdates = () => {
    void (async () => {
      if (h.nativeGate) await h.nativeGate.promise;
      if (h.nativeError) throw h.nativeError;
      const expectedFeed = feed;
      const response = await fetch(expectedFeed.url, { headers: expectedFeed.headers });
      if (!response.ok) throw new Error(`Feed returned ${response.status}`);
      const metadata = await response.json();
      const zip = await fetch(metadata.url);
      if (!zip.ok) throw new Error(`Archive returned ${zip.status}`);
      const bytes = Buffer.from(await zip.arrayBuffer());
      const release = [...releases].find(([, value]) => value.bytes.equals(bytes));
      if (!release) throw new Error("Native updater received an unexpected ZIP");
      preparedVersion = release[0];
      h.prepared.push(preparedVersion);
      native.emit("update-downloaded");
    })().catch((error) => native.emit("error", error));
  };
  native.quitAndInstall = () => {
    h.relaunches.push(true);
    h.installs.push({ version: preparedVersion, path: releases.get(preparedVersion).path });
    updater.closeServerIfExists();
  };
  if (platform === "darwin") {
    // Initialize the real MacUpdater methods without loading Electron's native
    // module into the test runner. Its global native updater is injected here.
    Object.setPrototypeOf(updater, MacUpdater.prototype);
    updater.nativeUpdater = native;
    updater.squirrelDownloadedUpdate = false;
    native.on("error", (error) => updater.emit("error", error));
    native.on("update-downloaded", () => { updater.squirrelDownloadedUpdate = true; });
    cleanup.push(() => { updater.closeServerIfExists(); });
  }
  updater.getUpdateInfoAndProvider = async () => {
    h.checks++;
    if (h.checkGate) await h.checkGate.promise;
    if (h.checkError) throw h.checkError;
    const info = h.latest ? structuredClone(releases.get(h.latest).info) : { version: "2.16.1" };
    return { info, provider: {} };
  };
  updater.doDownloadUpdate = async ({ updateInfoAndProvider: { info } }) => {
    const version = info.version;
    h.downloads.push(version);
    if (h.downloadGate) await h.downloadGate.promise;
    if (h.downloadError) throw h.downloadError;
    const path = releases.get(version).path;
    updater.downloadedUpdateHelper = { file: path, downloadedFileInfo: { isAdminRightsRequired: false } };
    const event = { ...info, version: h.eventVersion || version, downloadedFile: path };
    if (platform === "darwin") {
      return updater.updateDownloaded({ url: new URL(`https://example.invalid/${info.files[0].url}`), info: info.files[0] }, event);
    }
    updater.dispatchUpdateDownloaded(event);
    updater.addQuitHandler();
    return [path];
  };
  if (platform === "linux") {
    updater.doInstall = ({ isForceRunAfter }) => {
      h.relaunches.push(isForceRunAfter);
      const path = updater.installerPath;
      h.installs.push({ version: [...releases].find(([, value]) => value.path === path)[0], path });
      return true;
    };
    updater.quitAndInstall = (silent, forceRun) => updater.install(silent, forceRun);
  }
  const controller = createDesktopUpdateController({
    updater, platform, nativeUpdater: native,
    fetchWindowsMetadata: () => { throw new Error("Windows trust must not run on another platform"); },
    verifyWindowsPackage: () => { throw new Error("Windows trust must not run on another platform"); },
    onStatus: () => {}, onError: (error, stage) => h.errors.push({ error, stage }),
    onDownloaded: (version) => h.notices.push(version), beforeInstall: () => {},
    quitApplication: () => {
      if (platform === "darwin" && preparedVersion) {
        h.relaunches.push(false);
        h.installs.push({ version: preparedVersion, path: releases.get(preparedVersion).path });
        updater.closeServerIfExists();
      } else {
        h.quitFallbacks++;
      }
    },
  });
  const settle = () => controller.download("wait").catch(() => {});
  const ready = async () => { await controller.check("startup"); await settle(); };
  return Object.assign(h, { updater, native, controller, releases, settle, ready });
};

for (const platform of ["darwin", "linux"]) {
  describe(`${platform} update target lifecycle (#776)`, () => {
    test("replaces a downloaded intermediate release and installs only the latest package", async () => {
      const h = await harness(platform);
      await h.ready();
      h.latest = "2.19.0";
      await h.controller.check("interval");
      await h.settle();
      expect(h.downloads).toEqual(["2.17.0", "2.19.0"]);
      expect(h.prepared).toEqual([]);
      expect(await h.controller.install()).toEqual({ started: true });
      expect(h.installs).toEqual([{ version: "2.19.0", path: h.releases.get("2.19.0").path }]);
    });

    test("refreshes the latest target at installation time", async () => {
      const h = await harness(platform);
      await h.ready();
      h.latest = "2.18.0";
      expect(await h.controller.install()).toEqual({ started: true });
      expect(h.installs.map((entry) => entry.version)).toEqual(["2.18.0"]);
    });

    test("normal quit refreshes the target and installs without relaunching", async () => {
      const h = await harness(platform);
      await h.ready();
      h.latest = "2.19.0";
      expect(h.controller.handleBeforeQuit({ preventDefault() {} })).toBe(true);
      await h.controller.install();
      expect(h.installs.map((entry) => entry.version)).toEqual(["2.19.0"]);
      expect(h.relaunches).toEqual([false]);
      expect(h.notices).toEqual(["2.17.0"]);
      expect(h.controller.handleBeforeQuit({ preventDefault() { throw new Error("quit loop"); } })).toBe(false);
    });

    test("unchanged metadata does not download or prompt twice", async () => {
      const h = await harness(platform);
      await h.ready();
      await h.controller.check("manual");
      expect(h.checks).toBe(2);
      expect(h.downloads).toEqual(["2.17.0"]);
      expect(h.notices).toEqual(["2.17.0"]);
    });

    test("a stale dialog approval cannot install a replacement", async () => {
      const h = await harness(platform);
      await h.ready();
      h.latest = "2.18.0";
      expect(await h.controller.install("2.17.0")).toEqual({ started: false });
      expect(h.installs).toEqual([]);
      expect(h.prepared).toEqual([]);
      expect(await h.controller.install("2.18.0")).toEqual({ started: true });
    });

    test("does not change the target while another version is downloading", async () => {
      const h = await harness(platform);
      await h.ready();
      h.latest = "2.18.0";
      h.downloadGate = deferred();
      await h.controller.check("manual");
      h.latest = "2.19.0";
      await h.controller.check("resume");
      expect(h.checks).toBe(2);
      expect(h.updater.autoInstallOnAppQuit).toBe(false);
      h.downloadGate.resolve();
      await h.settle();
      expect(h.controller.snapshot().version).toBe("2.18.0");
    });

    for (const failure of ["check", "download", "event-version"]) {
      test(`a ${failure} failure never installs the old package`, async () => {
        const h = await harness(platform);
        await h.ready();
        h.latest = "2.18.0";
        if (failure === "check") h.checkError = new Error("offline");
        if (failure === "download") h.downloadError = new Error("download failed");
        if (failure === "event-version") h.eventVersion = "2.17.0";
        await h.controller.check("interval").catch(() => {});
        await h.settle();
        expect(await h.controller.install()).toEqual({ started: false });
        expect(h.installs).toEqual([]);
        expect(h.updater.autoInstallOnAppQuit).toBe(false);
      });
    }
  });
}

describe("macOS native installation", () => {
  test("never stages intermediate background downloads in Squirrel", async () => {
    const h = await harness("darwin");
    await h.ready();
    h.latest = "2.18.0";
    await h.controller.check("interval");
    await h.settle();
    expect(h.prepared).toEqual([]);
    expect(h.updater.squirrelDownloadedUpdate).toBe(false);
    // Even stale bookkeeping must not shortcut preparation of the current ZIP.
    h.updater.squirrelDownloadedUpdate = true;
    expect(await h.controller.install()).toEqual({ started: true });
    expect(h.prepared).toEqual(["2.18.0"]);
    expect(h.installs.map((entry) => entry.version)).toEqual(["2.18.0"]);
  });

  test("normal quit refreshes and prepares the latest version before installation", async () => {
    const h = await harness("darwin");
    await h.ready();
    h.latest = "2.19.0";
    let prevented = false;
    expect(h.controller.handleBeforeQuit({ preventDefault() { prevented = true; } })).toBe(true);
    expect(prevented).toBe(true);
    await h.controller.install();
    expect(h.prepared).toEqual(["2.19.0"]);
    expect(h.installs.map((entry) => entry.version)).toEqual(["2.19.0"]);
    expect(h.quitFallbacks).toBe(0);
    expect(h.controller.handleBeforeQuit({ preventDefault() { throw new Error("blocked final quit"); } })).toBe(false);
  });

  test("native signature failure does not install or retain an installation listener", async () => {
    const h = await harness("darwin");
    await h.ready();
    h.nativeError = new Error("native code signature rejected");
    expect(await h.controller.install()).toEqual({ started: false });
    expect(h.installs).toEqual([]);
    expect(h.native.listenerCount("update-downloaded")).toBe(1); // MacUpdater bookkeeping only.
    expect(h.errors[0].stage).toBe("install");
    h.nativeError = null;
    h.latest = "2.19.0";
    await expect(h.controller.check("interval")).rejects.toThrow("Restart EdgeEver");
    h.native.emit("update-downloaded"); // Late completion cannot authorize another target.
    expect(h.installs).toEqual([]);
    expect(h.downloads).toEqual(["2.17.0"]);
  });

  test("a failed check while quitting exits without staging an older package", async () => {
    const h = await harness("darwin");
    await h.ready();
    h.checkError = new Error("offline");
    h.controller.handleBeforeQuit({ preventDefault() {} });
    await h.controller.install();
    expect(h.quitFallbacks).toBe(1);
    expect(h.prepared).toEqual([]);
    expect(h.installs).toEqual([]);
    expect(h.controller.handleBeforeQuit({ preventDefault() { throw new Error("quit loop"); } })).toBe(false);
  });

  test("quit waits for ongoing native preparation and does not start a second install", async () => {
    const h = await harness("darwin");
    await h.ready();
    h.nativeGate = deferred();
    const install = h.controller.install();
    await flush();
    expect(h.controller.handleBeforeQuit({ preventDefault() {} })).toBe(true);
    expect(h.installs).toEqual([]);
    h.nativeGate.resolve();
    await install;
    expect(h.prepared).toEqual(["2.17.0"]);
    expect(h.installs).toHaveLength(1);
  });

  test("a changed native feed cannot complete preparation of another target", async () => {
    const native = new EventEmitter();
    let feed = "http://127.0.0.1:1/";
    native.getFeedURL = () => feed;
    native.checkForUpdates = () => {
      feed = "http://127.0.0.1:2/";
      native.emit("update-downloaded");
    };
    await expect(prepareMacUpdate(native)).rejects.toThrow("feed changed");
    expect(native.listenerCount("update-downloaded")).toBe(0);
    expect(native.listenerCount("error")).toBe(0);
  });

  test("native update-not-available fails immediately and removes temporary listeners", async () => {
    const native = new EventEmitter();
    native.getFeedURL = () => "http://127.0.0.1:1/";
    native.checkForUpdates = () => native.emit("update-not-available");
    await expect(prepareMacUpdate(native)).rejects.toThrow("not available");
    expect(native.listenerCount("update-downloaded")).toBe(0);
    expect(native.listenerCount("error")).toBe(0);
    expect(native.listenerCount("update-not-available")).toBe(0);
  });

  test("native timeout removes temporary listeners", async () => {
    const native = new EventEmitter();
    native.getFeedURL = () => "http://127.0.0.1:1/";
    native.checkForUpdates = () => {};
    await expect(prepareMacUpdate(native, { timeoutMs: 1 })).rejects.toThrow("timed out");
    expect(native.listenerCount("update-downloaded")).toBe(0);
    expect(native.listenerCount("error")).toBe(0);
  });
});
