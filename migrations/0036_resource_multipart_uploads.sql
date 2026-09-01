CREATE TABLE resource_uploads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  resource_id TEXT NOT NULL UNIQUE,
  storage_config_id TEXT NOT NULL,
  bucket_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  provider_upload_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'attachment')),
  mime_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  part_size INTEGER NOT NULL CHECK (part_size > 0),
  part_count INTEGER NOT NULL CHECK (part_count > 0),
  restore_metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE
);

CREATE INDEX idx_resource_uploads_workspace
  ON resource_uploads(workspace_id, expires_at);

CREATE TABLE resource_upload_parts (
  upload_id TEXT NOT NULL,
  part_number INTEGER NOT NULL CHECK (part_number > 0),
  etag TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (upload_id, part_number),
  FOREIGN KEY (upload_id) REFERENCES resource_uploads(id) ON DELETE CASCADE
);
