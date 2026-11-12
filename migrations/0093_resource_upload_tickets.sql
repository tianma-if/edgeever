-- Single-use upload URLs for MCP agents. The secret is stored only as a
-- SHA-256 hash; the row binds the upload to one workspace, memo, kind, MIME
-- type and exact size, and to the credential that created it.
CREATE TABLE resource_upload_tickets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'attachment')),
  mime_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  label TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent')),
  actor_id TEXT,
  api_token_id TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (memo_id) REFERENCES memos(id) ON DELETE CASCADE
);

CREATE INDEX idx_resource_upload_tickets_workspace
  ON resource_upload_tickets(workspace_id, expires_at);
