-- Keep the first pre-edit body for each dirty table until its changes are claimed.
-- Separate rows for the two replay images keep even a near-limit D1 body readable.
DROP TRIGGER ee_table_migration_pause_insert;
DROP TRIGGER ee_table_migration_pause_update;
DROP TRIGGER ee_table_migration_pause_delete;

CREATE TABLE ee_table_migration_dirty (
  memo_id TEXT PRIMARY KEY,
  migration_id INTEGER NOT NULL DEFAULT 1 REFERENCES ee_table_migration(id) ON DELETE CASCADE,
  before_markdown TEXT NOT NULL
);
CREATE TABLE ee_table_migration_replay (
  image TEXT PRIMARY KEY,
  migration_id INTEGER NOT NULL DEFAULT 1 REFERENCES ee_table_migration(id) ON DELETE CASCADE,
  memo_id TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  markdown TEXT NOT NULL
);
ALTER TABLE ee_table_migration ADD COLUMN scan_done INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ee_table_migration ADD COLUMN budget_day TEXT NOT NULL DEFAULT '';
ALTER TABLE ee_table_migration ADD COLUMN planned_reads INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ee_table_migration ADD COLUMN planned_writes INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER ee_table_migration_track_insert AFTER INSERT ON memo_contents WHEN EXISTS (SELECT 1 FROM ee_table_migration WHERE id=1 AND phase<>'rolling_back') AND NEW.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*' BEGIN INSERT INTO ee_table_migration_dirty(memo_id,before_markdown) VALUES(NEW.memo_id,'') ON CONFLICT(memo_id) DO NOTHING; END;
CREATE TRIGGER ee_table_migration_track_update AFTER UPDATE OF content_markdown ON memo_contents WHEN NEW.content_markdown IS NOT OLD.content_markdown AND EXISTS (SELECT 1 FROM ee_table_migration WHERE id=1 AND phase<>'rolling_back') AND (OLD.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*' OR NEW.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*') BEGIN INSERT INTO ee_table_migration_dirty(memo_id,before_markdown) VALUES(NEW.memo_id,OLD.content_markdown) ON CONFLICT(memo_id) DO NOTHING; END;
CREATE TRIGGER ee_table_migration_track_delete AFTER DELETE ON memo_contents WHEN EXISTS (SELECT 1 FROM ee_table_migration WHERE id=1 AND phase<>'rolling_back') AND OLD.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*' BEGIN INSERT INTO ee_table_migration_dirty(memo_id,before_markdown) VALUES(OLD.memo_id,OLD.content_markdown) ON CONFLICT(memo_id) DO NOTHING; END;
