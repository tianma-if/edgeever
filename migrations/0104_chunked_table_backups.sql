CREATE INDEX memo_revisions_backup_cursor ON memo_revisions(memo_id, id);

CREATE TABLE ee_table_restore_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  memo_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  target_token TEXT,
  memo_json TEXT NOT NULL CHECK(json_valid(memo_json)),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_markdown TEXT NOT NULL,
  content_text TEXT NOT NULL,
  snapshot_count INTEGER NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX ee_table_restore_jobs_age ON ee_table_restore_jobs(workspace_id, updated_at);

CREATE TABLE ee_table_restore_snapshots (
  job_id TEXT NOT NULL REFERENCES ee_table_restore_jobs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  revision_id TEXT,
  revision_json TEXT NOT NULL CHECK(json_valid(revision_json)),
  header_json TEXT CHECK(header_json IS NULL OR json_valid(header_json)),
  row_count INTEGER NOT NULL,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_markdown TEXT NOT NULL,
  content_text TEXT NOT NULL,
  PRIMARY KEY(job_id, ordinal),
  UNIQUE(job_id, revision_id)
);

CREATE TABLE ee_table_restore_rows (
  job_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  position INTEGER NOT NULL,
  record_id TEXT NOT NULL,
  cells_json TEXT NOT NULL CHECK(json_valid(cells_json)),
  normalized_json TEXT NOT NULL CHECK(json_valid(normalized_json)),
  search_text TEXT NOT NULL,
  PRIMARY KEY(job_id, ordinal, position),
  UNIQUE(job_id, ordinal, record_id),
  FOREIGN KEY(job_id, ordinal) REFERENCES ee_table_restore_snapshots(job_id, ordinal) ON DELETE CASCADE
);
