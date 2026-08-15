PRAGMA foreign_keys = ON;

CREATE TABLE ai_prompt_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 80),
  description TEXT CHECK (description IS NULL OR length(description) <= 200),
  instruction TEXT NOT NULL CHECK (length(trim(instruction)) > 0 AND length(instruction) <= 2000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX idx_ai_prompt_templates_workspace_updated
  ON ai_prompt_templates(workspace_id, updated_at DESC, name);
