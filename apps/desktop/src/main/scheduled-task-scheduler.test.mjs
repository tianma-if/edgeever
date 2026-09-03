import { describe, expect, test } from "bun:test";
import { ScheduledTaskScheduler, scheduledOccurrenceBefore } from "./scheduled-task-scheduler.mjs";

const baseTask = {
  id: "scheduled_task_1",
  cronExpression: "0 * * * *",
  timezone: "Asia/Shanghai",
  isEnabled: true,
  missedRunPolicy: "run-once",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastRun: null,
};

describe("scheduled desktop task scheduler", () => {
  test("calculates a stable planned occurrence instead of using callback wall time", () => {
    const previousRuns = (count, referenceDate) => {
      expect(count).toBe(1);
      expect(referenceDate.toISOString()).toBe("2026-09-02T04:27:43.000Z");
      return [new Date("2026-09-02T04:00:00.000Z")];
    };
    expect(scheduledOccurrenceBefore({ previousRuns }, new Date("2026-09-02T04:27:42.000Z"))?.toISOString())
      .toBe("2026-09-02T04:00:00.000Z");
  });

  test("coalesces missed occurrences into one run and never retries it in memory", async () => {
    const runs = [];
    const scheduler = new ScheduledTaskScheduler({
      now: () => new Date("2026-09-02T04:27:42.000Z"),
      onRun: async (_task, scheduledFor) => runs.push(scheduledFor.toISOString()),
    });
    await scheduler.reconcile([baseTask]);
    await scheduler.runMissedOccurrences();
    expect(runs).toEqual(["2026-09-02T04:00:00.000Z"]);
    scheduler.clear();
  });

  test("does not replay missed occurrences when policy is skip", async () => {
    const runs = [];
    const scheduler = new ScheduledTaskScheduler({
      now: () => new Date("2026-09-02T04:27:42.000Z"),
      onRun: async (_task, scheduledFor) => runs.push(scheduledFor.toISOString()),
    });
    await scheduler.reconcile([{ ...baseTask, missedRunPolicy: "skip" }]);
    expect(runs).toEqual([]);
    scheduler.clear();
  });

  test("replaces changed schedules and stops removed tasks", async () => {
    const stopped = [];
    class FakeCron {
      constructor(pattern) {
        this.pattern = pattern;
      }
      previousRuns() { return []; }
      stop() { stopped.push(this.pattern); }
    }
    const scheduler = new ScheduledTaskScheduler({ onRun: async () => {}, CronClass: FakeCron });
    await scheduler.reconcile([baseTask]);
    await scheduler.reconcile([{ ...baseTask, cronExpression: "30 * * * *", updatedAt: "2026-09-02T00:00:00.000Z" }]);
    await scheduler.reconcile([]);
    expect(stopped).toEqual(["0 * * * *", "30 * * * *"]);
  });
});
