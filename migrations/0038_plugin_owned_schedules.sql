ALTER TABLE scheduled_tasks ADD COLUMN owner_plugin_id TEXT;
ALTER TABLE scheduled_tasks ADD COLUMN plugin_schedule_key TEXT;

CREATE UNIQUE INDEX idx_scheduled_tasks_plugin_schedule
  ON scheduled_tasks(workspace_id, owner_plugin_id, plugin_schedule_key)
  WHERE owner_plugin_id IS NOT NULL AND plugin_schedule_key IS NOT NULL;
