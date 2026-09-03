import { AlertCircle, CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export type ExecutionHistoryStatus = "running" | "succeeded" | "failed";

export interface ExecutionHistoryItem {
  id: string;
  title?: string;
  subtitle?: string;
  status: ExecutionHistoryStatus;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string | null;
  executorId: string;
  errorMessage: string | null;
}

const formatDuration = (startedAt: string, finishedAt: string | null, runningLabel: string) => {
  if (!finishedAt) return runningLabel;
  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return "—";
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
};

const statusIcon = {
  running: Loader2,
  succeeded: CheckCircle2,
  failed: AlertCircle,
} satisfies Record<ExecutionHistoryStatus, typeof Clock3>;

const statusClassName: Record<ExecutionHistoryStatus, string> = {
  running: "bg-amber-50 text-amber-700",
  succeeded: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
};

export const ExecutionHistoryItemCard = ({
  item,
  currentExecutorId,
}: {
  item: ExecutionHistoryItem;
  currentExecutorId?: string | null;
}) => {
  const { t } = useTranslation();
  const StatusIcon = statusIcon[item.status];
  const executorLabel = currentExecutorId && item.executorId === currentExecutorId
    ? t("executionHistory.currentDevice")
    : t("executionHistory.device", { id: item.executorId.slice(-8) });

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {item.title ? <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p> : null}
          {item.subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{item.subtitle}</p> : null}
          <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${statusClassName[item.status]}`}>
            <StatusIcon className={`h-3.5 w-3.5 ${item.status === "running" ? "animate-spin" : ""}`} />
            {t(`executionHistory.status.${item.status}`)}
          </span>
        </div>
        <span className="text-xs text-slate-400">{executorLabel}</span>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-slate-400">{t("executionHistory.scheduledFor")}</dt>
          <dd className="mt-0.5 text-slate-700">{new Date(item.scheduledFor).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-slate-400">{t("executionHistory.startedAt")}</dt>
          <dd className="mt-0.5 text-slate-700">{new Date(item.startedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-slate-400">{t("executionHistory.duration")}</dt>
          <dd className="mt-0.5 text-slate-700">
            {formatDuration(item.startedAt, item.finishedAt, t("executionHistory.running"))}
          </dd>
        </div>
      </dl>
      {item.errorMessage ? (
        <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-rose-50 p-2 font-mono text-[11px] leading-5 text-rose-700">
          {item.errorMessage}
        </pre>
      ) : null}
    </article>
  );
};
