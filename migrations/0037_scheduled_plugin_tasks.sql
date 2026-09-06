PRAGMA foreign_keys = ON;

CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 120),
  task_type TEXT NOT NULL CHECK (task_type IN ('plugin-command')),
  task_payload_json TEXT NOT NULL CHECK (json_valid(task_payload_json)),
  cron_expression TEXT NOT NULL CHECK (length(trim(cron_expression)) > 0 AND length(cron_expression) <= 160),
  timezone TEXT NOT NULL CHECK (length(trim(timezone)) > 0 AND length(timezone) <= 80),
  executor_device_id TEXT NOT NULL CHECK (length(trim(executor_device_id)) >= 16 AND length(executor_device_id) <= 160),
  missed_run_policy TEXT NOT NULL DEFAULT 'run-once' CHECK (missed_run_policy IN ('run-once', 'skip')),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX idx_scheduled_tasks_workspace_device
  ON scheduled_tasks(workspace_id, executor_device_id, is_enabled, updated_at DESC);

CREATE TABLE scheduled_task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  executor_device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  UNIQUE (task_id, scheduled_for)
);

CREATE INDEX idx_scheduled_task_runs_workspace_task
  ON scheduled_task_runs(workspace_id, task_id, scheduled_for DESC);
