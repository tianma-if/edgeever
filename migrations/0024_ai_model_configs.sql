PRAGMA foreign_keys = ON;

CREATE TABLE ai_model_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai-compatible', 'anthropic', 'google')),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  base_url TEXT NOT NULL CHECK (length(trim(base_url)) > 0),
  api_key_encrypted TEXT NOT NULL,
  model_id TEXT NOT NULL CHECK (length(trim(model_id)) > 0),
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  UNIQUE (workspace_id)
);

CREATE INDEX idx_ai_model_configs_workspace
  ON ai_model_configs(workspace_id, is_enabled);
