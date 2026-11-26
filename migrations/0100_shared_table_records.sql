-- Shared table records on D1 and SQLite. The migration service copies legacy bodies in bounded batches.
CREATE TABLE ee_table_heads (
 workspace_id TEXT NOT NULL,
 table_id TEXT NOT NULL UNIQUE REFERENCES memos(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 schema_revision INTEGER NOT NULL,
 row_count INTEGER NOT NULL,
 max_position INTEGER NOT NULL,
 header_json TEXT NOT NULL CHECK(json_valid(header_json)),
 indexes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(indexes_json)),
 migration_run_id TEXT,
 PRIMARY KEY(workspace_id,table_id)
);
CREATE INDEX ee_table_heads_migration ON ee_table_heads(migration_run_id,table_id);
CREATE TABLE ee_table_commits (
 workspace_id TEXT NOT NULL, table_id TEXT NOT NULL, revision INTEGER NOT NULL,
 schema_revision INTEGER NOT NULL, row_count INTEGER NOT NULL, max_position INTEGER NOT NULL,
 header_json TEXT NOT NULL CHECK(json_valid(header_json)),
 mutation_id TEXT, mutation_hash TEXT,
 PRIMARY KEY(workspace_id,table_id,revision),
 FOREIGN KEY(workspace_id,table_id) REFERENCES ee_table_heads(workspace_id,table_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ee_table_commits_mutation ON ee_table_commits(workspace_id,table_id,mutation_id) WHERE mutation_id IS NOT NULL;
CREATE TABLE ee_table_records (
 id INTEGER PRIMARY KEY,
 workspace_id TEXT NOT NULL, table_id TEXT NOT NULL,
 record_id TEXT NOT NULL, position INTEGER NOT NULL, created_revision INTEGER NOT NULL,
 cells_json TEXT NOT NULL CHECK(json_valid(cells_json)),
 normalized_json TEXT NOT NULL CHECK(json_valid(normalized_json)), search_text TEXT NOT NULL,
 UNIQUE(workspace_id,table_id,record_id), UNIQUE(workspace_id,table_id,position),
 FOREIGN KEY(workspace_id,table_id) REFERENCES ee_table_heads(workspace_id,table_id) ON DELETE CASCADE
);
CREATE TABLE ee_table_versions (
 workspace_id TEXT NOT NULL, table_id TEXT NOT NULL, record_id TEXT NOT NULL,
 revision INTEGER NOT NULL, position INTEGER NOT NULL, deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
 cells_json TEXT NOT NULL CHECK(json_valid(cells_json)),
 PRIMARY KEY(workspace_id,table_id,record_id,revision),
 FOREIGN KEY(workspace_id,table_id) REFERENCES ee_table_heads(workspace_id,table_id) ON DELETE CASCADE
);
CREATE INDEX ee_table_versions_position ON ee_table_versions(workspace_id,table_id,position,revision DESC);
CREATE TABLE ee_table_assertion (ok INTEGER PRIMARY KEY CHECK(ok=1));
CREATE VIRTUAL TABLE ee_table_search USING fts5(search_text,content='ee_table_records',content_rowid='id');
CREATE TRIGGER ee_table_search_insert AFTER INSERT ON ee_table_records BEGIN INSERT INTO ee_table_search(rowid,search_text) VALUES(NEW.id,NEW.search_text); END;
CREATE TRIGGER ee_table_search_update AFTER UPDATE OF search_text ON ee_table_records BEGIN INSERT INTO ee_table_search(ee_table_search,rowid,search_text) VALUES('delete',OLD.id,OLD.search_text); INSERT INTO ee_table_search(rowid,search_text) VALUES(NEW.id,NEW.search_text); END;
CREATE TRIGGER ee_table_search_delete AFTER DELETE ON ee_table_records BEGIN INSERT INTO ee_table_search(ee_table_search,rowid,search_text) VALUES('delete',OLD.id,OLD.search_text); END;
CREATE INDEX ee_table_versions_revision ON ee_table_versions(workspace_id, table_id, revision, record_id);

CREATE TABLE ee_table_migration (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('copying', 'ready', 'rolling_back')),
  after_memo_id TEXT NOT NULL DEFAULT '',
  pending_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(pending_ids)),
  after_position INTEGER NOT NULL DEFAULT 0,
  tables_copied INTEGER NOT NULL DEFAULT 0,
  rows_copied INTEGER NOT NULL DEFAULT 0,
  step INTEGER NOT NULL DEFAULT 0,
  write_back_id TEXT
);

-- Apply the maintenance lock to all write paths, including imports and sync.
CREATE TRIGGER ee_table_migration_pause_insert BEFORE INSERT ON memo_contents WHEN NEW.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*' AND EXISTS (SELECT 1 FROM ee_table_migration WHERE id = 1) BEGIN SELECT RAISE(ABORT, 'table_migration_in_progress'); END;

CREATE TRIGGER ee_table_migration_pause_update BEFORE UPDATE OF content_markdown ON memo_contents WHEN NEW.content_markdown IS NOT OLD.content_markdown AND (OLD.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*' OR NEW.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*') AND EXISTS (SELECT 1 FROM ee_table_migration WHERE id = 1 AND write_back_id IS NOT OLD.memo_id) BEGIN SELECT RAISE(ABORT, 'table_migration_in_progress'); END;

CREATE TRIGGER ee_table_migration_pause_delete BEFORE DELETE ON memo_contents WHEN OLD.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*' AND EXISTS (SELECT 1 FROM ee_table_migration WHERE id = 1) BEGIN SELECT RAISE(ABORT, 'table_migration_in_progress'); END;
