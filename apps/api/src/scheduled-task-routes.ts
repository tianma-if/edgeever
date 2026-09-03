import {
  ScheduledTaskClaimSchema,
  ScheduledTaskCreateSchema,
  ScheduledTaskFinishSchema,
  PluginScheduleUpsertSchema,
  ScheduledTaskUpdateSchema,
  type ScheduledPluginCommandPayload,
  type ScheduledTask,
  type ScheduledTaskRun,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import { Cron } from "croner";
import type { Hono } from "hono";
import { audit } from "./audit";
import type { AppEnv } from "./api-context";
import { createId, isoNow } from "./entity-utils";
import { badRequest, conflict, notFound } from "./http-errors";
import { getAuditActor, getWorkspaceId, requireUser } from "./request-auth";
import type { DatabaseAdapter } from "./storage-contract";

type ScheduledTaskRow = {
  id: string;
  name: string;
  task_type: "plugin-command";
  task_payload_json: string;
  owner_plugin_id: string | null;
  plugin_schedule_key: string | null;
  cron_expression: string;
  timezone: string;
  executor_device_id: string;
  missed_run_policy: "run-once" | "skip";
  is_enabled: number;
  created_at: string;
  updated_at: string;
  run_id: string | null;
  run_scheduled_for: string | null;
  run_executor_device_id: string | null;
  run_status: "running" | "succeeded" | "failed" | null;
  run_error_message: string | null;
  run_started_at: string | null;
  run_finished_at: string | null;
};

type ScheduledTaskRunRow = {
  id: string;
  task_id: string;
  scheduled_for: string;
  executor_device_id: string;
  status: "running" | "succeeded" | "failed";
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
};

type ScheduledTaskRunHistoryRow = ScheduledTaskRunRow & {
  task_name: string;
  task_payload_json: string;
  owner_plugin_id: string | null;
  plugin_schedule_key: string | null;
};

const SCHEDULED_TASK_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

const pruneExpiredScheduledTaskRuns = async (
  db: DatabaseAdapter,
  workspaceId: string,
  now = Date.now(),
) => {
  const cutoff = new Date(now - SCHEDULED_TASK_RUN_RETENTION_MS).toISOString();
  await db.prepare(
    "DELETE FROM scheduled_task_runs WHERE workspace_id = ? AND started_at < ?",
  ).bind(workspaceId, cutoff).run();
};

const parseTaskPayload = (json: string): ScheduledPluginCommandPayload => {
  try {
    const value = JSON.parse(json) as Partial<ScheduledPluginCommandPayload>;
    return {
      pluginId: typeof value.pluginId === "string" ? value.pluginId : "",
      commandId: typeof value.commandId === "string" ? value.commandId : "",
    };
  } catch {
    return { pluginId: "", commandId: "" };
  }
};

const validateSchedule = (cronExpression: string, timezone: string) => {
  let validator: Cron | null = null;
  try {
    validator = new Cron(cronExpression, { timezone, paused: true });
    return validator.nextRun() !== null;
  } catch {
    return false;
  } finally {
    validator?.stop();
  }
};

export const mapScheduledTaskRunRow = (row: ScheduledTaskRunRow): ScheduledTaskRun => ({
  id: row.id,
  taskId: row.task_id,
  scheduledFor: row.scheduled_for,
  executorDeviceId: row.executor_device_id,
  status: row.status,
  errorMessage: row.error_message,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export const mapScheduledTaskRow = (row: ScheduledTaskRow): ScheduledTask => ({
  id: row.id,
  name: row.name,
  taskType: row.task_type,
  taskPayload: parseTaskPayload(row.task_payload_json),
  ownerPluginId: row.owner_plugin_id,
  pluginScheduleKey: row.plugin_schedule_key,
  cronExpression: row.cron_expression,
  timezone: row.timezone,
  executorDeviceId: row.executor_device_id,
  missedRunPolicy: row.missed_run_policy,
  isEnabled: row.is_enabled === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastRun: row.run_id && row.run_scheduled_for && row.run_executor_device_id && row.run_status && row.run_started_at
    ? {
        id: row.run_id,
        taskId: row.id,
        scheduledFor: row.run_scheduled_for,
        executorDeviceId: row.run_executor_device_id,
        status: row.run_status,
        errorMessage: row.run_error_message,
        startedAt: row.run_started_at,
        finishedAt: row.run_finished_at,
      }
    : null,
});

const TASK_SELECT = `
  SELECT t.id, t.name, t.task_type, t.task_payload_json, t.owner_plugin_id,
         t.plugin_schedule_key, t.cron_expression,
         t.timezone, t.executor_device_id, t.missed_run_policy, t.is_enabled,
         t.created_at, t.updated_at,
         r.id AS run_id, r.scheduled_for AS run_scheduled_for,
         r.executor_device_id AS run_executor_device_id, r.status AS run_status,
         r.error_message AS run_error_message, r.started_at AS run_started_at,
         r.finished_at AS run_finished_at
  FROM scheduled_tasks t
  LEFT JOIN scheduled_task_runs r ON r.id = (
    SELECT latest.id
    FROM scheduled_task_runs latest
    WHERE latest.task_id = t.id
    ORDER BY latest.scheduled_for DESC
    LIMIT 1
  )`;

const getScheduledTask = async (db: DatabaseAdapter, workspaceId: string, id: string) => {
  const row = await db.prepare(`${TASK_SELECT} WHERE t.id = ? AND t.workspace_id = ?`)
    .bind(id, workspaceId)
    .first<ScheduledTaskRow>();
  return row ? mapScheduledTaskRow(row) : null;
};

export const registerScheduledTaskRoutes = (app: Hono<AppEnv>) => {
  app.use("/api/v1/scheduled-tasks/*", async (c, next) => {
    const response = requireUser(c);
    if (response) return response;
    await next();
  });

  app.use("/api/v1/scheduled-task-runs", async (c, next) => {
    const response = requireUser(c);
    if (response) return response;
    await next();
  });

  app.get("/api/v1/scheduled-tasks", async (c) => {
    const workspaceId = getWorkspaceId(c);
    const executorDeviceId = c.req.query("executorDeviceId")?.trim();
    const query = `${TASK_SELECT}
      WHERE t.workspace_id = ?${executorDeviceId ? " AND t.executor_device_id = ?" : ""}
      ORDER BY t.updated_at DESC, t.id ASC`;
    const statement = c.env.storage.db.prepare(query);
    const rows = executorDeviceId
      ? await statement.bind(workspaceId, executorDeviceId).all<ScheduledTaskRow>()
      : await statement.bind(workspaceId).all<ScheduledTaskRow>();
    return c.json({ tasks: rows.results.map(mapScheduledTaskRow) });
  });

  app.get("/api/v1/scheduled-task-runs", async (c) => {
    const workspaceId = getWorkspaceId(c);
    await pruneExpiredScheduledTaskRuns(c.env.storage.db, workspaceId);
    const requestedLimit = Number(c.req.query("limit") ?? 50);
    const requestedOffset = Number(c.req.query("offset") ?? 0);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const offset = Number.isSafeInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
    const [rows, countRow] = await Promise.all([
      c.env.storage.db.prepare(
        `SELECT r.id, r.task_id, r.scheduled_for, r.executor_device_id, r.status,
                r.error_message, r.started_at, r.finished_at, t.name AS task_name,
                t.task_payload_json, t.owner_plugin_id, t.plugin_schedule_key
         FROM scheduled_task_runs r
         JOIN scheduled_tasks t ON t.id = r.task_id AND t.workspace_id = r.workspace_id
         WHERE r.workspace_id = ?
         ORDER BY r.started_at DESC, r.id DESC
         LIMIT ? OFFSET ?`,
      ).bind(workspaceId, limit, offset).all<ScheduledTaskRunHistoryRow>(),
      c.env.storage.db.prepare(
        "SELECT COUNT(*) AS total_count FROM scheduled_task_runs WHERE workspace_id = ?",
      ).bind(workspaceId).first<{ total_count: number }>(),
    ]);
    const totalCount = Number(countRow?.total_count ?? 0);
    return c.json({
      runs: rows.results.map((row) => ({
        ...mapScheduledTaskRunRow(row),
        taskName: row.task_name,
        pluginId: parseTaskPayload(row.task_payload_json).pluginId,
        ownerPluginId: row.owner_plugin_id,
        pluginScheduleKey: row.plugin_schedule_key,
      })),
      totalCount,
      nextOffset: offset + rows.results.length < totalCount ? offset + rows.results.length : null,
    });
  });

  app.get("/api/v1/scheduled-tasks/plugin/:pluginId", async (c) => {
    const workspaceId = getWorkspaceId(c);
    const pluginId = c.req.param("pluginId");
    const rows = await c.env.storage.db.prepare(`${TASK_SELECT}
      WHERE t.workspace_id = ? AND t.owner_plugin_id = ?
      ORDER BY t.plugin_schedule_key ASC`)
      .bind(workspaceId, pluginId)
      .all<ScheduledTaskRow>();
    return c.json({ tasks: rows.results.map(mapScheduledTaskRow) });
  });

  app.post("/api/v1/scheduled-tasks/plugin-upsert", zValidator("json", PluginScheduleUpsertSchema), async (c) => {
    const input = c.req.valid("json");
    if (!validateSchedule(input.cronExpression, input.timezone)) {
      return badRequest(c, "Cron expression or timezone is invalid.");
    }
    const workspaceId = getWorkspaceId(c);
    const id = createId("scheduled_task");
    const now = isoNow();
    await c.env.storage.db.prepare(
      `INSERT INTO scheduled_tasks (
         id, workspace_id, name, task_type, task_payload_json, owner_plugin_id,
         plugin_schedule_key, cron_expression, timezone, executor_device_id,
         missed_run_policy, is_enabled, created_at, updated_at
       ) VALUES (?, ?, ?, 'plugin-command', ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 1), ?, ?)
       ON CONFLICT(workspace_id, owner_plugin_id, plugin_schedule_key)
       WHERE owner_plugin_id IS NOT NULL AND plugin_schedule_key IS NOT NULL
       DO UPDATE SET name = excluded.name,
                     task_payload_json = excluded.task_payload_json,
                     cron_expression = excluded.cron_expression,
                     timezone = excluded.timezone,
                     missed_run_policy = excluded.missed_run_policy,
                     is_enabled = COALESCE(?, scheduled_tasks.is_enabled),
                     updated_at = CASE
                       WHEN scheduled_tasks.name <> excluded.name
                         OR scheduled_tasks.task_payload_json <> excluded.task_payload_json
                         OR scheduled_tasks.cron_expression <> excluded.cron_expression
                         OR scheduled_tasks.timezone <> excluded.timezone
                         OR scheduled_tasks.missed_run_policy <> excluded.missed_run_policy
                         OR (? IS NOT NULL AND scheduled_tasks.is_enabled <> ?)
                       THEN excluded.updated_at
                       ELSE scheduled_tasks.updated_at
                     END`,
    ).bind(
      id,
      workspaceId,
      input.name,
      JSON.stringify({ pluginId: input.pluginId, commandId: input.commandId }),
      input.pluginId,
      input.scheduleKey,
      input.cronExpression,
      input.timezone,
      input.executorDeviceId,
      input.missedRunPolicy,
      input.isEnabled === undefined ? null : input.isEnabled ? 1 : 0,
      now,
      now,
      input.isEnabled === undefined ? null : input.isEnabled ? 1 : 0,
      input.isEnabled === undefined ? null : input.isEnabled ? 1 : 0,
      input.isEnabled === undefined ? null : input.isEnabled ? 1 : 0,
    ).run();
    const row = await c.env.storage.db.prepare(`${TASK_SELECT}
      WHERE t.workspace_id = ? AND t.owner_plugin_id = ? AND t.plugin_schedule_key = ?`)
      .bind(workspaceId, input.pluginId, input.scheduleKey)
      .first<ScheduledTaskRow>();
    if (!row) return notFound(c, "Plugin schedule not found after upsert");
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "scheduled_task.plugin_upsert", "scheduled_task", row.id, {
      pluginId: input.pluginId,
      scheduleKey: input.scheduleKey,
      executorDeviceId: row.executor_device_id,
    });
    return c.json({ task: mapScheduledTaskRow(row) });
  });

  app.delete("/api/v1/scheduled-tasks/plugin/:pluginId/:scheduleKey", async (c) => {
    const workspaceId = getWorkspaceId(c);
    const pluginId = c.req.param("pluginId");
    const scheduleKey = c.req.param("scheduleKey");
    const row = await c.env.storage.db.prepare(`${TASK_SELECT}
      WHERE t.workspace_id = ? AND t.owner_plugin_id = ? AND t.plugin_schedule_key = ?`)
      .bind(workspaceId, pluginId, scheduleKey)
      .first<ScheduledTaskRow>();
    if (!row) return notFound(c, "Plugin schedule not found");
    await c.env.storage.db.prepare(
      "DELETE FROM scheduled_tasks WHERE id = ? AND workspace_id = ? AND owner_plugin_id = ?",
    ).bind(row.id, workspaceId, pluginId).run();
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "scheduled_task.plugin_delete", "scheduled_task", row.id, {
      pluginId,
      scheduleKey,
    });
    return c.json({ ok: true });
  });

  app.post("/api/v1/scheduled-tasks", zValidator("json", ScheduledTaskCreateSchema), async (c) => {
    const input = c.req.valid("json");
    if (!validateSchedule(input.cronExpression, input.timezone)) {
      return badRequest(c, "Cron expression or timezone is invalid.");
    }
    const workspaceId = getWorkspaceId(c);
    const id = createId("scheduled_task");
    const now = isoNow();
    await c.env.storage.db.prepare(
      `INSERT INTO scheduled_tasks (
         id, workspace_id, name, task_type, task_payload_json, cron_expression,
         timezone, executor_device_id, missed_run_policy, is_enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      workspaceId,
      input.name,
      input.taskType,
      JSON.stringify(input.taskPayload),
      input.cronExpression,
      input.timezone,
      input.executorDeviceId,
      input.missedRunPolicy,
      input.isEnabled ? 1 : 0,
      now,
      now,
    ).run();
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "scheduled_task.create", "scheduled_task", id, {
      taskType: input.taskType,
      executorDeviceId: input.executorDeviceId,
    });
    return c.json({ task: await getScheduledTask(c.env.storage.db, workspaceId, id) }, 201);
  });

  app.patch("/api/v1/scheduled-tasks/:id", zValidator("json", ScheduledTaskUpdateSchema), async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const workspaceId = getWorkspaceId(c);
    const current = await getScheduledTask(c.env.storage.db, workspaceId, id);
    if (!current) return notFound(c, "Scheduled task not found");
    if (!validateSchedule(input.cronExpression ?? current.cronExpression, input.timezone ?? current.timezone)) {
      return badRequest(c, "Cron expression or timezone is invalid.");
    }
    const now = isoNow();
    await c.env.storage.db.prepare(
      `UPDATE scheduled_tasks
       SET name = ?, task_payload_json = ?, cron_expression = ?, timezone = ?,
           executor_device_id = ?, missed_run_policy = ?, is_enabled = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(
      input.name ?? current.name,
      JSON.stringify(input.taskPayload ?? current.taskPayload),
      input.cronExpression ?? current.cronExpression,
      input.timezone ?? current.timezone,
      input.executorDeviceId ?? current.executorDeviceId,
      input.missedRunPolicy ?? current.missedRunPolicy,
      (input.isEnabled ?? current.isEnabled) ? 1 : 0,
      now,
      id,
      workspaceId,
    ).run();
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "scheduled_task.update", "scheduled_task", id, {});
    return c.json({ task: await getScheduledTask(c.env.storage.db, workspaceId, id) });
  });

  app.delete("/api/v1/scheduled-tasks/:id", async (c) => {
    const id = c.req.param("id");
    const workspaceId = getWorkspaceId(c);
    const current = await getScheduledTask(c.env.storage.db, workspaceId, id);
    if (!current) return notFound(c, "Scheduled task not found");
    await c.env.storage.db.prepare("DELETE FROM scheduled_tasks WHERE id = ? AND workspace_id = ?")
      .bind(id, workspaceId)
      .run();
    const actor = getAuditActor(c);
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "scheduled_task.delete", "scheduled_task", id, {});
    return c.json({ ok: true });
  });

  app.get("/api/v1/scheduled-tasks/:id/runs", async (c) => {
    const id = c.req.param("id");
    const workspaceId = getWorkspaceId(c);
    const task = await getScheduledTask(c.env.storage.db, workspaceId, id);
    if (!task) return notFound(c, "Scheduled task not found");
    await pruneExpiredScheduledTaskRuns(c.env.storage.db, workspaceId);
    const requestedLimit = Number(c.req.query("limit") ?? 50);
    const requestedOffset = Number(c.req.query("offset") ?? 0);
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
    const offset = Number.isSafeInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
    const [rows, countRow] = await Promise.all([
      c.env.storage.db.prepare(
        `SELECT id, task_id, scheduled_for, executor_device_id, status, error_message, started_at, finished_at
         FROM scheduled_task_runs
         WHERE task_id = ? AND workspace_id = ?
         ORDER BY scheduled_for DESC, started_at DESC
         LIMIT ? OFFSET ?`,
      ).bind(id, workspaceId, limit, offset).all<ScheduledTaskRunRow>(),
      c.env.storage.db.prepare(
        "SELECT COUNT(*) AS total_count FROM scheduled_task_runs WHERE task_id = ? AND workspace_id = ?",
      ).bind(id, workspaceId).first<{ total_count: number }>(),
    ]);
    const totalCount = Number(countRow?.total_count ?? 0);
    return c.json({
      runs: rows.results.map(mapScheduledTaskRunRow),
      totalCount,
      nextOffset: offset + rows.results.length < totalCount ? offset + rows.results.length : null,
    });
  });

  app.post("/api/v1/scheduled-tasks/:id/runs/claim", zValidator("json", ScheduledTaskClaimSchema), async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const workspaceId = getWorkspaceId(c);
    const task = await getScheduledTask(c.env.storage.db, workspaceId, id);
    if (!task) return notFound(c, "Scheduled task not found");
    if (!task.isEnabled || task.executorDeviceId !== input.executorDeviceId) {
      return conflict(c, "scheduled_task_not_eligible", "This device is not eligible to run the scheduled task.");
    }

    await pruneExpiredScheduledTaskRuns(c.env.storage.db, workspaceId);

    const runId = createId("scheduled_run");
    const scheduledFor = new Date(input.scheduledFor).toISOString();
    const startedAt = isoNow();
    await c.env.storage.db.prepare(
      `INSERT OR IGNORE INTO scheduled_task_runs (
         id, task_id, workspace_id, scheduled_for, executor_device_id, status, started_at
       ) VALUES (?, ?, ?, ?, ?, 'running', ?)`,
    ).bind(runId, id, workspaceId, scheduledFor, input.executorDeviceId, startedAt).run();
    const row = await c.env.storage.db.prepare(
      `SELECT id, task_id, scheduled_for, executor_device_id, status, error_message, started_at, finished_at
       FROM scheduled_task_runs
       WHERE task_id = ? AND workspace_id = ? AND scheduled_for = ?`,
    ).bind(id, workspaceId, scheduledFor).first<ScheduledTaskRunRow>();
    if (!row || row.id !== runId) {
      return conflict(c, "scheduled_task_already_claimed", "This scheduled occurrence was already claimed.");
    }
    return c.json({ run: mapScheduledTaskRunRow(row) }, 201);
  });

  app.post("/api/v1/scheduled-tasks/:taskId/runs/:runId/finish", zValidator("json", ScheduledTaskFinishSchema), async (c) => {
    const taskId = c.req.param("taskId");
    const runId = c.req.param("runId");
    const input = c.req.valid("json");
    const workspaceId = getWorkspaceId(c);
    const current = await c.env.storage.db.prepare(
      `SELECT id, task_id, scheduled_for, executor_device_id, status, error_message, started_at, finished_at
       FROM scheduled_task_runs
       WHERE id = ? AND task_id = ? AND workspace_id = ?`,
    ).bind(runId, taskId, workspaceId).first<ScheduledTaskRunRow>();
    if (!current) return notFound(c, "Scheduled task run not found");
    if (current.executor_device_id !== input.executorDeviceId) {
      return conflict(c, "scheduled_task_run_not_owned", "This device does not own the scheduled task run.");
    }
    if (current.status !== "running") {
      return conflict(c, "scheduled_task_run_finished", "This scheduled task run is already finished.");
    }
    const finishedAt = isoNow();
    await c.env.storage.db.prepare(
      `UPDATE scheduled_task_runs
       SET status = ?, error_message = ?, finished_at = ?
       WHERE id = ? AND task_id = ? AND workspace_id = ? AND status = 'running'`,
    ).bind(
      input.status,
      input.status === "failed" ? input.errorMessage ?? "Scheduled task failed" : null,
      finishedAt,
      runId,
      taskId,
      workspaceId,
    ).run();
    const row = await c.env.storage.db.prepare(
      `SELECT id, task_id, scheduled_for, executor_device_id, status, error_message, started_at, finished_at
       FROM scheduled_task_runs WHERE id = ? AND workspace_id = ?`,
    ).bind(runId, workspaceId).first<ScheduledTaskRunRow>();
    return c.json({ run: row ? mapScheduledTaskRunRow(row) : null });
  });
};
