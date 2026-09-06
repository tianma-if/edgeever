import { Cron } from "croner";

const taskFingerprint = (task) => [
  task.id,
  task.cronExpression,
  task.timezone,
  task.isEnabled ? "1" : "0",
  task.updatedAt,
].join("\0");

export const scheduledOccurrenceBefore = (job, referenceDate = new Date()) =>
  job.previousRuns(1, new Date(referenceDate.getTime() + 1_000))[0] ?? null;

const isValidTask = (task) => Boolean(
  task
  && typeof task.id === "string"
  && typeof task.cronExpression === "string"
  && typeof task.timezone === "string"
  && typeof task.createdAt === "string"
  && (task.missedRunPolicy === "run-once" || task.missedRunPolicy === "skip"),
);

export class ScheduledTaskScheduler {
  constructor({ onRun, onError = () => {}, now = () => new Date(), CronClass = Cron }) {
    this.onRun = onRun;
    this.onError = onError;
    this.now = now;
    this.CronClass = CronClass;
    this.entries = new Map();
    this.attemptedOccurrences = new Set();
  }

  async reconcile(tasks) {
    const eligibleTasks = Array.isArray(tasks) ? tasks.filter((task) => isValidTask(task) && task.isEnabled) : [];
    const eligibleIds = new Set(eligibleTasks.map((task) => task.id));
    for (const [taskId, entry] of this.entries) {
      if (eligibleIds.has(taskId)) continue;
      entry.job.stop();
      this.entries.delete(taskId);
    }

    for (const task of eligibleTasks) {
      const fingerprint = taskFingerprint(task);
      const current = this.entries.get(task.id);
      if (!current || current.fingerprint !== fingerprint) {
        current?.job.stop();
        try {
          const job = new this.CronClass(task.cronExpression, {
            timezone: task.timezone,
            protect: true,
            catch: (error) => this.onError(error, task),
          }, async (activeJob) => {
            const scheduledFor = scheduledOccurrenceBefore(activeJob, this.now());
            if (scheduledFor) await this.runOccurrence(task, scheduledFor);
          });
          this.entries.set(task.id, { fingerprint, job, task });
        } catch (error) {
          this.onError(error, task);
          continue;
        }
      } else {
        current.task = task;
      }
    }

    await this.runMissedOccurrences();
  }

  async runMissedOccurrences() {
    const referenceDate = this.now();
    for (const { job, task } of this.entries.values()) {
      if (task.missedRunPolicy !== "run-once") continue;
      const scheduledFor = scheduledOccurrenceBefore(job, referenceDate);
      const activeSince = Math.max(new Date(task.createdAt).getTime(), new Date(task.updatedAt).getTime());
      if (!scheduledFor || scheduledFor.getTime() < activeSince) continue;
      const lastScheduledAt = task.lastRun?.scheduledFor ? new Date(task.lastRun.scheduledFor).getTime() : 0;
      if (lastScheduledAt >= scheduledFor.getTime()) continue;
      await this.runOccurrence(task, scheduledFor);
    }
  }

  async runOccurrence(task, scheduledFor) {
    const occurrenceKey = `${task.id}\0${scheduledFor.toISOString()}`;
    if (this.attemptedOccurrences.has(occurrenceKey)) return;
    this.attemptedOccurrences.add(occurrenceKey);
    if (this.attemptedOccurrences.size > 10_000) {
      this.attemptedOccurrences.delete(this.attemptedOccurrences.values().next().value);
    }
    try {
      await this.onRun(task, scheduledFor);
    } catch (error) {
      this.onError(error, task);
    }
  }

  clear() {
    for (const { job } of this.entries.values()) job.stop();
    this.entries.clear();
    this.attemptedOccurrences.clear();
  }
}
