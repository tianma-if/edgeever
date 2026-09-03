import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clock3, Loader2, ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import { ExecutionHistoryItemCard, type ExecutionHistoryItem } from "./ExecutionHistoryItemCard";

const PAGE_SIZE = 20;

export const ExecutionCenterPane = ({
  currentDeviceId,
  onClose,
}: {
  currentDeviceId: string | null;
  onClose(): void;
}) => {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;
  const historyQuery = useQuery({
    queryKey: ["scheduled-task-run-history", page],
    queryFn: () => api.listScheduledTaskRunHistory(offset, PAGE_SIZE),
    refetchInterval: 15_000,
  });
  const totalCount = historyQuery.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const items: ExecutionHistoryItem[] = (historyQuery.data?.runs ?? []).map((run) => ({
    id: run.id,
    title: run.taskName,
    subtitle: t("executionHistory.pluginSchedule", {
      plugin: run.ownerPluginId ?? run.pluginId,
      key: run.pluginScheduleKey ?? run.taskId,
    }),
    status: run.status,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    executorId: run.executorDeviceId,
    errorMessage: run.errorMessage,
  }));
  const rangeStart = totalCount === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + items.length, totalCount);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-slate-50">
      <header className="flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-end justify-between gap-3 border-b border-slate-200 bg-white px-4 pb-3 pt-[env(safe-area-inset-top)] lg:h-16 lg:items-center lg:px-6 lg:pb-0 lg:pt-0">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t("common.back")}
            title={t("common.back")}
            className="h-9 w-9 rounded-lg hover:bg-slate-100"
            onClick={onClose}
          >
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </Button>
          <div className="min-w-0">
            <h1 className={`flex items-center gap-2 text-slate-900 ${WORKSPACE_PAGE_TITLE_CLASSNAME}`}>
              <ScrollText className="h-4.5 w-4.5 shrink-0 text-emerald-700" />
              <span className="truncate">{t("executionHistory.centerTitle")}</span>
            </h1>
            <p className="mt-0.5 hidden truncate text-xs text-slate-500 sm:block">
              {t("executionHistory.centerDescription")}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-500">
          {t("executionHistory.total", { count: totalCount })}
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:py-7">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col">
          {historyQuery.isPending ? (
            <div className="flex min-h-56 items-center justify-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" aria-label={t("executionHistory.loading")} />
            </div>
          ) : historyQuery.isError ? (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              <p>{historyQuery.error instanceof Error ? historyQuery.error.message : t("executionHistory.loadFailed")}</p>
              <Button className="mt-3" size="sm" variant="outline" onClick={() => void historyQuery.refetch()}>
                {t("executionHistory.retry")}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white text-center text-slate-400">
              <Clock3 className="h-7 w-7" />
              <p className="text-sm">{t("executionHistory.empty")}</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {items.map((item) => (
                <ExecutionHistoryItemCard key={item.id} item={item} currentExecutorId={currentDeviceId} />
              ))}
            </div>
          )}

          {!historyQuery.isPending && !historyQuery.isError && totalCount > 0 ? (
            <nav className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-6" aria-label={t("executionHistory.pagination")}>
              <p className="text-xs text-slate-500">
                {t("executionHistory.range", { start: rangeStart, end: rangeEnd, total: totalCount })}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t("executionHistory.previousPage")}
                </Button>
                <span className="min-w-20 text-center text-xs font-medium text-slate-600">
                  {t("executionHistory.page", { page, total: totalPages })}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  {t("executionHistory.nextPage")}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      </main>
    </div>
  );
};
