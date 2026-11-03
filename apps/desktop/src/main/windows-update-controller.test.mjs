import { createRequire } from "node:module";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createDesktopUpdateController } from "./desktop-update-controller.mjs";
import { WINDOWS_UPDATE_KEY_ID, verifyWindowsUpdateMetadata, verifyDownloadedWindowsUpdate } from "./windows-update-trust.mjs";

// Exercise the installed electron-updater's real check, download promise and
// quit-handler behavior. Replace only network/package acquisition and process
// spawning; no Electron app or Windows installer is launched by these tests.
const require = createRequire(new URL("../../package.json", import.meta.url));
const { BaseUpdater } = require("electron-updater/out/BaseUpdater.js");

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const harness = async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-update-target-"));
  directories.push(directory);
  const keys = generateKeyPairSync("ed25519");
  const releases = new Map();
  for (const version of ["2.17.0", "2.18.0", "2.19.0"]) {
    const bytes = Buffer.from(`installer ${version}`);
    const name = `EdgeEver-${version}-windows-x64.exe`;
    const path = join(directory, name);
    await writeFile(path, bytes);
    const manifest = {
      schemaVersion: 1, keyId: WINDOWS_UPDATE_KEY_ID, version, platform: "win32", arch: "x64",
      releaseDate: "2026-11-03T00:00:00.000Z",
      file: {
        name, size: bytes.length,
        sha512: createHash("sha512").update(bytes).digest("base64"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    };
    const info = { version, files: [{ url: name, size: bytes.length, sha512: manifest.file.sha512 }] };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const signatureBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, keyId: WINDOWS_UPDATE_KEY_ID,
      signature: sign(null, manifestBytes, keys.privateKey).toString("base64") }));
    releases.set(version, { path, info, manifest, manifestBytes, signatureBytes });
  }
  const h = { latest: "2.17.0", checks: 0, downloads: [], installs: [], errors: [], notices: [], statuses: [],
    checkGate: null, metadataGate: null, downloadGate: null, hashGate: null,
    checkError: null, metadataError: null, downloadError: null, eventVersion: null, packagePath: null,
    corruptSignature: false, corruptMetadata: false };
  const updater = new BaseUpdater(null, {
    version: "2.16.1", isPackaged: true,
    onQuit: (handler) => { h.quitHandler = handler; },
  });
  updater.logger = null;
  updater.getUpdateInfoAndProvider = async () => {
    h.checks++;
    if (h.checkGate) await h.checkGate.promise;
    if (h.checkError) throw h.checkError;
    if (!h.latest) return { info: { version: "2.16.1" }, provider: {} };
    const info = structuredClone(releases.get(h.latest).info);
    if (h.corruptMetadata) info.files[0].sha512 = "invalid";
    updater.selected = info;
    return { info, provider: {} };
  };
  updater.doDownloadUpdate = async () => {
    const version = updater.selected.version;
    h.downloads.push(version);
    if (h.downloadGate) await h.downloadGate.promise;
    if (h.downloadError) throw h.downloadError;
    updater.downloadedUpdateHelper = {
      file: h.packagePath || releases.get(version).path,
      downloadedFileInfo: { isAdminRightsRequired: false },
    };
    updater.dispatchUpdateDownloaded({ version: h.eventVersion || version, downloadedFile: updater.installerPath });
    updater.addQuitHandler();
    return [updater.installerPath];
  };
  updater.doInstall = ({ isSilent, isForceRunAfter }) => {
    h.installs.push({ version: updater.selected.version, path: updater.installerPath, silent: isSilent, forceRun: isForceRunAfter });
    return true;
  };
  updater.quitAndInstall = (silent, forceRun) => updater.install(silent, forceRun);
  const controller = createDesktopUpdateController({
    updater, platform: "win32",
    fetchWindowsMetadata: async ({ version, updateInfo }) => {
      if (h.metadataGate) await h.metadataGate.promise;
      if (h.metadataError) throw h.metadataError;
      const release = releases.get(version);
      return verifyWindowsUpdateMetadata({ ...release, expectedVersion: version, updateInfo,
        signatureBytes: h.corruptSignature ? Buffer.from(JSON.stringify({
          schemaVersion: 1, keyId: WINDOWS_UPDATE_KEY_ID, signature: Buffer.alloc(64).toString("base64"),
        })) : release.signatureBytes,
        trustedPublicKeys: { [WINDOWS_UPDATE_KEY_ID]: keys.publicKey } });
    },
    verifyWindowsPackage: async (options) => {
      if (h.hashGate) await h.hashGate.promise;
      await verifyDownloadedWindowsUpdate(options);
    },
    onStatus: (status) => h.statuses.push(status),
    onError: (error, stage) => h.errors.push({ error, stage }),
    onDownloaded: (version) => h.notices.push(version),
    beforeInstall: () => {},
  });
  // Await the download and hash work without timers or polling the filesystem.
  const settle = async () => { await controller.download("test-wait").catch(() => {}); await flush(); };
  const ready = async () => { await controller.check("startup"); await settle(); };
  return Object.assign(h, { updater, controller, releases, settle, ready });
};

