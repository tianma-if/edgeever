CREATE TABLE notebooks (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug TEXT,
  icon TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id),
  FOREIGN KEY (parent_id) REFERENCES notebooks(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE INDEX idx_notebooks_parent
  ON notebooks(parent_id, is_deleted, sort_order, name);

CREATE INDEX idx_notebooks_deleted
  ON notebooks(is_deleted, updated_at);

CREATE TRIGGER trg_notebooks_prevent_cycles
BEFORE UPDATE OF parent_id ON notebooks
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id, parent_id) AS (
    SELECT id, parent_id
    FROM notebooks
    WHERE id = NEW.parent_id

    UNION ALL

    SELECT n.id, n.parent_id
    FROM notebooks n
    INNER JOIN ancestors a ON n.id = a.parent_id
    WHERE a.parent_id IS NOT NULL
  )
  SELECT RAISE(ABORT, 'notebook cycle detected')
  WHERE EXISTS (
    SELECT 1
    FROM ancestors
    WHERE id = NEW.id
  );
END;

CREATE TABLE memos (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL,
  title TEXT,
  excerpt TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  source_memo_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_memo_ids)),
  merge_source_count INTEGER NOT NULL DEFAULT 0 CHECK (merge_source_count >= 0),
  merged_into_memo_id TEXT,
  merged_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'user',
  updated_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  FOREIGN KEY (notebook_id) REFERENCES notebooks(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  FOREIGN KEY (merged_into_memo_id) REFERENCES memos(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE INDEX idx_memos_notebook_feed
  ON memos(notebook_id, is_deleted, updated_at DESC);

CREATE INDEX idx_memos_archive_feed
  ON memos(is_archived, is_deleted, updated_at DESC);

CREATE INDEX idx_memos_merge_target
  ON memos(merged_into_memo_id);

CREATE TABLE memo_contents (
  memo_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_markdown TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (memo_id) REFERENCES memos(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX idx_memo_contents_revision
  ON memo_contents(memo_id, revision);

CREATE VIRTUAL TABLE memos_fts USING fts5(
  memo_id UNINDEXED,
  title,
  content_text,
  tags
);

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  memo_id TEXT NOT NULL,
  original_memo_id TEXT,
  bucket_name TEXT NOT NULL DEFAULT 'edgeever-resources',
  object_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'attachment')),
  mime_type TEXT,
  filename TEXT,
  byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  sha256 TEXT,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  FOREIGN KEY (memo_id) REFERENCES memos(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  FOREIGN KEY (original_memo_id) REFERENCES memos(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  UNIQUE (bucket_name, object_key)
);

CREATE INDEX idx_resources_memo
  ON resources(memo_id, is_deleted, kind);

CREATE INDEX idx_resources_original_memo
  ON resources(original_memo_id);

CREATE INDEX idx_resources_object
  ON resources(bucket_name, object_key);

CREATE TABLE memo_revisions (
  id TEXT PRIMARY KEY,
  memo_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  title TEXT,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  content_markdown TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (memo_id) REFERENCES memos(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX idx_memo_revisions_memo
  ON memo_revisions(memo_id, revision DESC);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scopes_json)),
  last_used_at TEXT,
  expires_at TEXT,
  is_revoked INTEGER NOT NULL DEFAULT 0 CHECK (is_revoked IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_audit_events_entity
  ON audit_events(entity_type, entity_id, created_at DESC);
