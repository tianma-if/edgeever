import { companionMemoryText } from "@/lib/companion-memory";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  FileText,
  PawPrint,
  Settings,
} from "lucide-react";
import type { CompanionAction, CompanionDiscoveryItem } from "@edgeever/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiRequestError } from "@/lib/api";
import { assertCompanionChangesSynced } from "@/lib/companion-actions";
import { discoveryFeedKey, discoverySettingsKey, useCompanionDiscoverySettings } from "@/hooks/useCompanionDiscovery";
import { CompanionActionCard } from "./CompanionActionCard";

const DISCOVERY_IDLE_DELAY_MS = 3 * 60_000;

export default function CompanionDiscoveryHub({ scope, onOpenNote, onNotesChanged, onOpenSettings }: {
  scope: string; onOpenNote: (id: string, notebookId: string) => void; onNotesChanged: () => Promise<void>; onOpenSettings: () => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const settings = useCompanionDiscoverySettings(scope);
  const enabled = settings.data?.enabled === true;
  const feed = useQuery({ queryKey: discoveryFeedKey(scope), queryFn: async () => (await api.listCompanionDiscoveries()).items,
    enabled, staleTime: 60_000, retry: false });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const items = feed.data ?? [];

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let attemptedSinceWorkspaceChange = false;
    const stop = new AbortController();
    const check = async () => {
      if (running || attemptedSinceWorkspaceChange || stop.signal.aborted || document.visibilityState !== "visible" || !navigator.onLine) return;
      running = true;
      try {
        await assertCompanionChangesSynced(scope);
        if (stop.signal.aborted) return;
        const result = await api.checkCompanionDiscoveries(i18n.resolvedLanguage ?? "en-US", stop.signal);
        if (!stop.signal.aborted) {
          attemptedSinceWorkspaceChange = true;
          client.setQueryData(discoveryFeedKey(scope), result.items);
        }
      } catch { /* Quiet by design; check status is visible inside the panel. */ }
      finally {
        running = false;
        if (!stop.signal.aborted) void client.invalidateQueries({ queryKey: discoverySettingsKey(scope) });
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      if (!attemptedSinceWorkspaceChange && document.visibilityState === "visible" && navigator.onLine) {
        timer = setTimeout(() => void check(), DISCOVERY_IDLE_DELAY_MS);
      }
    };
    const activityEvents = ["keydown", "pointerdown", "input", "online"];
    const workspaceChangeEvents = ["edgeever:sync-queue-changed", "edgeever:memo-detail-refreshed", "edgeever:companion-memory-changed"];
    const scheduleAfterWorkspaceChange = () => { attemptedSinceWorkspaceChange = false; schedule(); };
    activityEvents.forEach(name => window.addEventListener(name, schedule));
    workspaceChangeEvents.forEach(name => window.addEventListener(name, scheduleAfterWorkspaceChange));
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      clearTimeout(timer); stop.abort();
      activityEvents.forEach(name => window.removeEventListener(name, schedule));
      workspaceChangeEvents.forEach(name => window.removeEventListener(name, scheduleAfterWorkspaceChange));
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [enabled, settings.data?.version, scope, i18n.resolvedLanguage, client]);

  const perform = async (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    try { await work(); }
    catch (cause) {
      setError(t(cause instanceof ApiRequestError && cause.code === "companion_action_unsynced"
        ? "companion.actions.unsynced" : "companion.discovery.actionFailed"));
    } finally {
      await feed.refetch(); locked.current = false; setBusy(false);
    }
  };
  const apply = (action: CompanionAction) => void perform(async () => {
    await assertCompanionChangesSynced(scope);
    const result = await api.applyCompanionAction(action.id);
    // Persisted receipts remain visible even if local refresh fails.
    client.setQueryData<CompanionDiscoveryItem[]>(discoveryFeedKey(scope), current => current?.map(item => item.action?.id === action.id ? { ...item, action: result.action } : item));
    await onNotesChanged();
  });
  const dismiss = (item: CompanionDiscoveryItem) => void perform(async () => { await api.acknowledgeCompanionDiscovery(item.id, true); });
  const openNote = (id: string, notebookId: string) => { setOpen(false); onOpenNote(id, notebookId); };
  if (!enabled) return null;
  return <>
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="relative h-8 w-8 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-emerald-500/70"
            aria-label={t("companion.discovery.title")} onClick={() => { setOpen(true); void feed.refetch(); }}>
            <PawPrint className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
            {items.some(item => !item.seen && item.action?.status !== "applied") ? <span aria-label={t("companion.discovery.unread")} className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" /> : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("companion.discovery.title")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="grid max-h-[min(760px,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-100 px-5 py-4 text-left dark:border-slate-800">
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-500/20 dark:bg-emerald-950/50 dark:text-emerald-400 dark:ring-emerald-500/30">
                <PawPrint className="h-4 w-4" strokeWidth={2.5} />
              </div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t("companion.discovery.title")}
                </DialogTitle>
                {items.length > 0 ? (
                  <Badge variant="outline" className="border-emerald-600/20 bg-emerald-50 px-2 font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300">
                    {items.length}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 space-y-3.5 overflow-y-auto px-5 py-4">
          {error ? (
            <Alert variant="destructive" className="p-2.5">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : null}
          {feed.isError ? (
            <Alert variant="destructive" className="p-2.5">
              <AlertDescription className="text-xs">{t("companion.discovery.loadFailed")}</AlertDescription>
            </Alert>
          ) : null}
          {!feed.isPending && !feed.isError && !items.length ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-400 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-500 dark:ring-slate-800">
                <PawPrint className="h-6 w-6 stroke-[1.5]" />
              </div>
              <p className="max-w-xs text-sm font-medium text-slate-600 dark:text-slate-300">
                {t("companion.discovery.empty")}
              </p>
            </div>
          ) : null}
          {items.map(item => <DiscoveryCard key={item.id} item={item} busy={busy} open={open}
            onFeedback={() => void perform(async () => { await api.rememberCompanionDiscoveryFeedback(item.id); window.dispatchEvent(new Event("edgeever:companion-memory-changed")); })}
            onApply={apply} onDismiss={() => dismiss(item)} onOpenNote={openNote}
            onSeen={() => { void api.acknowledgeCompanionDiscovery(item.id).then(() => client.setQueryData<CompanionDiscoveryItem[]>(discoveryFeedKey(scope),
              current => current?.map(entry => entry.id === item.id ? { ...entry, seen: true } : entry))).catch(() => {}); }} />)}
        </div>
        <div className="flex justify-end border-t border-slate-100 bg-slate-50/50 px-5 py-2.5 dark:border-slate-800 dark:bg-slate-900/50">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            onClick={() => { setOpen(false); onOpenSettings(); }}
          >
            <Settings className="h-3.5 w-3.5" />
            {t("companion.settings")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

function DiscoveryCard({ item, busy, open, onApply, onDismiss, onOpenNote, onSeen, onFeedback }: {
  item: CompanionDiscoveryItem; busy: boolean; open: boolean; onApply: (action: CompanionAction) => void;
  onFeedback: () => void; onDismiss: () => void; onOpenNote: (id: string, notebookId: string) => void; onSeen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const seenCallback = useRef(onSeen); seenCallback.current = onSeen;
  useEffect(() => {
    if (!open || item.seen || !ref.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { seenCallback.current(); observer.disconnect(); }
    }, { threshold: 0.1 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [open, item.seen]);

  const formattedDate = item.createdAt
    ? new Date(item.createdAt).toLocaleDateString(i18n.resolvedLanguage?.startsWith("zh") ? "zh-CN" : "en-US", {
        month: "numeric",
        day: "numeric",
      })
    : null;

  return (
    <article ref={ref}>
      <Card className="group relative flex flex-col gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition-all hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700">
      <CardHeader className="flex-row items-start justify-between gap-3 p-0">
        <div className="min-w-0">
          <CardTitle className="line-clamp-1 break-words text-sm leading-snug text-slate-900 dark:text-slate-100">
            {item.title}
          </CardTitle>
        </div>
        {formattedDate ? (
          <time className="shrink-0 pt-0.5 font-mono text-[11px] text-slate-400 dark:text-slate-500">
            {formattedDate}
          </time>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        {item.action?.status === "pending" ? <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">{t("companion.learning.feedback")}</summary>
          <p className="my-2">{t("companion.learning.feedbackHelp")}</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={onFeedback}>{t("companion.learning.feedback")}</Button>
        </details> : null}
        {item.memories?.length ? <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">{t("companion.learning.basedOn")}</summary>
          <ul className="mt-2 space-y-1">{item.memories.map(memory => <li key={memory.id}>{companionMemoryText(memory, t)}</li>)}</ul>
        </details> : null}
        {!item.action ? (
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600 sm:text-sm dark:text-slate-300">
            {item.body}
          </p>
        ) : null}
        {item.kind === "append" ? (
          <p className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-2.5 text-xs leading-relaxed text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-400">
            {t("companion.discovery.appendHelp")}
          </p>
        ) : null}
        {item.action ? (
          <CompanionActionCard
            action={item.action}
            busy={busy}
            onApply={onApply}
            onDismiss={onDismiss}
            onOpenNote={onOpenNote}
          />
        ) : item.sources.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {item.sources.map(source => (
              <Button
                key={source.id}
                size="sm"
                variant="outline"
                onClick={() => onOpenNote(source.id, source.notebookId)}
                className="group/btn h-7 max-w-full gap-1.5 bg-slate-50/70 px-2.5 text-xs text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300"
              >
                <FileText className="h-3 w-3 shrink-0 text-slate-400 group-hover/btn:text-emerald-600 dark:group-hover/btn:text-emerald-400" />
                <span className="max-w-[260px] truncate">{source.title || t("common.untitledMemo")}</span>
                <ArrowUpRight className="h-3 w-3 shrink-0 opacity-40 group-hover/btn:opacity-100" />
              </Button>
            ))}
          </div>
        ) : null}
      </CardContent>
      {!item.action ? (
        <CardFooter className="justify-end border-t border-slate-100 p-0 pt-2.5 dark:border-slate-800/80">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onDismiss}
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            {t("companion.discovery.dismiss")}
          </Button>
        </CardFooter>
      ) : null}
      </Card>
    </article>
  );
}
