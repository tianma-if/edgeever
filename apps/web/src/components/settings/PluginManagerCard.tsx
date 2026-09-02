import { useEffect, useState, useSyncExternalStore } from "react";
import { BadgeCheck, BookOpen, Download, ExternalLink, PanelRightOpen, Play, Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { EdgeEverPluginHost, InstalledExtension, RegisteredPluginCommand, RegisteredPluginPanel } from "@/lib/plugins/plugin-host";
import { PluginPanelDialog } from "@/components/plugins/PluginPanelDialog";
import { loadPluginMarketplace } from "@/lib/plugins/plugin-marketplace";
import { GitHubMark } from "@/components/GitHubRepositoryLink";
import { checkPluginUpdates, type PluginUpdateInfo } from "@/lib/plugins/plugin-updates";
import { PluginUpdateDialog } from "@/components/plugins/PluginUpdateDialog";
import type { PluginManifest, PluginSettingValue } from "@edgeever/plugin-api";

const permissionLabel = (permission: string) => permission.replace(":", " · ");

const PluginSettingsSection = ({ host, manifest }: { host: EdgeEverPluginHost; manifest: PluginManifest }) => {
  const { t } = useTranslation();
  const fields = manifest.settings?.fields ?? [];
  const [values, setValues] = useState<Record<string, PluginSettingValue | "">>({});
  const [configuredSecrets, setConfiguredSecrets] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(fields.length > 0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(fields.length > 0);
    setMessage(null);
    void Promise.all(fields.map(async (field) => {
      if (field.type === "secret") return { key: field.key, value: "" as const, configured: await host.hasSettingValue(manifest.id, field.key) };
      return { key: field.key, value: await host.getSettingValue(manifest.id, field.key) ?? "", configured: false };
    })).then((loaded) => {
      if (!active) return;
      setValues(Object.fromEntries(loaded.map((item) => [item.key, item.value])));
      setConfiguredSecrets(Object.fromEntries(loaded.map((item) => [item.key, item.configured])));
      setLoading(false);
    }).catch((error) => {
      if (!active) return;
      setMessage(error instanceof Error ? error.message : String(error));
      setLoading(false);
    });
    return () => { active = false; };
  }, [host, manifest.id, manifest.version]);

  if (fields.length === 0) return null;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      for (const field of fields) {
        const value = values[field.key];
        if (field.type === "secret" && value === "") {
          if (field.required && !configuredSecrets[field.key]) throw new Error(t("plugins.settings.required", { name: field.label }));
          continue;
        }
        if (value === "") {
          if (field.required) throw new Error(t("plugins.settings.required", { name: field.label }));
          await host.removeSettingValue(manifest.id, field.key);
          continue;
        }
        await host.setSettingValue(manifest.id, field.key, value);
        if (field.type === "secret") {
          setConfiguredSecrets((current) => ({ ...current, [field.key]: true }));
          setValues((current) => ({ ...current, [field.key]: "" }));
        }
      }
      setMessage(t("plugins.settings.saved"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-xs font-semibold text-slate-700">{t("plugins.settings.title")}</h3>
      {loading ? <p className="mt-3 text-xs text-slate-400">{t("common.loading")}</p> : (
        <div className="mt-3 grid gap-4">
          {fields.map((field) => {
            const value = values[field.key] ?? "";
            return (
              <label key={field.key} className="grid gap-1.5 text-xs text-slate-700">
                <span className="font-medium">{field.label}{field.required ? " *" : ""}</span>
                {field.type === "boolean" ? (
                  <Switch
                    aria-label={field.label}
                    checked={value === true}
                    onCheckedChange={(checked) => setValues((current) => ({ ...current, [field.key]: checked }))}
                  />
                ) : field.type === "select" ? (
                  <select
                    className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70"
                    value={String(value)}
                    onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                  >
                    {!field.required ? <option value="">{t("plugins.settings.none")}</option> : null}
                    {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : (
                  <Input
                    type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"}
                    value={String(value)}
                    placeholder={field.type === "secret" && configuredSecrets[field.key]
                      ? t("plugins.settings.secretConfigured")
                      : field.type === "text" || field.type === "secret"
                        ? field.placeholder
                        : undefined}
                    min={field.type === "number" ? field.min : undefined}
                    max={field.type === "number" ? field.max : undefined}
                    step={field.type === "number" ? field.step : undefined}
                    onChange={(event) => setValues((current) => ({
                      ...current,
                      [field.key]: field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value,
                    }))}
                  />
                )}
                {field.description ? <span className="text-slate-400">{field.description}</span> : null}
              </label>
            );
          })}
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={saving} onClick={() => void save()}>{saving ? t("common.saving") : t("common.save")}</Button>
            {message ? <span className="text-xs text-slate-500" role="status">{message}</span> : null}
          </div>
        </div>
      )}
    </section>
  );
};

const PluginDetailView = ({
  commands,
  extension,
  host,
  panels,
  pendingId,
  update,
  onOpenPanel,
  onRunCommand,
  onToggle,
  onUninstall,
  onUpdate,
}: {
  commands: RegisteredPluginCommand[];
  extension: InstalledExtension;
  host: EdgeEverPluginHost;
  panels: RegisteredPluginPanel[];
  pendingId: string | null;
  update?: PluginUpdateInfo;
  onOpenPanel: (panel: RegisteredPluginPanel) => void;
  onRunCommand: (command: RegisteredPluginCommand) => void;
  onToggle: (enabled: boolean) => void;
  onUninstall: () => void;
  onUpdate: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const { manifest } = extension;
  const id = manifest.id;
  const sourceKey = extension.source.verified ? "verified" : extension.source.kind;

  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-950">{manifest.name}</h2>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{manifest.type}</span>
            {update ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                {t("plugins.updates.available", { version: update.latestVersion })}
              </span>
            ) : null}
          </div>
          {manifest.description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{manifest.description}</p> : null}
        </div>
        <Switch
          aria-label={t("plugins.toggle", { name: manifest.name })}
          checked={extension.enabled}
          disabled={pendingId === id}
          onCheckedChange={onToggle}
        />
      </div>

      <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t("plugins.details.type"), manifest.type],
          [t("plugins.details.version"), `v${manifest.version}`],
          [t("plugins.details.source"), t(`plugins.sources.${sourceKey}`)],
          [t("plugins.details.installedAt"), new Date(extension.installedAt).toLocaleString(i18n.language)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-slate-400">{label}</dt>
            <dd className="mt-1 truncate font-medium text-slate-700">{value}</dd>
          </div>
        ))}
      </dl>

      {extension.source.repositoryUrl ? (
        <a className="inline-flex w-fit max-w-full items-center gap-2 text-sm text-slate-500 hover:text-emerald-700" href={extension.source.repositoryUrl} target="_blank" rel="noreferrer">
          <GitHubMark className="h-4 w-4 shrink-0" />
          <span className="truncate">{extension.source.repositoryUrl.replace("https://github.com/", "")}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        </a>
      ) : null}

      {manifest.type === "plugin" && manifest.permissions.length > 0 ? (
        <section>
          <h3 className="text-xs font-semibold text-slate-700">{t("plugins.details.permissions")}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {manifest.permissions.map((permission) => (
              <span key={permission} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{permissionLabel(permission)}</span>
            ))}
          </div>
        </section>
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

      {manifest.type === "plugin" ? <PluginSettingsSection host={host} manifest={manifest} /> : null}

      {extension.error ? <div className="text-sm text-rose-600">{extension.error}</div> : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        {update ? (
          <Button size="sm" className="gap-1.5" disabled={pendingId === `update:${id}`} onClick={onUpdate}>
            <Download className="h-3.5 w-3.5" />
            {t("plugins.updates.update")}
          </Button>
        ) : null}
        {commands.map((command) => (
          <Button key={command.id} size="sm" variant="outline" className="gap-1.5" disabled={pendingId === `${id}:${command.id}`} onClick={() => onRunCommand(command)}>
            <Play className="h-3.5 w-3.5" />
            {command.title}
          </Button>
        ))}
        {panels.map((panel) => (
          <Button key={panel.id} size="sm" variant="outline" className="gap-1.5" onClick={() => onOpenPanel(panel)}>
            <PanelRightOpen className="h-3.5 w-3.5" />
            {panel.title}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700" disabled={pendingId === `remove:${id}`} onClick={onUninstall}>
          <Trash2 className="h-3.5 w-3.5" />
          {t("plugins.uninstall")}
        </Button>
      </div>
    </div>
  );
};

export const PluginManagerCard = ({
  host,
  onClosePlugin,
  onOpenPlugin,
  selectedPluginId,
}: {
  host: EdgeEverPluginHost;
  onClosePlugin?: () => void;
  onOpenPlugin?: (pluginId: string) => void;
  selectedPluginId?: string | null;
}) => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const developerDocsUrl = i18n.resolvedLanguage?.startsWith("zh")
    ? "https://github.com/tianma-if/edgeever/blob/main/docs/plugin-development.zh-CN.md"
    : "https://github.com/tianma-if/edgeever/blob/main/docs/plugin-development.md";
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  const [manifestUrl, setManifestUrl] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [manuallyChecking, setManuallyChecking] = useState(false);
  const [lastManualCheckCount, setLastManualCheckCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<RegisteredPluginPanel | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<PluginUpdateInfo | null>(null);
  const marketplaceQuery = useQuery({ queryKey: ["plugin-marketplace", "v1"], queryFn: () => loadPluginMarketplace(), staleTime: 5 * 60_000 });
  const extensionVersionKey = snapshot.extensions
    .map((extension) => `${extension.manifest.id}:${extension.manifest.version}:${extension.source.kind}`)
    .join("|");
  const marketplaceVersionKey = marketplaceQuery.data?.updatedAt ?? "unavailable";
  const updateQueryKey = ["plugin-updates", extensionVersionKey, marketplaceVersionKey] as const;
  const updateQuery = useQuery({
    queryKey: updateQueryKey,
    queryFn: () => checkPluginUpdates(snapshot.extensions, marketplaceQuery.data?.entries ?? []),
    enabled: snapshot.extensions.length > 0 && !marketplaceQuery.isLoading,
    staleTime: 5 * 60_000,
    refetchInterval: 30 * 60_000,
    refetchOnWindowFocus: true,
  });
  const selectedExtension = selectedPluginId
    ? snapshot.extensions.find((extension) => extension.manifest.id === selectedPluginId)
    : undefined;
  const activePanelPluginId = activePanel?.pluginId ?? null;
  const activePanelId = activePanel?.id ?? null;
  const activePanelRegistered = Boolean(activePanelPluginId && activePanelId && snapshot.panels.some(
    (panel) => panel.pluginId === activePanelPluginId && panel.id === activePanelId
  ));

  useEffect(() => {
    if (activePanelId && activePanelPluginId && !activePanelRegistered) setActivePanel(null);
  }, [activePanelId, activePanelPluginId, activePanelRegistered]);

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

  const checkForUpdates = async () => {
    setManuallyChecking(true);
    setError(null);
    try {
      const refreshedMarketplace = await marketplaceQuery.refetch();
      const result = await checkPluginUpdates(snapshot.extensions, refreshedMarketplace.data?.entries ?? []);
      queryClient.setQueryData(
        ["plugin-updates", extensionVersionKey, refreshedMarketplace.data?.updatedAt ?? "unavailable"],
        result,
      );
      setLastManualCheckCount(result.updates.length);
      const firstCheckError = Object.values(result.errors)[0];
      if (firstCheckError) setError(t("plugins.updates.checkFailed", { message: firstCheckError }));
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : String(checkError));
    } finally {
      setManuallyChecking(false);
    }
  };

  const applyUpdate = async (update: PluginUpdateInfo) => {
    const extension = snapshot.extensions.find((candidate) => candidate.manifest.id === update.pluginId);
    if (!extension) throw new Error("Extension is no longer installed.");
    if (extension.source.kind === "marketplace") {
      if (!update.marketplaceEntry) throw new Error("The verified marketplace entry is no longer available.");
      await host.installMarketplaceEntry(update.marketplaceEntry, update.latestManifest);
    } else if (extension.source.kind === "github") {
      if (!extension.source.repositoryUrl) throw new Error("Installed GitHub extension is missing its repository URL.");
      await host.installFromGithubRepository(extension.source.repositoryUrl, undefined, update.latestManifest);
    } else {
      await host.installFromManifestUrl(extension.manifestUrl, undefined, update.latestManifest);
    }
    setPendingUpdate(null);
    setLastManualCheckCount(null);
    await updateQuery.refetch();
  };

  return (
    <Card className="w-full min-w-0 shadow-none">
      <CardHeader className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Puzzle className="h-4 w-4 text-emerald-700" />
            {selectedPluginId ? t("plugins.details.title") : t("plugins.title")}
          </CardTitle>
          <div className="flex items-center gap-1">
            {snapshot.extensions.length > 0 ? (
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
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {updateQuery.data?.updates.length}
                  </span>
                ) : null}
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 px-2 text-slate-600">
              <a href={developerDocsUrl} target="_blank" rel="noreferrer" aria-label={t("plugins.developerDocs")}>
                <BookOpen className="h-4 w-4" />
                <span className="hidden sm:inline">{t("plugins.developerDocs")}</span>
                <ExternalLink className="hidden h-3.5 w-3.5 sm:block" />
              </a>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 pt-0 sm:px-5 sm:pb-5">
        {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div> : null}

        {selectedPluginId ? (
          selectedExtension ? (
            <PluginDetailView
              extension={selectedExtension}
              host={host}
              update={updateQuery.data?.updates.find((update) => update.pluginId === selectedExtension.manifest.id)}
              commands={snapshot.commands.filter((command) => command.pluginId === selectedExtension.manifest.id)}
              panels={snapshot.panels.filter((panel) => panel.pluginId === selectedExtension.manifest.id)}
              pendingId={pendingId}
              onToggle={(enabled) => void run(selectedExtension.manifest.id, () => host.setEnabled(selectedExtension.manifest.id, enabled))}
              onUpdate={() => {
                const update = updateQuery.data?.updates.find((candidate) => candidate.pluginId === selectedExtension.manifest.id);
                if (update) setPendingUpdate(update);
              }}
              onRunCommand={(command) => void run(
                `${selectedExtension.manifest.id}:${command.id}`,
                () => host.runCommand(selectedExtension.manifest.id, command.id),
              )}
              onOpenPanel={setActivePanel}
              onUninstall={() => void run(`remove:${selectedExtension.manifest.id}`, async () => {
                await host.uninstall(selectedExtension.manifest.id);
                onClosePlugin?.();
              })}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              {t("plugins.details.notFound")}
            </div>
          )
        ) : (
          <>
        {(marketplaceQuery.data?.entries.length ?? 0) > 0 ? (
          <div className="grid gap-2 md:grid-cols-2">
            {(marketplaceQuery.data?.entries ?? []).map((entry) => {
              const installed = snapshot.extensions.find((extension) => extension.manifest.id === entry.id);
              const currentVerified = installed?.source.verified && installed.manifest.version === entry.verification.version;
              const marketplaceUpdate = updateQuery.data?.updates.find((update) => update.pluginId === entry.id && update.marketplaceEntry);
              const actionId = `marketplace:${entry.id}`;
              return (
                <article key={entry.id} className="flex min-w-0 flex-col rounded-lg border border-emerald-100 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-slate-900">{entry.name}</span>
                          <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-label={t("plugins.marketplace.verified")} />
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-400">{entry.author} · {entry.category} · v{entry.verification.version}</div>
                      </div>
                      <a
                        href={entry.repositoryUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70"
                        aria-label={t("plugins.marketplace.openRepository", { name: entry.name })}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{entry.description}</p>
                    <Button
                      size="sm"
                      variant={currentVerified ? "soft" : "outline"}
                      className="mt-3 h-8 gap-1.5 text-xs"
                      disabled={Boolean(currentVerified) || pendingId === actionId || Boolean(installed?.source.kind === "marketplace" && !marketplaceUpdate)}
                      onClick={() => {
                        if (marketplaceUpdate) {
                          setPendingUpdate(marketplaceUpdate);
                          return;
                        }
                        void run(actionId, async () => { await host.installMarketplaceEntry(entry); });
                      }}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {pendingId === actionId
                        ? t("plugins.installing")
                        : marketplaceUpdate
                          ? t("plugins.updates.update")
                          : currentVerified
                          ? t("plugins.marketplace.installed")
                          : installed
                            ? t("plugins.marketplace.installVerified")
                            : t("plugins.install")}
                    </Button>
                </article>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label={t("plugins.installSource")}
            value={manifestUrl}
            onChange={(event) => setManifestUrl(event.target.value)}
            placeholder={t("plugins.sourcePlaceholder")}
          />
          <Button className="gap-1.5 sm:shrink-0" disabled={installing || !manifestUrl.trim()} onClick={() => void install()}>
            <Download className="h-4 w-4" />
            {installing ? t("plugins.installing") : t("plugins.install")}
          </Button>
        </div>

        {snapshot.extensions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">
            {t("plugins.empty")}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {snapshot.extensions.map((extension) => {
              const id = extension.manifest.id;
              const availableUpdate = updateQuery.data?.updates.find((update) => update.pluginId === id);
              const commands = snapshot.commands.filter((command) => command.pluginId === id);
              const panels = snapshot.panels.filter((panel) => panel.pluginId === id);
              return (
                <section
                  key={id}
                  role="link"
                  tabIndex={0}
                  aria-label={t("plugins.details.open", { name: extension.manifest.name })}
                  className="flex min-w-0 cursor-pointer flex-col rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-emerald-300 hover:bg-emerald-50/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button, a")) return;
                    onOpenPlugin?.(id);
                  }}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onOpenPlugin?.(id);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-slate-900">{extension.manifest.name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {extension.manifest.type}
                        </span>
                        <span className="text-[11px] text-slate-400">v{extension.manifest.version}</span>
                        {availableUpdate ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            {t("plugins.updates.available", { version: availableUpdate.latestVersion })}
                          </span>
                        ) : null}
                        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${extension.source.verified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                          {extension.source.verified ? <BadgeCheck className="h-3 w-3" /> : extension.source.kind === "github" ? <GitHubMark className="h-3 w-3" /> : null}
                          {t(`plugins.sources.${extension.source.verified ? "verified" : extension.source.kind}`)}
                        </span>
                      </div>
                      {extension.manifest.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{extension.manifest.description}</p> : null}
                      {extension.source.repositoryUrl ? (
                        <a className="mt-1 flex max-w-full items-center gap-1 text-[11px] text-slate-400 hover:text-emerald-700" href={extension.source.repositoryUrl} target="_blank" rel="noreferrer">
                          <GitHubMark className="h-3 w-3 shrink-0" />
                          <span className="truncate">{extension.source.repositoryUrl.replace("https://github.com/", "")}</span>
                        </a>
                      ) : null}
                    </div>
                    <Switch
                      aria-label={t("plugins.toggle", { name: extension.manifest.name })}
                      checked={extension.enabled}
                      disabled={pendingId === id}
                      onCheckedChange={(enabled) => void run(id, () => host.setEnabled(id, enabled))}
                    />
                  </div>

                  {extension.manifest.type === "plugin" && extension.manifest.permissions.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {extension.manifest.permissions.slice(0, 3).map((permission) => (
                        <span key={permission} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                          {permissionLabel(permission)}
                        </span>
                      ))}
                      {extension.manifest.permissions.length > 3 ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                          +{extension.manifest.permissions.length - 3}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {extension.error ? <div className="mt-2 text-xs text-rose-600">{extension.error}</div> : null}

                  <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                    {availableUpdate ? (
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        disabled={pendingId === `update:${id}`}
                        onClick={() => setPendingUpdate(availableUpdate)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("plugins.updates.update")}
                      </Button>
                    ) : null}
                    {commands.map((command) => (
                      <Button
                        key={command.id}
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        disabled={pendingId === `${id}:${command.id}`}
                        onClick={() => void run(`${id}:${command.id}`, () => host.runCommand(id, command.id))}
                      >
                        <Play className="h-3.5 w-3.5" />
                        {command.title}
                      </Button>
                    ))}
                    {panels.map((panel) => (
                      <Button
                        key={panel.id}
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => setActivePanel(panel)}
                      >
                        <PanelRightOpen className="h-3.5 w-3.5" />
                        {panel.title}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-8 gap-1.5 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      disabled={pendingId === `remove:${id}`}
                      onClick={() => void run(`remove:${id}`, () => host.uninstall(id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t("plugins.uninstall")}
                    </Button>
                  </div>
                </section>
              );
            })}
          </div>
        )}
          </>
        )}

        <PluginPanelDialog host={host} panel={activePanel} onClose={() => setActivePanel(null)} />
        {pendingUpdate ? (
          <PluginUpdateDialog
            update={pendingUpdate}
            isUpdating={pendingId === `update:${pendingUpdate.pluginId}`}
            onCancel={() => setPendingUpdate(null)}
            onConfirm={() => void run(`update:${pendingUpdate.pluginId}`, () => applyUpdate(pendingUpdate))}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
