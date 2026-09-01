import { AuthType, createClient } from "webdav";

// Keep automatic scheduling disabled in the web client until the native desktop client is released.
export const WEBDAV_AUTO_BACKUP_ENABLED = false;

export type WebDavBackupConfig = {
  url: string;
  username: string;
  remotePath: string;
};

export type WebDavBackupIntervalDays = 1 | 7 | 14 | 30;

export type WebDavBackupSchedule = {
  enabled: boolean;
  intervalDays: WebDavBackupIntervalDays;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
};

const STORAGE_KEY = "edgeever.webdav-backup-config";
const PASSWORD_STORAGE_KEY = "edgeever.webdav-backup-password";
const SCHEDULE_STORAGE_KEY = "edgeever.webdav-backup-schedule";

export const DEFAULT_WEBDAV_BACKUP_CONFIG: WebDavBackupConfig = {
  url: "",
  username: "",
  remotePath: "/EdgeEver/backups",
};

export const DEFAULT_WEBDAV_BACKUP_SCHEDULE: WebDavBackupSchedule = {
  enabled: false,
  intervalDays: 7,
  lastSuccessAt: null,
  lastAttemptAt: null,
};

const normalizeRemotePath = (value: string) => {
  const trimmed = value.trim().replace(/^\\+/, "/").replace(/\\/g, "/");
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
};

export const normalizeWebDavBackupConfig = (config: WebDavBackupConfig): WebDavBackupConfig => ({
  url: config.url.trim().replace(/\/+$/, ""),
  username: config.username.trim(),
  remotePath: normalizeRemotePath(config.remotePath),
});

export const loadWebDavBackupConfig = (): WebDavBackupConfig => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_WEBDAV_BACKUP_CONFIG;
    const parsed = JSON.parse(stored) as Partial<WebDavBackupConfig>;
    return normalizeWebDavBackupConfig({ ...DEFAULT_WEBDAV_BACKUP_CONFIG, ...parsed });
  } catch {
    return DEFAULT_WEBDAV_BACKUP_CONFIG;
  }
};

export const saveWebDavBackupConfig = (config: WebDavBackupConfig) => {
  const normalized = normalizeWebDavBackupConfig(config);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
};

export const loadWebDavBackupPassword = () => {
  try {
    if (!WEBDAV_AUTO_BACKUP_ENABLED) {
      window.localStorage.removeItem(PASSWORD_STORAGE_KEY);
      return "";
    }
    return window.localStorage.getItem(PASSWORD_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

export const saveWebDavBackupPassword = (password: string) => {
  window.localStorage.setItem(PASSWORD_STORAGE_KEY, password);
};

export const loadWebDavBackupSchedule = (): WebDavBackupSchedule => {
  try {
    const stored = window.localStorage.getItem(SCHEDULE_STORAGE_KEY);
    if (!stored) return DEFAULT_WEBDAV_BACKUP_SCHEDULE;
    const parsed = JSON.parse(stored) as Partial<WebDavBackupSchedule>;
    const intervalDays = [1, 7, 14, 30].includes(Number(parsed.intervalDays))
      ? Number(parsed.intervalDays) as WebDavBackupIntervalDays
      : DEFAULT_WEBDAV_BACKUP_SCHEDULE.intervalDays;
    return {
      enabled: parsed.enabled === true,
      intervalDays,
      lastSuccessAt: typeof parsed.lastSuccessAt === "string" ? parsed.lastSuccessAt : null,
      lastAttemptAt: typeof parsed.lastAttemptAt === "string" ? parsed.lastAttemptAt : null,
    };
  } catch {
    return DEFAULT_WEBDAV_BACKUP_SCHEDULE;
  }
};

export const saveWebDavBackupSchedule = (schedule: WebDavBackupSchedule) => {
  window.localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(schedule));
  return schedule;
};

export const isWebDavBackupDue = (schedule: WebDavBackupSchedule, now = Date.now()) => {
  if (!schedule.enabled) return false;
  const lastRunAt = schedule.lastAttemptAt ?? schedule.lastSuccessAt;
  if (!lastRunAt) return true;
  const lastRunTimestamp = Date.parse(lastRunAt);
  if (!Number.isFinite(lastRunTimestamp)) return true;
  return now - lastRunTimestamp >= schedule.intervalDays * 24 * 60 * 60 * 1000;
};

const createWebDavClient = (config: WebDavBackupConfig, password: string) => {
  const normalized = normalizeWebDavBackupConfig(config);
  if (!/^https?:\/\//i.test(normalized.url)) {
    throw new Error("WebDAV URL must start with http:// or https://.");
  }
  if (!password) {
    throw new Error("WebDAV password is required.");
  }

  return createClient(normalized.url, {
    authType: AuthType.Password,
    username: normalized.username,
    password,
  });
};

export const testWebDavConnection = async (config: WebDavBackupConfig, password: string) => {
  const normalized = normalizeWebDavBackupConfig(config);
  const client = createWebDavClient(normalized, password);
  await client.getDirectoryContents(normalized.remotePath);
};

export const uploadWebDavBackup = async (
  config: WebDavBackupConfig,
  password: string,
  archive: Blob,
  timestamp = new Date()
) => {
  const normalized = normalizeWebDavBackupConfig(config);
  const client = createWebDavClient(normalized, password);
  await client.createDirectory(normalized.remotePath, { recursive: true });

  const filename = `edgeever-${timestamp.toISOString().replace(/[:.]/g, "-")}.zip`;
  const remotePath = `${normalized.remotePath}/${filename}`;
  // The fetch-backed browser client accepts Blob/File bodies even though its
  // published TypeScript signature only lists ArrayBuffer-like payloads.
  const uploaded = await client.putFileContents(remotePath, archive as never, {
    contentLength: archive.size,
    overwrite: false,
  });

  if (!uploaded) {
    throw new Error("The WebDAV server rejected the backup upload.");
  }

  return { filename, remotePath, size: archive.size };
};
