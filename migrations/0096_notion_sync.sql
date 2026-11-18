-- Workspace-scoped Notion two-way synchronization configuration, page mappings,
-- and webhook delivery deduplication. Credentials are stored encrypted at rest.
CREATE TABLE notion_sync_configs (
  workspace_id TEXT PRIMARY KEY NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  database_id TEXT NOT NULL,
  database_title TEXT,
  api_token_encrypted TEXT NOT NULL,
  webhook_channel_token TEXT NOT NULL UNIQUE,
  webhook_secret_encrypted TEXT,
  pending_verification_token_encrypted TEXT,
  tag_filter_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tag_filter_json)),
  notebook_filter_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(notebook_filter_json)),
  default_notebook_id TEXT,
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE notion_sync_mappings (
  workspace_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  notion_page_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  notebook_name TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  last_direction TEXT NOT NULL CHECK (last_direction IN ('ee_to_notion', 'notion_to_ee')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, memo_id),
  UNIQUE (workspace_id, notion_page_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_notion_sync_mappings_page
  ON notion_sync_mappings(workspace_id, notion_page_id);

CREATE INDEX idx_notion_sync_mappings_memo_id
  ON notion_sync_mappings(memo_id);

CREATE TABLE notion_webhook_deliveries (
  workspace_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, delivery_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_notion_webhook_deliveries_received_at
  ON notion_webhook_deliveries(received_at);
