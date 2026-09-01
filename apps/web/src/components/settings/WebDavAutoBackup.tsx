import { useEffect } from "react";
import { api } from "@/lib/api";
import { createEdgeEverZipTemporaryFile } from "@/lib/json-backup";
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
        const temporary = await createEdgeEverZipTemporaryFile(
          { listNotebooks: api.listNotebooks, listPrompts: api.listAiPrompts, getPage: api.getJsonBackupPage, getResourceResponse: api.getResourceResponse },
          { edgeeverVersion: __EDGEEVER_APP_VERSION__, buildId: __EDGEEVER_BUILD_ID__ }
        );
        await uploadWebDavBackup(config, password, temporary.file).finally(temporary.cleanup);
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
