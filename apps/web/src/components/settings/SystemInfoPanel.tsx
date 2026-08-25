import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Copy, ExternalLink, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useDeployedUpdateNotice } from "@/hooks/useDeployedUpdateNotice";
import { detectWebClientKind } from "@/lib/client-environment";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { resolveDeploymentPlatform } from "@/lib/instance-runtime";
import { cn } from "@/lib/utils";
import { getReleaseTagForVersion, resolveLocalizedReleaseChanges } from "@/lib/version-check";
import { copyTextToClipboard } from "./settings-utils";

export type SystemInfoItem = { label: string; value: string };

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

export const getWebSystemInfoItems = (
  t: (key: string) => string,
  language: string,
  instanceRuntime?: string | null,
): SystemInfoItem[] => {
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
      label: t("systemInfo.clientVersion"),
      value: `v${__EDGEEVER_APP_VERSION__}`,
    },
    {
      label: t("systemInfo.releaseTime"),
      value: __EDGEEVER_RELEASED_AT__
        ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(__EDGEEVER_RELEASED_AT__))
        : t("systemInfo.unknown"),
    },
    { label: t("systemInfo.build"), value: __EDGEEVER_BUILD_LABEL__ },
    { label: t("systemInfo.client"), value: t(`systemInfo.clients.${clientKind}`) },
    {
      label: t("systemInfo.deploymentPlatform"),
      value: t(`systemInfo.deploymentPlatforms.${resolveDeploymentPlatform(instanceRuntime)}`),
    },
    { label: t("systemInfo.deployment"), value: getDeploymentDescription(t) },
    ...(clientKind === "desktopApp"
      ? []
      : [{ label: t("systemInfo.browser"), value: detectBrowser(userAgent) ?? t("systemInfo.unknown") }]),
    { label: t("systemInfo.os"), value: detectOperatingSystem(userAgent, navigator.platform) ?? t("systemInfo.unknown") },
    { label: t("systemInfo.language"), value: navigator.language || language },
    { label: t("systemInfo.timeZone"), value: timeZone },
  ];
};

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
    queryFn: () => api.getInstanceHealth(),
    enabled: active && Boolean(instanceUrl),
    staleTime: 5 * 60 * 1000,
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
  const infoItems = useMemo(
    () => getWebSystemInfoItems(t, i18n.language, healthQuery.data?.runtime),
    [healthQuery.data?.runtime, i18n.language, t],
  );
  const releaseTag = release ? getReleaseTagForVersion(release.version) : null;
  const releaseHighlights = resolveLocalizedReleaseChanges(
    release?.changes ?? {},
    i18n.resolvedLanguage ?? i18n.language
  );
  const releaseUrl = releaseTag
    ? `https://github.com/tianma-if/edgeever/releases/tag/${encodeURIComponent(releaseTag)}`
    : "https://github.com/tianma-if/edgeever/releases/latest";

  const handleCopy = async () => {
    if (!(await copyTextToClipboard(infoItems.map((item) => `${item.label}: ${item.value}`).join("\n")))) return;
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
    <div className="grid gap-3">
      <div className="flex flex-wrap justify-end gap-2">
        {desktopAvailable ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 bg-white px-3 text-xs"
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
        <Button size="sm" variant="outline" className="h-8 w-full bg-white px-3 text-xs sm:w-auto" type="button" onClick={() => void handleCopy()}>
          <Copy className="h-3.5 w-3.5" />
          {copied ? t("common.copied") : t("systemInfo.copy")}
        </Button>
      </div>
      {desktopAvailable && desktopUpdateStatus ? (
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
      {active && release ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 border-l-2 border-l-emerald-500 bg-emerald-50/40 px-3 py-2 text-slate-800" role="status">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1 text-xs leading-5">
            <div className="font-semibold">{t("systemInfo.deployedUpdateTitle", { version: releaseTag?.replace(/^v/, "") ?? release.version })}</div>
            {releaseHighlights.length > 0 ? (
              <div className="mt-1 text-slate-600">
                <div className="pl-4 font-medium">{t("systemInfo.releaseHighlightsLabel")}</div>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                  {releaseHighlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                </ul>
              </div>
            ) : (
              <div className="mt-1 text-slate-500">{t("systemInfo.releaseNotesUnavailable")}</div>
            )}
            <p className="mt-2 border-t border-emerald-100/70 pt-1.5 text-[10px] leading-4 text-slate-400">
              <Trans
                i18nKey="systemInfo.clientUpdatesNote"
                components={{
                  releases: (
                    <a
                      className="text-slate-500 underline underline-offset-2 hover:text-emerald-700"
                      href="https://github.com/tianma-if/edgeever/releases"
                      target="_blank"
                      rel="noreferrer"
                    />
                  ),
                }}
              />
            </p>
          </div>
          <a className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-900" href={releaseUrl} target="_blank" rel="noreferrer">
            {t("systemInfo.viewReleaseNotes")} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : null}
      <dl className="grid border-y border-slate-200 sm:grid-cols-3">
        {infoItems.map((item) => (
          <div key={item.label} className="min-w-0 border-b border-slate-200 px-2 py-2.5 sm:px-3">
            <dt className="truncate text-[11px] font-semibold uppercase text-slate-400">{item.label}</dt>
            <dd className={cn("mt-0.5 break-words font-mono text-xs font-semibold leading-5 text-slate-800")} title={item.value}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
