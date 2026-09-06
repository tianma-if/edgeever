import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { registerScheduledTaskRoutes } from "./scheduled-task-routes.ts";

const auth = {
  kind: "user",
  actorType: "user",
  actorId: "usr_owner",
  username: "owner",
  displayName: "Owner",
  scopes: [],
  workspaceId: "ws_scheduled",
  role: "owner",
};

class SqlitePreparedStatement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new SqlitePreparedStatement(this.db, this.sql, bindings); }
  async all() { return { results: this.db.query(this.sql).all(...this.bindings), success: true, meta: {} }; }
  async first() { return this.db.query(this.sql).get(...this.bindings) ?? null; }
  async run() {
    this.db.query(this.sql).run(...this.bindings);
    return { results: [], success: true, meta: {} };
  }
}

class SqliteDatabase {
  constructor(db) { this.db = db; }
  prepare(sql) { return new SqlitePreparedStatement(this.db, sql); }
  async batch(statements) {
    return this.db.transaction(() => statements.map((statement) =>
      this.db.query(statement.sql).run(...statement.bindings)))();
  }
}

const createFixture = () => {
  const sqlite = new Database(":memory:");
  for (const migration of globSync("migrations/*.sql").sort()) {
    sqlite.exec(readFileSync(migration, "utf8"));
  }
  sqlite.query("INSERT INTO workspaces (id, name, is_personal) VALUES (?, ?, 1)")
    .run(auth.workspaceId, "Scheduled workspace");
  const app = new Hono();
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", auth);
    await next();
  });
  registerScheduledTaskRoutes(app);
  return {
    app,
    environment: { storage: { db: new SqliteDatabase(sqlite), resources: {} } },
  };
};

const deviceId = "desktop-device-1234567890";
const otherDeviceId = "desktop-device-0987654321";

