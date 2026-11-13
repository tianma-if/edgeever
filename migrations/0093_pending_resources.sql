-- Files uploaded before they belong to a memo. A row is created with a
-- single-use upload credential (stored only as a SHA-256 hash), becomes
-- "uploaded" once its bytes are stored, and is moved into `resources` when a
-- memo binds it. The id is the final resource id, so the URL returned after
-- the upload stays valid after binding and the bytes are never copied.
CREATE TABLE pending_resources (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('awaiting_upload', 'uploading', 'uploaded')),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'attachment')),
  mime_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  label TEXT,
  object_key TEXT NOT NULL UNIQUE,
  bucket_name TEXT,
  storage_config_id TEXT,
  sha256 TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent')),
  actor_id TEXT,
  api_token_id TEXT,
  session_id TEXT,
  claim_id TEXT,
  created_at TEXT NOT NULL,
  -- Deadline of the upload credential.
  upload_expires_at TEXT NOT NULL,
  uploaded_at TEXT,
  -- When cleanup may delete the row and its bytes: the upload deadline, then
  -- a grace period while the bytes are written, then the binding deadline.
  expires_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_pending_resources_expires_at
  ON pending_resources(expires_at);

CREATE INDEX idx_pending_resources_workspace
  ON pending_resources(workspace_id, expires_at);
