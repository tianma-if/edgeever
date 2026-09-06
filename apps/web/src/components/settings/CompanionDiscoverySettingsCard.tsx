import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Sparkles, ShieldCheck, ChevronRight, Clock, Activity, MessageSquareText } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  SETTINGS_CARD_DESCRIPTION_CLASSNAME,
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";
import { Switch } from "@/components/ui/switch";
import { api, ApiRequestError } from "@/lib/api";
import { discoveryFeedKey, discoverySettingsKey, useCompanionDiscoverySettings } from "@/hooks/useCompanionDiscovery";

export function CompanionDiscoverySettingsCard({ scope, onOpenCompanion, onOpenAiSettings }: {
  scope: string; onOpenCompanion: () => void; onOpenAiSettings: () => void;
}) {
  const { t, i18n } = useTranslation();
  const query = useCompanionDiscoverySettings(scope);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"settings" | "model" | null>(null);
  const settings = query.data;
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const aiQuery = useQuery({ queryKey: ["ai-settings", locale], queryFn: () => api.getAiSettings(locale), staleTime: 60_000 });
  const aiSettings = aiQuery.data;
  const defaultModelReady = Boolean(aiSettings?.encryptionConfigured && aiSettings.providers.some(provider =>
    provider.isEnabled && provider.models.some(model => model.id === aiSettings.defaultModelId)));
  const enabled = settings?.enabled === true;
  const feed = useQuery({
    queryKey: discoveryFeedKey(scope),
    queryFn: async () => (await api.listCompanionDiscoveries()).items,
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  const latest = feed.data?.[0];
  const formatTime = (value: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

  const save = async (enabled: boolean, preferences?: { learningEnabled?: boolean; useMemory?: boolean }) => {
    if (!settings || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (enabled && !settings.enabled) {
        const current = aiSettings ?? (await aiQuery.refetch()).data;
        const ready = Boolean(current?.encryptionConfigured && current.providers.some(provider =>
          provider.isEnabled && provider.models.some(model => model.id === current.defaultModelId)));
        if (!ready) { setError("model"); return; }
      }
      const result = await api.saveCompanionDiscoverySettings({ enabled, version: settings.version, ...preferences });
      client.setQueryData(discoverySettingsKey(scope), result.settings);
      client.setQueryData(discoveryFeedKey(scope), []);
    } catch (cause) {
      setError(cause instanceof ApiRequestError && cause.code?.startsWith("ai_") ? "model" : "settings");
      await query.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-none">
      <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2">
              <CardTitle className={SETTINGS_CARD_TITLE_CLASSNAME}>
                <Sparkles className={SETTINGS_CARD_ICON_CLASSNAME} />
                {t("companion.discovery.settingsTitle")}
              </CardTitle>
              <span className="inline-flex items-center rounded-full border border-emerald-200/80 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-300">
                Beta
              </span>
            </div>
            <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>
              {t("companion.discovery.description")}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 sm:pt-0.5">
            <label
              htmlFor="companion-discovery-enabled"
              className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              {t("companion.discovery.enable")}
            </label>
            <Switch
              id="companion-discovery-enabled"
              checked={settings?.enabled ?? false}
              disabled={busy || !settings}
              onCheckedChange={(enabled) => void save(enabled)}
            />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 rounded-md bg-emerald-50/80 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <span className="text-sm leading-none" aria-hidden="true">🐾</span>
          <p className="font-medium text-emerald-700 dark:text-emerald-300">{t("companion.discovery.tagline")}</p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-4 pb-5 sm:px-5">
        {error === "settings" || query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("companion.discovery.settingsFailed")}
          </p>
        ) : null}
        {error === "model" || (aiSettings && !defaultModelReady) ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
            <p role="alert" className="text-sm text-amber-900 dark:text-amber-200">{t("companion.discovery.modelRequired")}</p>
            <button type="button" onClick={onOpenAiSettings}
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {t("companion.discovery.configureModel")}
            </button>
          </div>
        ) : null}

        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm text-slate-500">{t("companion.learning.help")}</p>
          {(["learningEnabled", "useMemory"] as const).map(key => <div key={key} className="flex items-center justify-between gap-3">
            <label htmlFor={`paw-${key}`} className="text-sm">{t(`companion.learning.${key}`)}</label>
            <Switch id={`paw-${key}`} checked={settings?.[key] ?? false} disabled={busy || !settings}
              onCheckedChange={value => void save(enabled, { [key]: value })} />
          </div>)}
        </div>
        <section
          className="space-y-3 rounded-lg border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          aria-labelledby="companion-discovery-status-title"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-200/60 pb-3 dark:border-slate-800/60">
            <h3
              id="companion-discovery-status-title"
              className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100"
            >
              <Activity className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              {t("companion.discovery.transparency.title")}
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                enabled
                  ? settings?.lastStatus === "failed"
                    ? "border border-rose-200/80 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300"
                    : settings?.lastStatus === "running"
                    ? "border border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300"
                    : "border border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
              }`}
              role="status"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  enabled
                    ? settings?.lastStatus === "failed"
                      ? "bg-rose-500"
                      : settings?.lastStatus === "running"
                      ? "animate-pulse bg-amber-500"
                      : "bg-emerald-500"
                    : "bg-slate-400"
                }`}
              />
              {t(`companion.discovery.transparency.state.${enabled ? settings?.lastStatus ?? "quiet" : "disabled"}`)}
            </span>
          </div>

          <dl className="space-y-2.5 text-xs sm:text-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <dt className="flex items-center gap-1.5 font-medium text-slate-500 dark:text-slate-400">
                <Clock className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                {t("companion.discovery.transparency.lastCheck")}
              </dt>
              <dd className="font-medium text-slate-800 dark:text-slate-200">
                {settings?.lastCheckAt ? formatTime(settings.lastCheckAt) : t("companion.discovery.transparency.neverChecked")}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <dt className="flex shrink-0 items-center gap-1.5 font-medium text-slate-500 dark:text-slate-400">
                <Sparkles className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                {t("companion.discovery.transparency.nextCheck")}
              </dt>
              <dd className="text-xs leading-relaxed text-slate-600 sm:max-w-md sm:text-right dark:text-slate-300">
                {t(enabled ? "companion.discovery.transparency.nextCheckEnabled" : "companion.discovery.transparency.nextCheckDisabled")}
              </dd>
            </div>
          </dl>

          <div className="flex items-start gap-2 border-t border-slate-200/60 pt-2.5 dark:border-slate-800/60">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {t("companion.discovery.transparency.scope")}
            </p>
          </div>
        </section>

        {enabled ? (
          <section className="space-y-3" aria-labelledby="companion-latest-discovery-title">
            <h3
              id="companion-latest-discovery-title"
              className="text-sm font-medium text-slate-900 dark:text-slate-100"
            >
              {t("companion.discovery.transparency.latest")}
            </h3>
            {feed.isPending ? <p role="status" className="text-sm text-slate-500">{t("common.loading")}</p> : null}
            {feed.isError ? <p role="alert" className="text-sm text-destructive">{t("companion.discovery.loadFailed")}</p> : null}
            {!feed.isPending && !feed.isError && !latest ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200/80 bg-white px-4 py-6 text-center dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                  <Sparkles className="h-4 w-4" />
                </div>
                <p className="max-w-md text-xs text-slate-500 sm:text-sm dark:text-slate-400">
                  {t("companion.discovery.transparency.noDiscovery")}
                </p>
              </div>
            ) : null}
            {latest ? (
              <article className="space-y-2.5 rounded-lg border border-slate-200/80 bg-white p-4 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    {t(`companion.discovery.kind.${latest.kind}`)}
                  </span>
                  <time className="text-xs text-slate-400 dark:text-slate-500" dateTime={latest.createdAt}>
                    {formatTime(latest.createdAt)}
                  </time>
                </div>
                <h4 className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{latest.title}</h4>
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600 sm:text-sm dark:text-slate-300">
                  {latest.body}
                </p>
              </article>
            ) : null}
          </section>
        ) : null}

        <div className="pt-1">
          <button
            type="button"
            onClick={onOpenCompanion}
            className="group flex w-full items-center justify-between rounded-lg border border-slate-200/80 bg-white p-3.5 text-left transition-all hover:border-emerald-300 hover:bg-emerald-50/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700/60 dark:hover:bg-emerald-950/20"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200/60 bg-slate-50 text-emerald-600 shadow-sm transition-colors group-hover:border-emerald-200 group-hover:bg-emerald-50 group-hover:text-emerald-700 dark:border-slate-800 dark:bg-slate-800 dark:text-emerald-400">
                <MessageSquareText className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 transition-colors group-hover:text-emerald-800 dark:text-slate-100 dark:group-hover:text-emerald-300">
                  {t("companion.discovery.openCompanion")}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {t("companion.discovery.openCompanionDesc")}
                </div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-600 dark:text-slate-500 dark:group-hover:text-emerald-400" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
