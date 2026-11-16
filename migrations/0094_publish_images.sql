-- Separate publication copies. Existing private resource URLs and note shares
-- retain their authorization rules. Tokens grant access only to one raster image.
CREATE TABLE publish_images (
  token TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  storage_config_id TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, sha256)
);
