import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CircleCheck, Cloud, Copy, ExternalLink, LoaderCircle, MonitorSmartphone, RefreshCw, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useDeployedUpdateNotice } from "@/hooks/useDeployedUpdateNotice";
import { detectWebClientKind } from "@/lib/client-environment";
import { api, getConfiguredDesktopApiBaseUrl, type InstanceHealth } from "@/lib/api";
import { resolveDeploymentPlatform } from "@/lib/instance-runtime";
import {
  getClientRuntimeDiagnostics,
  getClientSyncDiagnostics,
  type ClientRuntimeDiagnostics,
  type ClientSyncDiagnostics,
} from "@/lib/system-diagnostics";
import { cn } from "@/lib/utils";
import { getReleaseTagForVersion } from "@/lib/version-check";
import { copyTextToClipboard } from "./settings-utils";

export type SystemInfoItem = {
  label: string;
  value: string;
  mono?: boolean;
  colSpan?: "full" | "two" | "double-sm";
  status?: "connected" | "connecting" | "failed" | "warning" | "error" | "default";
};

type InstanceSystemDiagnostics = Pick<InstanceHealth, "build" | "migration" | "objectStorageProvider" | "storage"> & {
  runtime?: string | null;
};

type SystemInfoGroup = {
  id: "cloud" | "client" | "connection";
  title: string;
  description: string;
  items: SystemInfoItem[];
};

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

const detectBrowser = (userAgent: string) => {
  if (/Edg\//.test(userAgent) || /EdgA\//.test(userAgent) || /EdgiOS\//.test(userAgent)) return "Microsoft Edge";
  if ((/Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)) && !/Chromium\//.test(userAgent)) return "Chrome";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) return "Safari";
  return null;
};

const detectOperatingSystem = (userAgent: string, platform: string) => {
  const source = `${userAgent} ${platform}`;
  if (/Windows/i.test(source)) return "Windows";
  if (/Android/i.test(source)) return "Android";
  if (/(iPhone|iPad|iPod)/i.test(source)) return "iOS";
  if (/Mac/i.test(source)) return "macOS";
  if (/Linux/i.test(source)) return "Linux";
  return null;
};

const getDeploymentDescription = (t: (key: string) => string) => {
  const trigger = t(`systemInfo.deploymentTriggers.${__EDGEEVER_DEPLOYMENT_TRIGGER__}`);
  const method = t(`systemInfo.deploymentMethods.${__EDGEEVER_DEPLOYMENT_METHOD__}`);
  return `${trigger} · ${method}`;
};

const getColSpanClass = (colSpan?: SystemInfoItem["colSpan"]) => {
  if (colSpan === "full") return "sm:col-span-2 lg:col-span-3";
  if (colSpan === "two") return "sm:col-span-2 lg:col-span-2";
  if (colSpan === "double-sm") return "sm:col-span-2 lg:col-span-1";
  return "col-span-1";
};

const getWebSystemInfoGroups = (
  t: (key: string) => string,
  language: string,
  diagnostics: {
    clientRuntime?: ClientRuntimeDiagnostics | null;
    instance?: Partial<InstanceSystemDiagnostics> | null;
    instanceVersion?: string | null;
  } = {},
): SystemInfoGroup[] => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || t("systemInfo.unknown");
  const userAgent = navigator.userAgent;
  const clientKind = detectWebClientKind({
    desktopBridgeAvailable: window.edgeeverDesktop?.isAvailable === true,
    displayModeStandalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches,
    navigatorStandalone: (navigator as NavigatorWithStandalone).standalone === true,
  });

  return [
    {
      id: "cloud",
      title: t("systemInfo.cloudSection"),
      description: t("systemInfo.cloudSectionDescription"),
      items: [
        {
          label: t("systemInfo.instanceVersion"),
          value: diagnostics.instanceVersion
            ? `v${diagnostics.instanceVersion.replace(/^v/, "")}`
            : clientKind === "desktopApp"
              ? t("systemInfo.unknown")
              : `v${__EDGEEVER_APP_VERSION__}`,
          mono: true,
        },
        { label: t("systemInfo.instanceBuild"), value: diagnostics.instance?.build ?? t("systemInfo.unknown"), mono: true },
        { label: t("systemInfo.databaseMigration"), value: diagnostics.instance?.migration ?? t("systemInfo.unknown"), mono: true },
        {
          label: t("systemInfo.databaseBackend"),
          value: diagnostics.instance?.storage?.database
            ? t(`systemInfo.databaseBackends.${diagnostics.instance.storage.database}`)
            : t("systemInfo.unknown"),
        },
        {
          label: t("systemInfo.newUploadObjectStorage"),
          value: diagnostics.instance?.objectStorageProvider === "s3"
            ? t("systemInfo.objectStorageBackends.external_s3")
            : diagnostics.instance?.objectStorageProvider === "builtin" && diagnostics.instance.storage?.resources
              ? t(`systemInfo.objectStorageBackends.builtin_${diagnostics.instance.storage.resources}`)
              : t("systemInfo.unknown"),
        },
        ...(diagnostics.instance?.objectStorageProvider === "s3"
          ? [{
              label: t("systemInfo.existingAttachments"),
              value: t("systemInfo.existingAttachmentsOriginalStorage"),
            }]
          : []),
        {
          label: t("systemInfo.deploymentPlatform"),
          value: t(`systemInfo.deploymentPlatforms.${resolveDeploymentPlatform(diagnostics.instance?.runtime)}`),
        },
        { label: t("systemInfo.deployment"), value: getDeploymentDescription(t), colSpan: "full" },
      ],
    },
    {
      id: "client",
      title: t("systemInfo.clientSection"),
      description: t("systemInfo.clientSectionDescription"),
      items: [
        {
          label: t("systemInfo.clientVersion"),
          value: `v${diagnostics.clientRuntime?.appVersion ?? __EDGEEVER_APP_VERSION__}`,
          mono: true,
        },
        {
          label: t("systemInfo.releaseTime"),
          value: __EDGEEVER_RELEASED_AT__
            ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(__EDGEEVER_RELEASED_AT__))
            : t("systemInfo.unknown"),
        },
        { label: t("systemInfo.build"), value: __EDGEEVER_BUILD_LABEL__, mono: true },
        { label: t("systemInfo.client"), value: t(`systemInfo.clients.${clientKind}`) },
        {
          label: t("systemInfo.os"),
          value: diagnostics.clientRuntime?.operatingSystem
            ?? detectOperatingSystem(userAgent, navigator.platform)
            ?? t("systemInfo.unknown"),
        },
        {
          label: t("systemInfo.architecture"),
          value: diagnostics.clientRuntime?.architecture ?? t("systemInfo.unknown"),
          mono: true,
        },
        {
          label: t("systemInfo.runtimeEngine"),
          value: diagnostics.clientRuntime?.engine
            ?? (clientKind === "desktopApp" ? t("systemInfo.unknown") : detectBrowser(userAgent) ?? t("systemInfo.unknown")),
        },
        { label: t("systemInfo.language"), value: navigator.language || language, mono: true },
        { label: t("systemInfo.timeZone"), value: timeZone, mono: true, colSpan: "double-sm" },
      ],
    },
  ];
};

