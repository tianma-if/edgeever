// Keep Squirrel out of background downloads. Its staged update can otherwise
// survive a later ZIP download and be installed instead of the selected target.
// Only prepare the current loopback feed once the controller has frozen it.
export const prepareMacUpdate = (nativeUpdater, { timeoutMs = 120_000 } = {}) => new Promise((resolve, reject) => {
  const feed = nativeUpdater.getFeedURL();
  let timer;
  const cleanup = () => {
    clearTimeout(timer);
    nativeUpdater.removeListener("update-downloaded", downloaded);
    nativeUpdater.removeListener("error", failed);
    nativeUpdater.removeListener("update-not-available", unavailable);
  };
  const failed = (error) => { cleanup(); reject(error); };
  const unavailable = () => failed(new Error("Native macOS update is not available for the selected package"));
  const downloaded = () => {
    cleanup();
    if (nativeUpdater.getFeedURL() !== feed) {
      reject(new Error("Native macOS update feed changed during preparation"));
    } else {
      resolve();
    }
  };
  nativeUpdater.once("update-downloaded", downloaded);
  nativeUpdater.once("error", failed);
  nativeUpdater.once("update-not-available", unavailable);
  timer = setTimeout(() => failed(new Error("Native macOS update preparation timed out")), timeoutMs);
  try { nativeUpdater.checkForUpdates(); } catch (error) { failed(error); }
});