describe("desktop update target lifecycle (#776)", () => {
  test("replaces a downloaded intermediate version with the newest release", async () => {
    const h = await harness();
    await h.ready();
    h.latest = "2.19.0";
    await h.controller.check("interval");
    await h.settle();
    expect(h.downloads).toEqual(["2.17.0", "2.19.0"]);
    expect(h.controller.snapshot().version).toBe("2.19.0");
    expect(await h.controller.install()).toEqual({ started: true });
    expect(h.installs).toEqual([{ version: "2.19.0", path: h.releases.get("2.19.0").path, silent: true, forceRun: true }]);
  });

  test("checks again at installation time and installs the latest directly", async () => {
    const h = await harness();
    await h.ready();
    h.latest = "2.18.0";
    expect(await h.controller.install()).toEqual({ started: true });
    expect(h.downloads).toEqual(["2.17.0", "2.18.0"]);
    expect(h.installs.map((entry) => entry.version)).toEqual(["2.18.0"]);
  });

  test("normal Windows quit refreshes the installer and does not relaunch", async () => {
    const h = await harness();
    await h.ready();
    h.latest = "2.19.0";
    expect(h.controller.handleBeforeQuit({ preventDefault() {} })).toBe(true);
    await h.controller.install();
    expect(h.installs).toEqual([{ version: "2.19.0", path: h.releases.get("2.19.0").path, silent: true, forceRun: false }]);
    expect(h.notices).toEqual(["2.17.0"]);
  });

  test("an unchanged release does not download or prompt again", async () => {
    const h = await harness();
    await h.ready();
    await h.controller.check("manual");
    expect(h.checks).toBe(2);
    expect(h.downloads).toEqual(["2.17.0"]);
    expect(h.notices).toEqual(["2.17.0"]);
    expect(h.updater.autoInstallOnAppQuit).toBe(true);
  });

  test("an old native dialog cannot approve installing a replacement version", async () => {
    const h = await harness();
    await h.ready();
    h.latest = "2.18.0";
    expect(await h.controller.install("2.17.0")).toEqual({ started: false });
    expect(h.installs).toEqual([]);
    expect(h.notices).toEqual(["2.17.0", "2.18.0"]);
    expect(await h.controller.install("2.18.0")).toEqual({ started: true });
  });

  test("blocks quit installation during a check and coalesces manual installation requests", async () => {
    const h = await harness();
    await h.ready();
    h.checkGate = deferred();
    const check = h.controller.check("interval");
    expect(h.updater.autoInstallOnAppQuit).toBe(false);
    const first = h.controller.install();
    const second = h.controller.install();
    expect(first).toBe(second);
    await flush();
    expect(h.installs).toEqual([]);
    h.checkGate.resolve();
    await check;
    await first;
    expect(h.checks).toBe(2);
    expect(h.installs).toHaveLength(1);
  });

  test("serializes checks and installation around asynchronous Windows hashing", async () => {
    const h = await harness();
    await h.ready();
    h.latest = "2.18.0";
    h.hashGate = deferred();
    await h.controller.check("manual");
    await flush();
    h.latest = "2.19.0";
    await h.controller.check("resume");
    expect(h.checks).toBe(2);
    expect(h.updater.autoInstallOnAppQuit).toBe(false);
    h.quitHandler(0);
    expect(h.installs).toEqual([]);
    expect(await h.controller.install()).toEqual({ started: false });
    h.hashGate.resolve();
    await h.settle();
    expect(h.controller.snapshot()).toMatchObject({ state: "downloaded", version: "2.18.0" });
    expect(h.updater.autoInstallOnAppQuit).toBe(true);
  });

  for (const failure of ["check", "metadata", "download", "signature", "metadata-digest", "package-digest", "event-version"]) {
    test(`a replacement ${failure} failure never installs the old or unverified package`, async () => {
      const h = await harness();
      await h.ready();
      h.latest = "2.18.0";
      if (failure === "check") h.checkError = new Error("offline");
      if (failure === "metadata") h.metadataError = new Error("metadata unavailable");
      if (failure === "download") h.downloadError = new Error("download failed");
      if (failure === "signature") h.corruptSignature = true;
      if (failure === "metadata-digest") h.corruptMetadata = true;
      if (failure === "package-digest") await writeFile(h.releases.get(h.latest).path, "tampered! 2.18.0");
      if (failure === "event-version") h.eventVersion = "2.17.0";
      await h.controller.check("interval").catch(() => {});
      await h.settle();
      expect(await h.controller.install()).toEqual({ started: false });
      expect(h.updater.autoInstallOnAppQuit).toBe(false);
      expect(h.installs).toEqual([]);
      expect(h.errors.length).toBeGreaterThan(0);
      expect(h.controller.snapshot().state).toBe("idle");
    });
  }

  test("does not download a replacement until its signature gate completes", async () => {
    const h = await harness();
    await h.ready();
    h.latest = "2.18.0";
    h.metadataGate = deferred();
    const check = h.controller.check("manual");
    expect(h.controller.check("resume")).toBe(check);
    await flush();
    expect(h.downloads).toEqual(["2.17.0"]);
    expect(h.updater.autoInstallOnAppQuit).toBe(false);
    expect(await h.controller.install()).toEqual({ started: false });
    h.metadataGate.resolve();
    await check;
    await h.settle();
    expect(h.downloads).toEqual(["2.17.0", "2.18.0"]);
  });

  test("does not replace the updater target during a pending download", async () => {
    const h = await harness();
    await h.ready();
    h.latest = "2.18.0";
    h.downloadGate = deferred();
    await h.controller.check("manual");
    h.latest = "2.19.0";
    await h.controller.check("resume");
    expect(h.checks).toBe(2);
    expect(h.updater.selected.version).toBe("2.18.0");
    expect(h.updater.autoInstallOnAppQuit).toBe(false);
    h.downloadGate.resolve();
    await h.settle();
    expect(h.controller.snapshot().version).toBe("2.18.0");
  });

  test("a changed digest at the same version cannot reuse the old verified target", async () => {
    const h = await harness();
    await h.ready();
    h.corruptMetadata = true;
    await expect(h.controller.check("interval")).rejects.toThrow("does not match the signed manifest");
    expect(h.updater.autoInstallOnAppQuit).toBe(false);
    expect(await h.controller.install()).toEqual({ started: false });
    expect(h.installs).toEqual([]);
  });

  test("a withdrawn release revokes installation of the downloaded package", async () => {
    const h = await harness();
    await h.ready();
    h.latest = null;
    await h.controller.check("interval");
    expect(h.controller.snapshot().state).toBe("idle");
    expect(h.updater.autoInstallOnAppQuit).toBe(false);
    expect(await h.controller.install()).toEqual({ started: false });
  });

  test("registers the real updater quit hook only after hashing and revokes it during replacement", async () => {
    const h = await harness();
    h.hashGate = deferred();
    await h.controller.check("startup");
    await flush();
    expect(h.quitHandler).toBeUndefined();
    expect(h.updater.autoInstallOnAppQuit).toBe(false);
    h.hashGate.resolve();
    await h.settle();
    expect(typeof h.quitHandler).toBe("function");
    h.latest = "2.18.0";
    h.metadataGate = deferred();
    const check = h.controller.check("interval");
    h.quitHandler(0);
    expect(h.installs).toEqual([]);
    h.metadataGate.resolve();
    await check;
    await h.settle();
    h.quitHandler(0);
    expect(h.installs).toEqual([{ version: "2.18.0", path: h.releases.get("2.18.0").path, silent: true, forceRun: false }]);
  });

  test("a failed check can recover and reauthorize a verified cached package", async () => {
    const h = await harness();
    await h.ready();
    h.checkError = new Error("offline");
    await expect(h.controller.check("interval")).rejects.toThrow("offline");
    expect(h.updater.autoInstallOnAppQuit).toBe(false);
    h.checkError = null;
    await h.ready();
    expect(h.controller.snapshot().state).toBe("downloaded");
    expect(await h.controller.install()).toEqual({ started: true });
  });

  test("requires the installed Windows file to be the verified file", async () => {
    const h = await harness();
    await h.ready();
    h.updater.downloadedUpdateHelper.file = h.releases.get("2.18.0").path;
    h.metadataGate = deferred();
    const install = h.controller.install();
    await flush();
    expect(h.updater.autoInstallOnAppQuit).toBe(false);
    expect(h.installs).toEqual([]);
    h.metadataError = new Error("cannot authorize replacement");
    h.metadataGate.resolve();
    expect(await install).toEqual({ started: false });
  });

});
