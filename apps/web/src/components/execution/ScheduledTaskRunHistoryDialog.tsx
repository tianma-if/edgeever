import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ScheduledTask } from "@edgeever/shared";
import { api } from "@/lib/api";
import { ExecutionHistoryDialog, type ExecutionHistoryPage } from "./ExecutionHistoryDialog";

interface ScheduledTaskRunHistoryDialogProps {
  task: ScheduledTask | null;
  currentDeviceId: string | null;
  onOpenChange(open: boolean): void;
}

export const ScheduledTaskRunHistoryDialog = ({
  task,
  currentDeviceId,
  onOpenChange,
}: ScheduledTaskRunHistoryDialogProps) => {
  const { t } = useTranslation();
  const taskId = task?.id ?? null;
  const loadPage = useCallback(async (offset: number, limit: number): Promise<ExecutionHistoryPage> => {
    if (!taskId) return { items: [], totalCount: 0, nextOffset: null };
    const page = await api.listScheduledTaskRuns(taskId, offset, limit);
    return {
      items: page.runs.map((run) => ({
        id: run.id,
        status: run.status,
        scheduledFor: run.scheduledFor,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        executorId: run.executorDeviceId,
        errorMessage: run.errorMessage,
      })),
      totalCount: page.totalCount,
      nextOffset: page.nextOffset,
    };
  }, [taskId]);

  return (
    <ExecutionHistoryDialog
      open={Boolean(task)}
      onOpenChange={onOpenChange}
      title={task ? t("plugins.schedules.historyTitle", { name: task.name }) : t("plugins.schedules.history")}
      description={task
        ? t("plugins.schedules.historyDescription", { cron: task.cronExpression, timezone: task.timezone })
        : ""}
      queryKey={["scheduled-task-runs", taskId]}
      loadPage={loadPage}
      currentExecutorId={currentDeviceId}
    />
  );
};
