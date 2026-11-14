import { useEffect, useState, useSyncExternalStore } from "react";
import { BookOpen, CalendarClock, Download, ExternalLink, History, Play, Puzzle, RefreshCw, Settings2, Trash2, Upload } from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { EdgeEverPluginHost, InstalledExtension, RegisteredPluginCommand } from "@/lib/plugins/plugin-host";
import { PluginCatalogCard } from "@/components/plugins/PluginCatalogCard";
import { loadDisplayPluginMarketplace } from "@/lib/plugins/community-registry";
import {
  COMMUNITY_PLUGINS_REPOSITORY_URL,
  COMMUNITY_PLUGINS_README_URL,
  communityPluginSubmissionIssueUrl,
  precheckCommunityPluginSubmission,
} from "@/lib/plugins/community-plugin-submission";
import { GitHubMark } from "@/components/GitHubRepositoryLink";
import { applyPluginUpdate, checkPluginUpdates, type PluginUpdateInfo } from "@/lib/plugins/plugin-updates";
import { PluginUpdateDialog } from "@/components/plugins/PluginUpdateDialog";
import { PluginSettingsSection } from "@/components/plugins/PluginSettingsSection";
import { buildPluginCatalogItems, getPluginCatalogDescription, getPluginCatalogName, getPluginCatalogSourceKey } from "@/lib/plugins/plugin-catalog";
import type { MarketplaceEntry, MarketplaceRevocation } from "@edgeever/plugin-api";
import { getPluginDetailPage, getPluginDetailPath, hasPluginSettings, isPluginCardCommand, type PluginDetailPage } from "@/lib/plugins/plugin-navigation";
import type { ScheduledTask } from "@edgeever/shared";
import { api, getOrCreateClientDeviceId } from "@/lib/api";
import { BETA_BADGE_CLASSNAME } from "@/lib/workspace-ui";
import { ScheduledTaskRunHistoryDialog } from "@/components/execution/ScheduledTaskRunHistoryDialog";
import { AppConfirmDialog } from "@/components/dialogs/ConfirmDialogs";
import { prefersChineseContent } from "@/lib/bilingual-content-locale";
import {
  acknowledgePluginTrustWarning,
  hasAcknowledgedPluginTrustWarning,
  PLUGIN_TRUST_WARNING_COPY,
  shouldRequestPluginTrustAcknowledgement,
} from "@/lib/plugins/plugin-trust";

const PLUGIN_CARD_GRID_CLASS_NAME = "grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3";

