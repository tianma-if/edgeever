import { isDeepStrictEqual } from "node:util";

// electron-updater owns one mutable download/install target. Keep checks,
// downloads and package verification serialized around that target.
export const createWindowsUpdateController = ({
  updater, fetchWindowsMetadata, verifyWindowsPackage,
  onStatus, onError, onDownloaded, beforeInstall,
  onStage = () => {}, onCheckStarted = () => {}, onSettled = () => {},
  log = () => {},
}) => {
  let status = { state: "idle", version: null, progress: null };
  let target = null;
  let ready = null;
  let checkInFlight = null;
  let downloadInFlight = null;
  let verificationInFlight = null;
  let installInFlight = null;
  let installing = false;
  const publish = (next) => { status = { ...status, ...next }; onStatus({ ...status }); };
  const packageMatches = (candidate) => Boolean(candidate && (
    candidate.manifest?.version === candidate.info.version &&
    candidate.path && updater.installerPath === candidate.path
  ));
  const refreshQuitInstall = () => {
    updater.autoInstallOnAppQuit = !checkInFlight && !downloadInFlight &&
      !verificationInFlight && ready === target && packageMatches(ready);
    if (updater.autoInstallOnAppQuit) {
      // BaseUpdater normally registers this during update-downloaded, before
      // our async hash verification completes. Register only after trust is
      // established; its quit callback reads autoInstallOnAppQuit again.
      updater.addQuitHandler();
    }
  };
  const invalidate = () => {
    updater.autoInstallOnAppQuit = false;
    ready = null;
    target = null;
  };
  const fail = (error, stage) => {
    invalidate();
    publish({ state: "idle", version: null, progress: null });
    onError(error, stage);
  };

  // Downloads are still automatic, but start only after metadata selection
  // (and Windows signature verification), never inside checkForUpdates().
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  updater.on("download-progress", (progress) => {
    if (downloadInFlight) {
      publish({ progress });
      log("update.download-progress", { percent: progress.percent });
    }
  });
  updater.on("error", (error) => {
    // check/download promises report their own errors with the correct stage.
    if (!checkInFlight && !downloadInFlight) {
      installing = false;
      fail(error, "install");
    }
  });
  updater.on("update-downloaded", (info) => {
    const candidate = target;
    if (!downloadInFlight || verificationInFlight) {
      fail(new Error("Unexpected update download completion"), "verify-windows-package");
      return;
    }
    verificationInFlight = Promise.resolve().then(async () => {
      if (!candidate || candidate.info.version !== info?.version) {
        throw new Error("Downloaded update does not match the selected target");
      }
      onStage("verify-windows-package");
      if (!candidate.manifest || candidate.manifest.version !== info.version ||
          !info.downloadedFile || updater.installerPath !== info.downloadedFile) {
        throw new Error("Downloaded Windows update has no matching trusted installer");
      }
      await verifyWindowsPackage({ path: info.downloadedFile, manifest: candidate.manifest });
      if (target !== candidate) throw new Error("Update target changed during package verification");
      candidate.path = info.downloadedFile;
      candidate.verified = true;
    });
    // The event may precede downloadUpdate()'s promise settlement.
    void verificationInFlight.catch(() => {});
  });

  const download = (reason) => {
    if (downloadInFlight) return downloadInFlight;
    const candidate = target;
    if (!candidate || !candidate.manifest) {
      return Promise.reject(new Error("Update metadata has not passed the signature gate"));
    }
    if (ready === candidate && packageMatches(ready)) return Promise.resolve();
    updater.autoInstallOnAppQuit = false;
    downloadInFlight = Promise.resolve().then(async () => {
      onStage("download");
      await updater.downloadUpdate();
      await verificationInFlight;
      if (target !== candidate || !candidate.verified || !packageMatches(candidate)) {
        throw new Error("Downloaded package does not match the selected update target");
      }
      ready = candidate;
      publish({ state: "downloaded", version: candidate.info.version, progress: null });
      log("update.downloaded", { version: candidate.info.version });
    }).catch((error) => {
      fail(error, verificationInFlight ? "verify-windows-package" : "download");
      log(verificationInFlight ? "update.windows-package-blocked" : "update.download-failed", {
        reason, message: error.message,
      });
    }).finally(() => {
      downloadInFlight = null;
      verificationInFlight = null;
      refreshQuitInstall();
      if (!checkInFlight) onSettled();
      if (ready === candidate) onDownloaded(candidate.info.version);
    });
    return downloadInFlight;
  };

  const check = (reason) => {
    if (installing) return Promise.resolve(null);
    if (checkInFlight) return checkInFlight;
    // In particular, do not change updater.updateInfoAndProvider while a
    // Windows package is still being hashed after its download has finished.
    if (downloadInFlight) return Promise.resolve(null);
    updater.autoInstallOnAppQuit = false;
    let stage = "check";
    checkInFlight = Promise.resolve().then(async () => {
      onCheckStarted(reason);
      const result = await updater.checkForUpdates();
      if (!result?.isUpdateAvailable) {
        invalidate();
        publish({ state: "idle", version: null, progress: null });
        log("update.not-available");
        return result;
      }
      const info = result.updateInfo;
      if (ready && isDeepStrictEqual(ready.info, info) && packageMatches(ready)) {
        publish({ state: "downloaded", version: ready.info.version, progress: null });
        return result;
      }
      // Revoke installation of the previous package before awaiting trust of
      // a replacement. A failed replacement must never install the old file.
      invalidate();
      target = { info, manifest: null, path: null, verified: false };
      publish({ state: "available", version: info.version, progress: null });
      log("update.available", { version: info.version });
      stage = "verify-windows-metadata";
      onStage(stage);
      target.manifest = await fetchWindowsMetadata({ version: info.version, updateInfo: info });
      if (target.manifest.version !== info.version) throw new Error("Windows manifest target mismatch");
      log("update.windows-manifest-verified", { version: info.version, keyId: target.manifest.keyId });
      void download(reason);
      return result;
    }).catch((error) => {
      // A failed check leaves the old package on disk, but does not authorize
      // installation without a successful check and (on Windows) verification.
      fail(error, stage);
      log("update.check-failed", { reason, message: error.message });
      throw error;
    }).finally(() => {
      checkInFlight = null;
      refreshQuitInstall();
      if (!downloadInFlight) onSettled();
    });
    return checkInFlight;
  };

  const install = (expectedVersion) => {
    if (installInFlight) return installInFlight;
    if (!ready || installing) return Promise.resolve({ started: false });
    installInFlight = Promise.resolve().then(async () => {
      await check("before-install");
      if (downloadInFlight) await downloadInFlight;
      if (!ready || ready !== target || !ready.verified || !packageMatches(ready) ||
          checkInFlight || downloadInFlight || verificationInFlight ||
          (expectedVersion && expectedVersion !== ready.info.version)) {
        return { started: false };
      }
      installing = true;
      log("update.install-confirmed", { version: ready.info.version });
      beforeInstall();
      updater.quitAndInstall(true, true);
      return { started: true };
    }).catch((error) => {
      installing = false;
      if (status.state !== "idle") fail(error, "install");
      return { started: false };
    }).finally(() => { installInFlight = null; });
    return installInFlight;
  };

  return { check, download, install, snapshot: () => ({ ...status }) };
};
