import type { PluginSchedule, PluginScheduleInput } from "@edgeever/plugin-api";
import type { ScheduledTask } from "@edgeever/shared";
import { api } from "@/lib/api";
import type { PluginScheduleAdapter } from "@/lib/plugins/plugin-host";

const toPluginSchedule = (task: ScheduledTask, deviceId: string): PluginSchedule => ({
  key: task.pluginScheduleKey ?? "",
  name: task.name,
  commandId: task.taskPayload.commandId,
  cronExpression: task.cronExpression,
  timezone: task.timezone,
  missedRunPolicy: task.missedRunPolicy,
  isEnabled: task.isEnabled,
  runsOnThisDevice: task.executorDeviceId === deviceId,
  lastRun: task.lastRun ? {
    status: task.lastRun.status,
    scheduledFor: task.lastRun.scheduledFor,
    startedAt: task.lastRun.startedAt,
    finishedAt: task.lastRun.finishedAt,
    errorMessage: task.lastRun.errorMessage,
  } : null,
});

export const createPluginScheduleAdapter = (
  deviceId: string,
  onChanged: () => void | Promise<void>,
): PluginScheduleAdapter => ({
  async upsert(pluginId: string, input: PluginScheduleInput) {
    const { task } = await api.upsertPluginScheduledTask({
      pluginId,
      scheduleKey: input.key,
      name: input.name,
      commandId: input.commandId,
      cronExpression: input.cronExpression,
      timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      executorDeviceId: deviceId,
      missedRunPolicy: input.missedRunPolicy ?? "run-once",
      isEnabled: input.isEnabled,
    });
    await onChanged();
    return toPluginSchedule(task, deviceId);
  },
  async list(pluginId: string) {
    const { tasks } = await api.listPluginScheduledTasks(pluginId);
    return tasks.map((task) => toPluginSchedule(task, deviceId));
  },
  async remove(pluginId: string, key: string) {
    await api.deletePluginScheduledTask(pluginId, key);
    await onChanged();
  },
});
