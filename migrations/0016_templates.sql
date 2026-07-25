PRAGMA foreign_keys = ON;

CREATE TABLE memo_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  title TEXT,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_markdown TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX idx_memo_templates_workspace_updated
  ON memo_templates(workspace_id, updated_at DESC, name);
