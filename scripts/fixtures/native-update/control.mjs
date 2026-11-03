// Copied into instrumented CI builds only. Never included in release source.
import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { verifyWindowsUpdateMetadata, WINDOWS_UPDATE_KEY_ID } from "./windows-update-trust.mjs";

export const verifierLog = (event, details = {}) => {
  appendFileSync(process.env.EDGE_EVER_UPDATE_VERIFIER_LOG, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`);
};
export const verifierWindowsMetadata = async ({ version, updateInfo }) => {
  const base = `${process.env.EDGE_EVER_UPDATE_VERIFIER_FEED}/release/${version}/`;
  const [manifest, signature] = await Promise.all([
    fetch(`${base}latest-windows.json`), fetch(`${base}latest-windows.json.sig`),
  ]);
  if (!manifest.ok || !signature.ok) throw new Error("Verification metadata request failed");
  return verifyWindowsUpdateMetadata({
    manifestBytes: Buffer.from(await manifest.arrayBuffer()),
    signatureBytes: Buffer.from(await signature.arrayBuffer()),
    expectedVersion: version, updateInfo,
    trustedPublicKeys: { [WINDOWS_UPDATE_KEY_ID]: readFileSync(process.env.EDGE_EVER_UPDATE_VERIFIER_PUBLIC_KEY, "utf8") },
  });
};
export const attachVerifier = ({ app, updater, controller }) => {
  verifierLog("boot", { version: app.getVersion(), executable: process.execPath, pid: process.pid });
  let busy = false;
  const path = process.env.EDGE_EVER_UPDATE_VERIFIER_COMMAND;
  const timer = setInterval(async () => {
    if (busy || !existsSync(path)) return;
    busy = true;
    let command;
    try {
      command = JSON.parse(readFileSync(path, "utf8"));
      unlinkSync(path);
      if (command.action === "check") {
        await controller.check("verification");
        if (controller.snapshot().state === "available") await controller.download("verification");
      } else if (command.action === "install") {
        await controller.install();
      } else if (command.action === "quit") {
        app.quit();
      } else if (command.action === "stop") {
        updater.autoInstallOnAppQuit = false;
        // Stop only this fixture and its children. No installed user app is used.
        app.exit(0);
      } else throw new Error("Unknown verifier command");
      verifierLog("command", { id: command.id, status: controller.snapshot() });
    } catch (error) {
      verifierLog("command-error", { id: command?.id, message: error.message, status: controller.snapshot() });
    } finally { busy = false; }
  }, 100);
  timer.unref();
};
