import { useEffect, useState } from "react";
import type { DesktopBackupStatus, DesktopBackupError, DesktopBackupConfig, DesktopOffsiteConfig } from "@edgeever/shared";
import type { TFunction } from "i18next";

const createDevMockBackupState = (): DesktopBackupStatus => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600000).toISOString();
  const nextMonth = new Date(now.getTime() + 86400000 * 30).toISOString();
  return {
    blocked: false,
    config: {
      enabled: true,
      interval: "weekly",
      retention: 5,
      directory: "~/Documents/EdgeEver Backups",
      encrypted: false,
    },
    backupSetId: "dev_workspace_preview",
    actualDirectory: "~/Documents/EdgeEver Backups/dev_workspace_preview",
    passwordSet: false,
    secureStorageAvailable: true,
    lastCheck: { at: oneHourAgo, result: "success" },
    lastAttemptAt: oneHourAgo,
    lastSuccessAt: oneHourAgo,
    lastRestoreAt: null,
    nextDueAt: nextMonth,
    pendingPublication: null,
    target: { baseUrl: "http://localhost:5173", accountId: "dev-user" },
    error: null,
    warning: null,
    importError: null,
    importWarning: null,
    history: [
      {
        name: "EdgeEver-2026-11-02_130344.zip",
        directory: "~/Documents/EdgeEver Backups/dev_workspace_preview",
        completedAt: oneHourAgo,
        size: 134680210,
        encrypted: false,
      },
      {
        name: "EdgeEver-2026-10-26_091211.zip",
        directory: "~/Documents/EdgeEver Backups/dev_workspace_preview",
        completedAt: new Date(now.getTime() - 86400000 * 7).toISOString(),
        size: 125120890,
        encrypted: false,
      },
    ],
    task: null,
    offsite: {
      config: { enabled: false, url: "", username: "", folder: "/EdgeEver/backups" },
      passwordSet: false,
      secureStorageAvailable: true,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastUploaded: null,
      error: null,
      warning: null,
      task: null,
    },
  };
};

const createDevBackupBridge = () => {
  let devStatus = createDevMockBackupState();
  const listeners = new Set<(status: DesktopBackupStatus) => void>();
  const broadcast = () => {
    listeners.forEach((listener) => listener(devStatus));
  };

  const bridge: Pick<EdgeEverDesktopBridge, "backup" | "onBackupStatus"> = {
    onBackupStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async backup(action, payload) {
      switch (action) {
        case "status":
          return devStatus as any;
        case "save": {
          const input = payload as { config: DesktopBackupConfig; password?: string };
          devStatus = {
            ...devStatus,
            config: input.config,
            passwordSet: Boolean(input.password || devStatus.passwordSet),
          };
          broadcast();
          return devStatus as any;
        }
        case "choose-directory":
          return "~/Documents/EdgeEver Backups" as any;
        case "open-folder":
          console.info("[Dev Preview] 打开备份目录:", devStatus.actualDirectory);
          return true as any;
        case "run": {
          const newName = `EdgeEver-${new Date().toISOString().slice(0, 10)}_${Date.now().toString().slice(-6)}.zip`;
          devStatus = {
            ...devStatus,
            lastSuccessAt: new Date().toISOString(),
            lastCheck: { at: new Date().toISOString(), result: "success" },
            history: [
              {
                name: newName,
                directory: devStatus.actualDirectory,
                completedAt: new Date().toISOString(),
                size: 138900120,
                encrypted: devStatus.config.encrypted,
              },
              ...devStatus.history,
            ],
          };
          broadcast();
          return devStatus as any;
        }
        case "delete-history": {
          const input = payload as { name: string };
          devStatus = {
            ...devStatus,
            history: devStatus.history.filter((item) => item.name !== input.name),
          };
          broadcast();
          return devStatus as any;
        }
        case "cancel":
          devStatus = { ...devStatus, task: null };
          broadcast();
          return devStatus as any;
        case "offsite-save": {
          const input = payload as { config: DesktopOffsiteConfig; password?: string };
          devStatus = {
            ...devStatus,
            offsite: devStatus.offsite ? {
              ...devStatus.offsite,
              config: input.config,
              passwordSet: Boolean(input.password || devStatus.offsite.passwordSet),
            } : null,
          };
          broadcast();
          return devStatus as any;
        }
        case "offsite-test":
          return { ok: true } as any;
        default:
          return devStatus as any;
      }
    },
  };

  return bridge;
};

const devBackupBridge = import.meta.env.DEV ? createDevBackupBridge() : undefined;

export const useDesktopBackup = () => {
  const [status, setStatus] = useState<DesktopBackupStatus | null>(null);
  const desktopBridge = window.edgeeverDesktop;
  const bridge = desktopBridge?.backup ? desktopBridge : devBackupBridge;
  useEffect(() => {
    if (!bridge?.backup) return;
    let active = true;
    const unsubscribe = bridge.onBackupStatus((value) => { if (active) setStatus(value); });
    void bridge.backup("status").then((value) => { if (active) setStatus(value); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  return { bridge, status };
};

const archiveErrors = new Set(["invalidZip", "missingManifest", "unsupportedFormat", "unsupportedVersion", "invalidManifest", "missingData", "invalidData", "incompleteData", "incompleteResources"]);
const cleanupErrors: Record<string, string> = { backup_cleanup_failed: "cleanupWarning", backup_staging_cleanup_failed: "stagingWarning", backup_part_cleanup_failed: "partWarning" };

export const describeDesktopBackupError = (t: TFunction, error: unknown) => {
  const value = error as DesktopBackupError;
  if (archiveErrors.has(value?.code)) return t(`dataExport.importErrors.${value.code}`);
  if (cleanupErrors[value?.code]) return t(`desktopBackup.${cleanupErrors[value.code]}`);
  const description = value?.status && value.code === "backup_request_failed" && value.message
    ? value.message
    : t(`desktopBackup.errors.${value?.code ?? "backup_failed"}`, { defaultValue: value?.message || t("desktopBackup.errors.backup_failed") });
  return value?.status ? t("desktopBackup.httpError", { message: description, status: value.status }) : description;
};