describe("scheduled task routes", () => {
  test("binds tasks to one device and atomically claims each occurrence", async () => {
    const { app, environment } = createFixture();
    const createdResponse = await app.request("/api/v1/scheduled-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Daily cleanup",
        taskType: "plugin-command",
        taskPayload: { pluginId: "org.edgeever.cleanup", commandId: "run" },
        cronExpression: "0 9 * * *",
        timezone: "Asia/Shanghai",
        executorDeviceId: deviceId,
        missedRunPolicy: "run-once",
      }),
    }, environment);
    expect(createdResponse.status).toBe(201);
    const task = (await createdResponse.json()).task;

    const otherDeviceList = await app.request(
      `/api/v1/scheduled-tasks?executorDeviceId=${encodeURIComponent(otherDeviceId)}`,
      {},
      environment,
    );
    expect((await otherDeviceList.json()).tasks).toEqual([]);

    const wrongDeviceClaim = await app.request(`/api/v1/scheduled-tasks/${task.id}/runs/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledFor: "2026-09-02T01:00:00.000Z", executorDeviceId: otherDeviceId }),
    }, environment);
    expect(wrongDeviceClaim.status).toBe(409);

    const claimInput = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledFor: "2026-09-02T01:00:00.000Z", executorDeviceId: deviceId }),
    };
    const claimedResponse = await app.request(`/api/v1/scheduled-tasks/${task.id}/runs/claim`, claimInput, environment);
    expect(claimedResponse.status).toBe(201);
    const run = (await claimedResponse.json()).run;
    const duplicateResponse = await app.request(`/api/v1/scheduled-tasks/${task.id}/runs/claim`, claimInput, environment);
    expect(duplicateResponse.status).toBe(409);

    const finishedResponse = await app.request(`/api/v1/scheduled-tasks/${task.id}/runs/${run.id}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ executorDeviceId: deviceId, status: "succeeded" }),
    }, environment);
    expect(finishedResponse.status).toBe(200);
    expect((await finishedResponse.json()).run).toMatchObject({ status: "succeeded", errorMessage: null });

    const listedResponse = await app.request(
      `/api/v1/scheduled-tasks?executorDeviceId=${encodeURIComponent(deviceId)}`,
      {},
      environment,
    );
    expect((await listedResponse.json()).tasks[0]).toMatchObject({
      id: task.id,
      executorDeviceId: deviceId,
      lastRun: { id: run.id, status: "succeeded" },
    });

    const historyResponse = await app.request(
      `/api/v1/scheduled-tasks/${task.id}/runs?offset=0&limit=1`,
      {},
      environment,
    );
    expect(historyResponse.status).toBe(200);
    expect(await historyResponse.json()).toMatchObject({
      runs: [{ id: run.id, status: "succeeded" }],
      totalCount: 1,
      nextOffset: null,
    });

    const staleRunId = "scheduled_run_stale";
    await environment.storage.db.prepare(
      `INSERT INTO scheduled_task_runs (
         id, task_id, workspace_id, scheduled_for, executor_device_id,
         status, started_at, finished_at
       ) VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?)`,
    ).bind(
      staleRunId,
      task.id,
      auth.workspaceId,
      "2026-07-01T01:00:00.000Z",
      deviceId,
      new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000).toISOString(),
      new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000 + 1_000).toISOString(),
    ).run();

    const globalHistoryResponse = await app.request(
      "/api/v1/scheduled-task-runs?offset=0&limit=1",
      {},
      environment,
    );
    expect(globalHistoryResponse.status).toBe(200);
    expect(await globalHistoryResponse.json()).toMatchObject({
      runs: [{
        id: run.id,
        taskId: task.id,
        taskName: "Daily cleanup",
        pluginId: "org.edgeever.cleanup",
        ownerPluginId: null,
        pluginScheduleKey: null,
        status: "succeeded",
      }],
      totalCount: 1,
      nextOffset: null,
    });
    expect(await environment.storage.db.prepare(
      "SELECT id FROM scheduled_task_runs WHERE id = ?",
    ).bind(staleRunId).first()).toBeNull();
  });

  test("does not expose task management to API-token actors", async () => {
    const { app, environment } = createFixture();
    const tokenApp = new Hono();
    tokenApp.use("/api/v1/*", async (context, next) => {
      context.set("auth", { ...auth, kind: "agent", actorType: "agent" });
      await next();
    });
    registerScheduledTaskRoutes(tokenApp);
    const response = await tokenApp.request("/api/v1/scheduled-tasks", {}, environment);
    expect(response.status).toBe(403);
    const historyResponse = await tokenApp.request("/api/v1/scheduled-task-runs", {}, environment);
    expect(historyResponse.status).toBe(403);
  });

  test("rejects invalid cron expressions and timezones", async () => {
    const { app, environment } = createFixture();
    const response = await app.request("/api/v1/scheduled-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Invalid schedule",
        taskType: "plugin-command",
        taskPayload: { pluginId: "org.edgeever.cleanup", commandId: "run" },
        cronExpression: "not a cron expression",
        timezone: "Mars/Olympus_Mons",
        executorDeviceId: deviceId,
        missedRunPolicy: "run-once",
      }),
    }, environment);
    expect(response.status).toBe(400);
  });

  test("upserts one plugin-owned schedule across multiple desktop devices", async () => {
    const { app, environment } = createFixture();
    const upsert = (executorDeviceId, input = {}) => app.request("/api/v1/scheduled-tasks/plugin-upsert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pluginId: "org.edgeever.cleanup",
        scheduleKey: "daily-cleanup",
        name: "Daily cleanup",
        commandId: "run",
        cronExpression: "0 9 * * *",
        timezone: "Asia/Shanghai",
        executorDeviceId,
        missedRunPolicy: "run-once",
        ...input,
      }),
    }, environment);

    const first = (await (await upsert(deviceId)).json()).task;
    expect(first).toMatchObject({
      ownerPluginId: "org.edgeever.cleanup",
      pluginScheduleKey: "daily-cleanup",
      executorDeviceId: deviceId,
      isEnabled: true,
    });

    const disabledResponse = await app.request(`/api/v1/scheduled-tasks/${first.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isEnabled: false }),
    }, environment);
    expect(disabledResponse.status).toBe(200);

    const second = (await (await upsert(otherDeviceId, { name: "Updated cleanup" })).json()).task;
    expect(second).toMatchObject({
      id: first.id,
      name: "Updated cleanup",
      executorDeviceId: deviceId,
      isEnabled: false,
    });

    const repeated = (await (await upsert(otherDeviceId, { name: "Updated cleanup" })).json()).task;
    expect(repeated.updatedAt).toBe(second.updatedAt);

    const listed = await app.request("/api/v1/scheduled-tasks/plugin/org.edgeever.cleanup", {}, environment);
    expect((await listed.json()).tasks).toHaveLength(1);

    const removed = await app.request(
      "/api/v1/scheduled-tasks/plugin/org.edgeever.cleanup/daily-cleanup",
      { method: "DELETE" },
      environment,
    );
    expect(removed.status).toBe(200);
  });
});
