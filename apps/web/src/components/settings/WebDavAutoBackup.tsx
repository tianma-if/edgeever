import { useEffect } from "react";
import { api } from "@/lib/api";
import { createEdgeEverZip } from "@/lib/json-backup";
import {
  isWebDavBackupDue,
  loadWebDavBackupConfig,
  loadWebDavBackupPassword,
  loadWebDavBackupSchedule,
  saveWebDavBackupSchedule,
  uploadWebDavBackup,
  WEBDAV_AUTO_BACKUP_ENABLED,
} from "@/lib/webdav-backup";

const AUTO_BACKUP_CHECK_INTERVAL_MS = 60_000;

export const WebDavAutoBackup = () => {
  useEffect(() => {
    if (!WEBDAV_AUTO_BACKUP_ENABLED) return;
    let running = false;

    const runIfDue = async () => {
      if (running) return;
      const schedule = loadWebDavBackupSchedule();
      if (!isWebDavBackupDue(schedule)) return;

      const config = loadWebDavBackupConfig();
      const password = loadWebDavBackupPassword();
      if (!config.url || !config.username || !password) return;

      running = true;
      const attemptAt = new Date().toISOString();
      saveWebDavBackupSchedule({ ...schedule, lastAttemptAt: attemptAt });
      try {
        const archive = await createEdgeEverZip(
          { listNotebooks: api.listNotebooks, getPage: api.getJsonBackupPage, getResourceBlob: api.getResourceBlob },
          { edgeeverVersion: __EDGEEVER_APP_VERSION__, buildId: __EDGEEVER_BUILD_ID__ }
        );
        await uploadWebDavBackup(config, password, archive);
        saveWebDavBackupSchedule({ ...schedule, lastAttemptAt: attemptAt, lastSuccessAt: new Date().toISOString() });
      } catch (error) {
        console.error("Automatic WebDAV backup failed", error);
      } finally {
        running = false;
      }
    };

    void runIfDue();
    const timer = window.setInterval(() => void runIfDue(), AUTO_BACKUP_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return null;
};