export const getWebSystemInfoItems = (
  t: (key: string) => string,
  language: string,
  instanceRuntime?: string | null,
  instanceVersion?: string | null,
): SystemInfoItem[] => getWebSystemInfoGroups(t, language, {
  instance: { runtime: instanceRuntime },
  instanceVersion,
})
  .flatMap((group) => group.items);

export const SystemInfoPanel = ({ active = true }: { active?: boolean }) => {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [desktopUpdateChecked, setDesktopUpdateChecked] = useState(false);
  const queryClient = useQueryClient();
  const { release } = useDeployedUpdateNotice();
  const desktopBridge = window.edgeeverDesktop;
  const desktopAvailable = desktopBridge?.isAvailable === true;
  const instanceUrl = desktopAvailable ? getConfiguredDesktopApiBaseUrl() : window.location.origin;
  const healthQuery = useQuery({
    queryKey: ["instance-health", instanceUrl],
    queryFn: async () => {
      const startedAt = performance.now();
      const health = await api.getInstanceHealth();
      return { health, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) };
    },
    enabled: active && Boolean(instanceUrl),
    staleTime: 60 * 1000,
    retry: 1,
  });
  const clientRuntimeQuery = useQuery({
    queryKey: ["system-info-client-runtime"],
    queryFn: getClientRuntimeDiagnostics,
    enabled: active,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  const syncDiagnosticsQuery = useQuery<ClientSyncDiagnostics>({
    queryKey: ["system-info-sync-diagnostics", instanceUrl],
    queryFn: getClientSyncDiagnostics,
    enabled: active && Boolean(instanceUrl),
    refetchInterval: active ? 10_000 : false,
    retry: 1,
  });
  const desktopUpdateStatusQuery = useQuery({
    queryKey: ["desktop-update-status"],
    queryFn: () => desktopBridge!.updateStatus(),
    enabled: active && desktopAvailable,
    refetchInterval: (query) => query.state.data?.state === "available" ? 1_000 : false,
    retry: 1,
  });
  const desktopUpdateCheckMutation = useMutation({
    mutationFn: () => desktopBridge!.checkUpdate(),
    onSuccess: (status) => {
      queryClient.setQueryData(["desktop-update-status"], status);
      setDesktopUpdateChecked(true);
    },
  });
  const desktopUpdateInstallMutation = useMutation({
    mutationFn: () => desktopBridge!.installUpdate(),
  });
  const infoGroups = useMemo(() => {
    const groups = getWebSystemInfoGroups(t, i18n.language, {
      clientRuntime: clientRuntimeQuery.data,
      instance: healthQuery.data?.health,
      instanceVersion: release?.version,
    });
    const lastSyncedAt = syncDiagnosticsQuery.data?.lastSyncedAt;
    const lastSyncedDate = lastSyncedAt ? new Date(lastSyncedAt) : null;
    const formattedLastSync = !syncDiagnosticsQuery.data
      ? t("systemInfo.unknown")
      : lastSyncedDate && Number.isFinite(lastSyncedDate.getTime())
        ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(lastSyncedDate)
        : t("systemInfo.neverSynced");
    const pendingCount = syncDiagnosticsQuery.data
      ? syncDiagnosticsQuery.data.pending + syncDiagnosticsQuery.data.syncing
      : null;
    const failedCount = syncDiagnosticsQuery.data
      ? syncDiagnosticsQuery.data.error + syncDiagnosticsQuery.data.conflict
      : null;

    groups.push({
      id: "connection",
      title: t("systemInfo.connectionSection"),
      description: t("systemInfo.connectionSectionDescription"),
      items: [
        {
          label: t("systemInfo.instanceConnection"),
          value: healthQuery.isError
            ? t("systemInfo.connectionFailed")
            : healthQuery.isSuccess
              ? t("systemInfo.connectionConnected")
              : t("systemInfo.connectionChecking"),
          colSpan: "two",
          status: healthQuery.isError ? "failed" : healthQuery.isSuccess ? "connected" : "connecting",
        },
        {
          label: t("systemInfo.requestLatency"),
          value: healthQuery.data ? `${healthQuery.data.latencyMs} ms` : t("systemInfo.unknown"),
          mono: true,
        },
        { label: t("systemInfo.lastSuccessfulSync"), value: formattedLastSync },
        {
          label: t("systemInfo.pendingSync"),
          value: pendingCount !== null ? String(pendingCount) : t("systemInfo.unknown"),
          mono: true,
          status: (pendingCount ?? 0) > 0 ? "warning" : "default",
        },
        {
          label: t("systemInfo.failedSync"),
          value: failedCount !== null ? String(failedCount) : t("systemInfo.unknown"),
          mono: true,
          status: (failedCount ?? 0) > 0 ? "error" : "default",
        },
      ],
    });
    return groups;
  }, [
    clientRuntimeQuery.data,
    healthQuery.data,
    healthQuery.isError,
    healthQuery.isSuccess,
    i18n.language,
    release?.version,
    syncDiagnosticsQuery.data,
    t,
  ]);
  const releaseTag = release ? getReleaseTagForVersion(release.version) : null;
  const releaseUrl = releaseTag
    ? `https://github.com/tianma-if/edgeever/releases/tag/${encodeURIComponent(releaseTag)}`
    : "https://github.com/tianma-if/edgeever/releases/latest";

  const handleCopy = async () => {
    const text = infoGroups
      .map((group) => [group.title, ...group.items.map((item) => `${item.label}: ${item.value}`)].join("\n"))
      .join("\n\n");
    if (!(await copyTextToClipboard(text))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const desktopUpdateState = desktopUpdateStatusQuery.data?.state ?? "idle";
  const desktopUpdateBusy = desktopUpdateCheckMutation.isPending || desktopUpdateInstallMutation.isPending;
  const desktopUpdateStatus = desktopUpdateInstallMutation.isError || desktopUpdateCheckMutation.isError || desktopUpdateStatusQuery.isError
    ? t("systemInfo.desktopUpdateFailed")
    : desktopUpdateInstallMutation.isPending
      ? t("systemInfo.desktopUpdateInstalling")
      : desktopUpdateCheckMutation.isPending
        ? t("systemInfo.desktopUpdateChecking")
        : desktopUpdateState === "available"
          ? t("systemInfo.desktopUpdateDownloading")
          : desktopUpdateState === "downloaded"
            ? t("systemInfo.desktopUpdateReady")
            : desktopUpdateChecked
              ? t("systemInfo.desktopUpdateCurrent")
              : null;

  const handleDesktopUpdate = () => {
    if (desktopUpdateState === "downloaded") desktopUpdateInstallMutation.mutate();
    else desktopUpdateCheckMutation.mutate();
  };

  return (
    <div className="grid gap-3.5">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 bg-white px-2.5 text-xs text-slate-700 shadow-xs hover:bg-slate-50"
          type="button"
          onClick={() => void handleCopy()}
        >
          {copied ? <CircleCheck className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
          <span className={copied ? "font-medium text-emerald-700" : ""}>
            {copied ? t("common.copied") : t("systemInfo.copy")}
          </span>
        </Button>
      </div>
      {infoGroups.map((group) => {
        const isCloud = group.id === "cloud";
        const isClient = group.id === "client";
        const headingId = `system-info-${group.id}-heading`;
        return (
          <section key={group.id} className="grid gap-2" aria-labelledby={headingId}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-emerald-100 bg-emerald-50 text-emerald-700">
                  {isCloud
                    ? <Cloud className="h-3.5 w-3.5" />
                    : isClient
                      ? <MonitorSmartphone className="h-3.5 w-3.5" />
                      : <Activity className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0">
                  <h3 id={headingId} className="text-xs font-semibold text-slate-800">{group.title}</h3>
                </div>
              </div>
              {isClient && desktopAvailable ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 bg-white px-2.5 text-xs shadow-xs hover:bg-slate-50"
                  type="button"
                  disabled={desktopUpdateBusy || desktopUpdateState === "available"}
                  onClick={handleDesktopUpdate}
                >
                  {desktopUpdateBusy || desktopUpdateState === "available"
                    ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    : desktopUpdateState === "downloaded"
                      ? <RotateCcw className="h-3.5 w-3.5" />
                      : <RefreshCw className="h-3.5 w-3.5" />}
                  {desktopUpdateState === "downloaded"
                    ? t("systemInfo.desktopUpdateRestart")
                    : desktopUpdateState === "available"
                      ? t("systemInfo.desktopUpdateDownloading")
                      : desktopUpdateCheckMutation.isPending
                        ? t("systemInfo.desktopUpdateChecking")
                        : t("systemInfo.desktopCheckForUpdates")}
                </Button>
              ) : null}
            </div>
            {isCloud && active && release ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50/70 px-3 py-1.5 text-slate-800" role="status">
                <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1 text-xs font-medium text-emerald-950">
                  {t("systemInfo.deployedUpdateTitle", { version: releaseTag?.replace(/^v/, "") ?? release.version })}
                </div>
                <a className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-900" href={releaseUrl} target="_blank" rel="noreferrer">
                  {t("systemInfo.viewReleaseNotes")} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : null}
            {isClient && desktopAvailable && desktopUpdateStatus ? (
              <p
                className={cn(
                  "text-right text-xs",
                  desktopUpdateInstallMutation.isError || desktopUpdateCheckMutation.isError || desktopUpdateStatusQuery.isError
                    ? "text-red-600"
                    : "text-slate-500",
                )}
                role="status"
                aria-live="polite"
              >
                {desktopUpdateStatus}
              </p>
            ) : null}
            <div className="rounded-lg border border-slate-200/80 bg-white p-3 sm:p-3.5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 sm:gap-x-5">
                {group.items.map((item) => (
                  <div
                    key={item.label}
                    className={cn("min-w-0", getColSpanClass(item.colSpan))}
                  >
                    <dt className="truncate text-[11px] font-normal text-slate-400">{item.label}</dt>
                    <dd className="mt-0.5 flex min-w-0 items-center gap-1.5">
                      {item.status === "connected" ? (
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]" />
                      ) : item.status === "connecting" ? (
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 animate-pulse" />
                      ) : item.status === "failed" ? (
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.5)]" />
                      ) : null}
                      <span
                        className={cn(
                          "break-words text-xs leading-5",
                          item.mono ? "font-mono font-medium" : "font-sans font-medium",
                          item.status === "failed" || item.status === "error"
                            ? "font-semibold text-rose-600"
                            : item.status === "warning"
                              ? "font-semibold text-amber-600"
                              : "text-slate-800",
                        )}
                      >
                        {item.value}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        );
      })}
    </div>
  );
};