const LegacyManualScheduledTasksSection = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const deviceId = window.edgeeverDesktop?.isAvailable ? getOrCreateClientDeviceId() : null;
  const [message, setMessage] = useState<string | null>(null);
  const [historyTask, setHistoryTask] = useState<ScheduledTask | null>(null);
  const tasksQuery = useQuery({
    queryKey: ["scheduled-tasks", deviceId],
    queryFn: () => api.listScheduledTasks(deviceId ?? undefined),
    enabled: Boolean(deviceId),
    refetchInterval: 60_000,
  });

  if (!deviceId) return null;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["scheduled-tasks"] });
  };
  const updateTask = async (taskId: string, isEnabled: boolean) => {
    setMessage(null);
    try {
      await api.updateScheduledTask(taskId, { isEnabled });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const deleteTask = async (taskId: string) => {
    setMessage(null);
    try {
      await api.deleteScheduledTask(taskId);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const tasks = (tasksQuery.data?.tasks ?? []).filter((task) => !task.ownerPluginId);
  if (tasks.length === 0) return null;

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div>
          <h3 className="text-xs font-semibold text-slate-800">{t("plugins.schedules.legacyTitle")}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{t("plugins.schedules.legacyDescription")}</p>
        </div>
      </div>

      {message ? <p className="mt-3 text-xs text-slate-600">{message}</p> : null}

      <div className="mt-4 grid gap-2">
        {tasks.map((task) => (
          <div key={task.id} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-card px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-slate-800">{task.name}</div>
              <div className="mt-0.5 truncate font-mono text-xs text-slate-400">
                {task.cronExpression} · {task.timezone} · {task.taskPayload.pluginId}:{task.taskPayload.commandId}
              </div>
              {task.lastRun ? (
                <div className={`mt-1 text-xs ${task.lastRun.status === "failed" ? "text-rose-600" : "text-slate-400"}`}>
                  {t(`plugins.schedules.status.${task.lastRun.status}`)} · {new Date(task.lastRun.startedAt).toLocaleString()}
                </div>
              ) : null}
            </div>
            <Switch
              aria-label={t("plugins.schedules.toggle", { name: task.name })}
              checked={task.isEnabled}
              onCheckedChange={(isEnabled) => void updateTask(task.id, isEnabled)}
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2 text-slate-600"
              aria-label={t("plugins.schedules.historyFor", { name: task.name })}
              onClick={() => setHistoryTask(task)}
            >
              <History className="h-3.5 w-3.5" />
              <span>{t("plugins.schedules.history")}</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              aria-label={t("plugins.schedules.delete", { name: task.name })}
              onClick={() => void deleteTask(task.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <ScheduledTaskRunHistoryDialog
        task={historyTask}
        currentDeviceId={deviceId}
        onOpenChange={(open) => {
          if (!open) setHistoryTask(null);
        }}
      />
    </section>
  );
};

const PluginDetailView = ({
  page,
  commands,
  extension,
  marketplaceEntry,
  host,
  pendingId,
  update,
  onRunCommand,
  onToggle,
  onUninstall,
  onUpdate,
  revocation,
}: {
  page: PluginDetailPage;
  commands: RegisteredPluginCommand[];
  extension: InstalledExtension;
  marketplaceEntry?: MarketplaceEntry;
  host: EdgeEverPluginHost;
  pendingId: string | null;
  update?: PluginUpdateInfo;
  onRunCommand: (command: RegisteredPluginCommand) => void;
  onToggle: (enabled: boolean) => void;
  onUninstall: () => void;
  onUpdate: () => void;
  revocation?: MarketplaceRevocation;
}) => {
  const { t, i18n } = useTranslation();
  const { manifest } = extension;
  const id = manifest.id;
  const catalogItem = { id, extension, marketplaceEntry };
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const name = getPluginCatalogName(catalogItem, locale);
  const description = getPluginCatalogDescription(catalogItem, locale);
  const sourceKey = getPluginCatalogSourceKey(catalogItem) ?? extension.source.kind;

  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-950">{name}</h2>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{manifest.type}</span>
            {update ? (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800">
                {t("plugins.updates.available", { version: update.latestVersion })}
              </span>
            ) : null}
          </div>
          {description ? <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{description}</p> : null}
        </div>
        <Switch
          aria-label={t("plugins.toggle", { name })}
          checked={extension.enabled}
          disabled={pendingId === id}
          onCheckedChange={onToggle}
        />
      </div>

      {hasPluginSettings(manifest) ? (
        <nav className="flex gap-2 border-b border-slate-200 pb-3" aria-label={t("plugins.details.navigation")}>
          <Button asChild size="sm" variant={page === "overview" ? "soft" : "ghost"}>
            <Link to={getPluginDetailPath(id)} aria-current={page === "overview" ? "page" : undefined}>{t("plugins.details.overview")}</Link>
          </Button>
          <Button asChild size="sm" variant={page === "settings" ? "soft" : "ghost"} className="gap-1.5">
            <Link to={getPluginDetailPath(id, "settings")} aria-current={page === "settings" ? "page" : undefined}>
              <Settings2 className="h-3.5 w-3.5" />
              {t("plugins.settings.title")}
            </Link>
          </Button>
        </nav>
      ) : null}

      {page === "settings" && manifest.type === "plugin" ? (
        <PluginSettingsSection key={`${id}:${manifest.version}`} host={host} manifest={manifest} />
      ) : (
        <>
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
            {[
              [t("plugins.details.type"), manifest.type],
              [t("plugins.details.version"), `v${manifest.version}`],
              [t("plugins.details.source"), t(`plugins.sources.${sourceKey}`)],
              [t("plugins.details.installedAt"), new Date(extension.installedAt).toLocaleString(i18n.language)],
            ].map(([label, value]) => (
              <div key={label} className="flex min-w-0 items-center gap-1.5">
                <dt>{label}</dt>
                <dd className="truncate text-slate-500">{value}</dd>
              </div>
            ))}
          </dl>

          {extension.source.repositoryUrl ? (
            <a className="inline-flex w-fit max-w-full items-center gap-2 text-xs text-slate-500 hover:text-slate-950" href={extension.source.repositoryUrl} target="_blank" rel="noreferrer">
              <GitHubMark className="h-4 w-4 shrink-0" />
              <span className="truncate">{extension.source.repositoryUrl.replace("https://github.com/", "")}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : null}

          {manifest.type === "plugin" && manifest.networkHosts?.length ? (
            <section>
              <h3 className="text-xs font-semibold text-slate-700">{t("plugins.details.networkHosts")}</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {manifest.networkHosts.map((hostname) => (
                  <span key={hostname} className="rounded-full bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">{hostname}</span>
                ))}
              </div>
            </section>
          ) : null}

          {revocation ? (
            <div role="status" className="text-xs leading-5 text-rose-700">
              {t("plugins.marketplace.revoked", { reason: revocation.reason })}
            </div>
          ) : null}
          {extension.error ? <div className="text-xs leading-5 text-rose-600">{extension.error}</div> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {update && !revocation ? (
              <Button size="sm" className="gap-1.5" disabled={pendingId === `update:${id}`} onClick={onUpdate}>
                <Download className="h-3.5 w-3.5" />
                {t("plugins.updates.update")}
              </Button>
            ) : null}
            {commands.filter(isPluginCardCommand).map((command) => (
              <Button key={command.id} size="sm" variant="outline" className="gap-1.5" disabled={pendingId === `${id}:${command.id}`} onClick={() => onRunCommand(command)}>
                <Play className="h-3.5 w-3.5" />
                {command.title}
              </Button>
            ))}
            <Button size="sm" variant="ghost" className="ml-auto gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700" disabled={pendingId === `remove:${id}`} onClick={onUninstall}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("plugins.uninstall")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export const PluginManagerCard = ({
  host,
  onClosePlugin,
  onOpenPlugin,
  selectedPluginId,
  requestedPage = null,
}: {
  host: EdgeEverPluginHost;
  onClosePlugin?: () => void;
  onOpenPlugin?: (pluginId: string) => void;
  selectedPluginId?: string | null;
  requestedPage?: string | null;
}) => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const developerDocsUrl = prefersChineseContent(i18n.resolvedLanguage)
    ? "https://github.com/tianma-if/edgeever/blob/main/docs/plugin-development.zh-CN.md"
    : "https://github.com/tianma-if/edgeever/blob/main/docs/plugin-development.md";
  const communityReadmeUrl = prefersChineseContent(i18n.resolvedLanguage)
    ? `${COMMUNITY_PLUGINS_REPOSITORY_URL}/blob/main/README.zh-CN.md`
    : COMMUNITY_PLUGINS_README_URL;
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  const [manifestUrl, setManifestUrl] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [manuallyChecking, setManuallyChecking] = useState(false);
  const [lastManualCheckCount, setLastManualCheckCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<PluginUpdateInfo | null>(null);
  const [pendingTrustPluginId, setPendingTrustPluginId] = useState<string | null>(null);
  const [submissionOpen, setSubmissionOpen] = useState(false);
  const [submissionRepository, setSubmissionRepository] = useState("");
  const [submissionResult, setSubmissionResult] = useState<{ id: string; repositoryUrl: string } | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [checkingSubmission, setCheckingSubmission] = useState(false);
  const [refreshingMarketplace, setRefreshingMarketplace] = useState(false);
  const marketplaceQuery = useQuery({
    queryKey: ["plugin-marketplace", "v2"],
    queryFn: () => loadDisplayPluginMarketplace({ refreshCommunity: false }),
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    let active = true;
    void loadDisplayPluginMarketplace({ refreshCommunity: true }).then((next) => {
      if (active) queryClient.setQueryData(["plugin-marketplace", "v2"], next);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [queryClient]);
  const extensionVersionKey = snapshot.extensions
    .map((extension) => `${extension.manifest.id}:${extension.manifest.version}:${extension.source.kind}`)
    .join("|");
  const marketplaceVersionKey = marketplaceQuery.data?.updatedAt ?? "unavailable";
  const revocationKey = (marketplaceQuery.data?.revocations ?? []).map((item) => item.id).sort().join("|");
  const revokedIds = new Set((marketplaceQuery.data?.revocations ?? []).map((item) => item.id));
  const updateQueryKey = ["plugin-updates", extensionVersionKey, marketplaceVersionKey, revocationKey] as const;
  const updateQuery = useQuery({
    queryKey: updateQueryKey,
    queryFn: () => checkPluginUpdates(
      snapshot.extensions,
      marketplaceQuery.data?.entries ?? [],
      undefined,
      { revokedIds },
    ),
    enabled: snapshot.extensions.length > 0 && !marketplaceQuery.isLoading,
    staleTime: 5 * 60_000,
    refetchInterval: 30 * 60_000,
    refetchOnWindowFocus: true,
  });
  const catalogItems = buildPluginCatalogItems(marketplaceQuery.data?.entries ?? [], snapshot.extensions);
  const selectedExtension = selectedPluginId
    ? snapshot.extensions.find((extension) => extension.manifest.id === selectedPluginId)
    : undefined;

  const install = async () => {
    if (!manifestUrl.trim()) return;
    setInstalling(true);
    setError(null);
    try {
      await host.installFromSource(manifestUrl.trim());
      setManifestUrl("");
      setLastManualCheckCount(null);
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError));
    } finally {
      setInstalling(false);
    }
  };

  const run = async (actionId: string, action: () => Promise<void>) => {
    setPendingId(actionId);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setPendingId(null);
    }
  };

  const refreshMarketplace = async () => {
    const next = await loadDisplayPluginMarketplace({ refreshCommunity: true });
    queryClient.setQueryData(["plugin-marketplace", "v2"], next);
    return next;
  };

  const checkForUpdates = async () => {
    setManuallyChecking(true);
    setError(null);
    try {
      const refreshedMarketplace = await refreshMarketplace();
      const result = await checkPluginUpdates(
        snapshot.extensions,
        refreshedMarketplace.entries,
        undefined,
        { revokedIds: new Set(refreshedMarketplace.revocations.map((item) => item.id)) },
      );
      queryClient.setQueryData(
        [
          "plugin-updates",
          extensionVersionKey,
          refreshedMarketplace.updatedAt ?? "unavailable",
          refreshedMarketplace.revocations.map((item) => item.id).sort().join("|"),
        ],
        result,
      );
      setLastManualCheckCount(result.updates.length);
      const checkErrors = Object.values(result.errors);
      if (checkErrors.length > 0 && checkErrors.length === snapshot.extensions.length) {
        setError(t("plugins.updates.checkFailed", { message: checkErrors[0] }));
      }
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : String(checkError));
    } finally {
      setManuallyChecking(false);
    }
  };

  const toggleExtension = (extension: InstalledExtension, enabled: boolean) => {
    const catalogItem = catalogItems.find((item) => item.id === extension.manifest.id)
      ?? { id: extension.manifest.id, extension };
    if (shouldRequestPluginTrustAcknowledgement({
      acknowledged: hasAcknowledgedPluginTrustWarning(),
      enabled,
      extensionType: extension.manifest.type,
      isOfficial: getPluginCatalogSourceKey(catalogItem) === "official",
    })) {
      setPendingTrustPluginId(extension.manifest.id);
      return;
    }
    void run(extension.manifest.id, () => host.setEnabled(extension.manifest.id, enabled));
  };

  const confirmPluginTrust = () => {
    const pluginId = pendingTrustPluginId;
    if (!pluginId) return;
    acknowledgePluginTrustWarning();
    setPendingTrustPluginId(null);
    void run(pluginId, () => host.setEnabled(pluginId, true));
  };

  const applyUpdate = async (update: PluginUpdateInfo) => {
    await applyPluginUpdate(host, update);
    setPendingUpdate(null);
    setLastManualCheckCount(null);
    await updateQuery.refetch();
  };

  return (
    <Card className="w-full min-w-0 shadow-none">
      <CardHeader className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
            <Puzzle className="h-4 w-4 shrink-0 text-slate-900" />
            {selectedPluginId ? t("plugins.details.title") : t("plugins.title")}
            <span className={BETA_BADGE_CLASSNAME}>Beta</span>
          </CardTitle>
          <div className="flex flex-wrap items-center justify-end gap-1">
            {snapshot.extensions.length > 0 || (marketplaceQuery.data?.entries.length ?? 0) > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-slate-600"
                aria-label={t("plugins.updates.check")}
                disabled={manuallyChecking || updateQuery.isFetching}
                onClick={() => void checkForUpdates()}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${manuallyChecking || updateQuery.isFetching ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">
                  {lastManualCheckCount === null
                    ? t("plugins.updates.check")
                    : lastManualCheckCount === 0
                      ? t("plugins.updates.upToDate")
                      : t("plugins.updates.found", { count: lastManualCheckCount })}
                </span>
                {lastManualCheckCount === null && (updateQuery.data?.updates.length ?? 0) > 0 ? (
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-xs font-semibold text-slate-800">
                    {updateQuery.data?.updates.length}
                  </span>
                ) : null}
              </Button>
            ) : null}
            {!selectedPluginId ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-slate-600"
                aria-label={t("plugins.marketplace.refresh")}
                disabled={refreshingMarketplace}
                onClick={() => {
                  setRefreshingMarketplace(true);
                  setError(null);
                  void refreshMarketplace()
                    .catch((refreshError) => {
                      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
                    })
                    .finally(() => setRefreshingMarketplace(false));
                }}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingMarketplace ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{t("plugins.marketplace.refresh")}</span>
              </Button>
            ) : null}
            {!selectedPluginId ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-slate-600"
                aria-label={t("plugins.marketplace.submissionTitle")}
                onClick={() => setSubmissionOpen(true)}
              >
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("plugins.marketplace.submissionTitle")}</span>
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-slate-600">
              <a href={developerDocsUrl} target="_blank" rel="noreferrer" aria-label={t("plugins.developerDocs")}>
                <BookOpen className="h-4 w-4" />
                <span className="hidden sm:inline">{t("plugins.developerDocs")}</span>
                <ExternalLink className="hidden h-3.5 w-3.5 sm:inline" />
              </a>
            </Button>
          </div>
        </div>
        {selectedPluginId ? null : (
          <p className="text-xs leading-5 text-slate-500">{t("plugins.syncDescription")}</p>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 p-4 pt-0 sm:px-5 sm:pb-5">
        {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div> : null}

        {!globalThis.crypto?.subtle ? (
          <p role="status" className="text-xs leading-5 text-slate-500">{t("plugins.secureFeaturesUnavailable")}</p>
        ) : null}

        {snapshot.catalogErrors.length > 0 ? (
          <div role="alert" className="grid gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            <p>{t("plugins.restoreFailed")}</p>
            <ul className="list-inside list-disc break-words">
              {snapshot.catalogErrors.map((failure, index) => (
                <li key={failure.extensionId ?? index}>{failure.extensionId ? `${failure.extensionId}: ` : ""}{failure.message}</li>
              ))}
            </ul>
            <Button size="sm" variant="outline" className="h-7 justify-self-start bg-card px-2 text-xs"
              disabled={pendingId === "restore-catalog"}
              onClick={() => void run("restore-catalog", async () => {
                const pendingTrust = await host.syncFromCatalog();
                if (pendingTrust.length > 0) setPendingTrustPluginId(pendingTrust[0]);
              })}>
              {t("plugins.marketplace.retry")}
            </Button>
          </div>
        ) : null}

        {marketplaceQuery.isError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            <span>{t("plugins.marketplace.loadFailed", {
              message: marketplaceQuery.error instanceof Error ? marketplaceQuery.error.message : String(marketplaceQuery.error),
            })}</span>
            <Button size="sm" variant="outline" className="h-7 bg-card px-2 text-xs" onClick={() => void marketplaceQuery.refetch()}>
              {t("plugins.marketplace.retry")}
            </Button>
          </div>
        ) : null}

        {!selectedPluginId ? <LegacyManualScheduledTasksSection /> : null}

        {selectedPluginId ? (
          selectedExtension ? (
            <PluginDetailView
              page={getPluginDetailPage(selectedExtension.manifest, requestedPage)}
              extension={selectedExtension}
              marketplaceEntry={catalogItems.find((item) => item.id === selectedExtension.manifest.id)?.marketplaceEntry}
              host={host}
              update={updateQuery.data?.updates.find((update) => update.pluginId === selectedExtension.manifest.id)}
              revocation={(marketplaceQuery.data?.revocations ?? []).find((item) => item.id === selectedExtension.manifest.id)}
              commands={snapshot.commands.filter((command) => command.pluginId === selectedExtension.manifest.id)}
              pendingId={pendingId}
              onToggle={(enabled) => toggleExtension(selectedExtension, enabled)}
              onUpdate={() => {
                const update = updateQuery.data?.updates.find((candidate) => candidate.pluginId === selectedExtension.manifest.id);
                if (update) setPendingUpdate(update);
              }}
              onRunCommand={(command) => void run(
                `${selectedExtension.manifest.id}:${command.id}`,
                () => host.runCommand(selectedExtension.manifest.id, command.id),
              )}
              onUninstall={() => void run(`remove:${selectedExtension.manifest.id}`, async () => {
                await host.uninstall(selectedExtension.manifest.id);
                onClosePlugin?.();
              })}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-xs leading-5 text-slate-500">
              {t("plugins.details.notFound")}
            </div>
          )
        ) : (
          <>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label={t("plugins.installSource")}
            value={manifestUrl}
            onChange={(event) => setManifestUrl(event.target.value)}
            placeholder={t("plugins.sourcePlaceholder")}
            className="focus-visible:border-slate-400 focus-visible:ring-slate-400/25"
          />
          <Button className="gap-1.5 sm:shrink-0" disabled={installing || !manifestUrl.trim()} onClick={() => void install()}>
            <Download className="h-4 w-4" />
            {installing ? t("plugins.installing") : t("plugins.install")}
          </Button>
        </div>

        {(marketplaceQuery.isLoading || snapshot.catalogErrors.length > 0) && catalogItems.length === 0 ? null : catalogItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">
            {t("plugins.empty")}
          </div>
        ) : (
          <div className={PLUGIN_CARD_GRID_CLASS_NAME}>
            {catalogItems.map((item) => (
              <PluginCatalogCard
                key={item.id}
                item={item}
                update={updateQuery.data?.updates.find((update) => update.pluginId === item.id)}
                commands={snapshot.commands.filter((command) => command.pluginId === item.id)}
                pendingId={pendingId}
                onOpenPlugin={onOpenPlugin}
                onToggle={(enabled) => {
                  if (item.extension) toggleExtension(item.extension, enabled);
                }}
                onInstallMarketplace={() => {
                  const entry = item.marketplaceEntry;
                  if (!entry) return;
                  void run(`marketplace:${item.id}`, async () => {
                    await host.installMarketplaceEntry(entry);
                  });
                }}
                onUpdate={() => {
                  const nextUpdate = updateQuery.data?.updates.find((candidate) => candidate.pluginId === item.id);
                  if (nextUpdate) setPendingUpdate(nextUpdate);
                }}
                onRunCommand={(command) => void run(
                  `${item.id}:${command.id}`,
                  () => host.runCommand(item.id, command.id),
                )}
                onUninstall={() => void run(`remove:${item.id}`, () => host.uninstall(item.id))}
                revocation={(marketplaceQuery.data?.revocations ?? []).find((entry) => entry.id === item.id)}
              />
            ))}
          </div>
        )}
          </>
        )}

        {pendingUpdate ? (
          <PluginUpdateDialog
            update={pendingUpdate}
            isUpdating={pendingId === `update:${pendingUpdate.pluginId}`}
            onCancel={() => setPendingUpdate(null)}
            onConfirm={() => void run(`update:${pendingUpdate.pluginId}`, () => applyUpdate(pendingUpdate))}
          />
        ) : null}
        <Dialog open={submissionOpen} onOpenChange={setSubmissionOpen}>
          <DialogContent className="max-w-lg" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{t("plugins.marketplace.submissionTitle")}</DialogTitle>
            </DialogHeader>
            <a
              href={communityReadmeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs text-slate-500 hover:text-slate-950"
            >
              {t("plugins.marketplace.submissionDocs")}
              <ExternalLink className="h-3 w-3" />
            </a>
            {submissionError ? (
              <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{submissionError}</div>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label={t("plugins.marketplace.submissionRepository")}
                value={submissionRepository}
                onChange={(event) => {
                  setSubmissionRepository(event.target.value);
                  setSubmissionResult(null);
                  setSubmissionError(null);
                }}
                placeholder={t("plugins.sourcePlaceholder")}
                className="focus-visible:border-slate-400 focus-visible:ring-slate-400/25"
              />
              <Button
                variant="outline"
                className="gap-1.5 sm:shrink-0"
                disabled={checkingSubmission || !submissionRepository.trim()}
                onClick={() => {
                  setCheckingSubmission(true);
                  setSubmissionError(null);
                  setSubmissionResult(null);
                  void precheckCommunityPluginSubmission(submissionRepository.trim())
                    .then((result) => setSubmissionResult({ id: result.id, repositoryUrl: result.repositoryUrl }))
                    .catch((precheckError) => {
                      setSubmissionError(precheckError instanceof Error ? precheckError.message : String(precheckError));
                    })
                    .finally(() => setCheckingSubmission(false));
                }}
              >
                {checkingSubmission ? t("plugins.marketplace.precheckRunning") : t("plugins.marketplace.precheck")}
              </Button>
            </div>
            {submissionResult ? (
              <p className="text-xs leading-5 text-slate-600">
                {t("plugins.marketplace.precheckPassed", { id: submissionResult.id })}{" "}
                <a
                  href={communityPluginSubmissionIssueUrl(submissionResult.id, submissionResult.repositoryUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
                >
                  {t("plugins.marketplace.openSubmission")}
                </a>
              </p>
            ) : null}
          </DialogContent>
        </Dialog>
        {pendingTrustPluginId ? (
          <AppConfirmDialog
            title={t(PLUGIN_TRUST_WARNING_COPY.titleKey)}
            description={t(PLUGIN_TRUST_WARNING_COPY.descriptionKey)}
            confirmLabel={t(PLUGIN_TRUST_WARNING_COPY.confirmLabelKey)}
            tone="neutral"
            onCancel={() => setPendingTrustPluginId(null)}
            onConfirm={confirmPluginTrust}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
