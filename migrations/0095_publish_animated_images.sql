-- Expand the raster MIME constraint without changing existing publication URLs,
-- object keys, ownership, or deduplication. No private resource is made public.
CREATE TABLE publish_images_expanded (
  token TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  storage_config_id TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, sha256)
);
INSERT INTO publish_images_expanded SELECT * FROM publish_images;
DROP TABLE publish_images;
ALTER TABLE publish_images_expanded RENAME TO publish_images;
