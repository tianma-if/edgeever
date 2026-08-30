import { summarizeSyncQueue } from "@edgeever/shared";
import { api, getConfiguredDesktopApiBaseUrl } from "./api";
import { localDb } from "./local-db";
import { createLocalDataScope } from "./local-mirror";

export type ClientRuntimeDiagnostics = {
  appVersion: string | null;
  architecture: string | null;
  engine: string | null;
  operatingSystem: string | null;
};

export type ClientSyncDiagnostics = {
  conflict: number;
  error: number;
  lastSyncedAt: string | null;
  pending: number;
  syncing: number;
};

type UserAgentData = {
  architecture?: string;
  platform?: string;
  platformVersion?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{
    architecture?: string;
    platformVersion?: string;
  }>;
};

type NavigatorWithUserAgentData = Navigator & { userAgentData?: UserAgentData };

const browserEngine = (userAgent: string) => {
  const match = userAgent.match(/Edg(?:A|iOS)?\/([\d.]+)/)
    ?? userAgent.match(/(?:Chrome|CriOS)\/([\d.]+)/)
    ?? userAgent.match(/Firefox\/([\d.]+)/)
    ?? userAgent.match(/Version\/([\d.]+).*Safari\//);
  const name = /Edg(?:A|iOS)?\//.test(userAgent)
    ? "Microsoft Edge"
    : /(?:Chrome|CriOS)\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  return name ? `${name}${match?.[1] ? ` ${match[1]}` : ""}` : null;
};

const browserOperatingSystem = (userAgent: string, platform: string, platformVersion?: string) => {
  const source = `${userAgent} ${platform}`;
  if (/Windows/i.test(source)) return `Windows ${platformVersion || "10/11"}`;
  const android = userAgent.match(/Android ([\d.]+)/i);
  if (android) return `Android ${android[1]}`;
  const ios = userAgent.match(/(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/i);
  if (ios) return `iOS ${ios[1].replaceAll("_", ".")}`;
  const mac = userAgent.match(/Mac OS X ([\d_]+)/i);
  if (/Mac/i.test(source)) return `macOS ${platformVersion || mac?.[1]?.replaceAll("_", ".") || ""}`.trim();
  if (/Linux/i.test(source)) return "Linux";
  return null;
};

const desktopOperatingSystem = (platform: string, version: string) => {
  const name = platform === "darwin"
    ? "macOS"
    : platform === "win32"
      ? "Windows"
      : platform === "linux"
        ? "Linux"
        : platform;
  return `${name} ${version === "unknown" ? "" : version}`.trim();
};

export const getClientRuntimeDiagnostics = async (): Promise<ClientRuntimeDiagnostics> => {
  const bridge = window.edgeeverDesktop;
  if (bridge?.isAvailable) {
    const info = await bridge.systemInfo();
    return {
      appVersion: info.appVersion,
      architecture: info.architecture === "unknown" ? null : info.architecture,
      engine: [
        info.electron === "unknown" ? null : `Electron ${info.electron}`,
        info.chrome === "unknown" ? null : `Chromium ${info.chrome}`,
      ].filter(Boolean).join(" · ") || null,
      operatingSystem: desktopOperatingSystem(info.platform, info.osVersion),
    };
  }

  const navigatorWithData = navigator as NavigatorWithUserAgentData;
  const userAgentData = navigatorWithData.userAgentData;
  let architecture = userAgentData?.architecture;
  let platformVersion: string | undefined;
  if (userAgentData?.getHighEntropyValues) {
    try {
      const highEntropy = await userAgentData.getHighEntropyValues(["architecture", "platformVersion"]);
      architecture = highEntropy.architecture || architecture;
      platformVersion = highEntropy.platformVersion;
    } catch {
      // Browsers may decline high-entropy hints; the safe fallback remains useful.
    }
  }

  return {
    appVersion: null,
    architecture: architecture || null,
    engine: browserEngine(navigator.userAgent),
    operatingSystem: browserOperatingSystem(
      navigator.userAgent,
      userAgentData?.platform || navigator.platform,
      platformVersion,
    ),
  };
};

export const getClientSyncDiagnostics = async (): Promise<ClientSyncDiagnostics> => {
  const bridge = window.edgeeverDesktop;
  if (bridge?.isAvailable) {
    const status = await bridge.sidecarRequest<{
      conflict: number;
      error: number;
      lastSyncedAt: string | null;
      pending: number;
      syncing: number;
    }>("sync.status", {});
    return {
      conflict: Number(status.conflict) || 0,
      error: Number(status.error) || 0,
      lastSyncedAt: typeof status.lastSyncedAt === "string" ? status.lastSyncedAt : null,
      pending: Number(status.pending) || 0,
      syncing: Number(status.syncing) || 0,
    };
  }

  const session = await api.getSession();
  const scope = createLocalDataScope(getConfiguredDesktopApiBaseUrl() || window.location.origin, session.user?.id);
  const [allItems, syncIdentity] = await Promise.all([
    localDb.syncQueue.toArray(),
    localDb.syncMeta.get([scope, "identity"]),
  ]);
  const items = allItems.filter((item) => !item.scope || item.scope === scope);
  const summary = summarizeSyncQueue(items);
  return {
    conflict: summary.conflict,
    error: summary.error,
    lastSyncedAt: syncIdentity?.updatedAt ?? null,
    pending: summary.pending,
    syncing: summary.syncing,
  };
};
