ALTER TABLE memo_contents ADD COLUMN shared_table_revision INTEGER;
ALTER TABLE memo_revisions ADD COLUMN shared_table_revision INTEGER;

CREATE TABLE ee_table_activation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_id TEXT NOT NULL,
  tables_copied INTEGER NOT NULL,
  rows_copied INTEGER NOT NULL
);

-- A legacy save prepared during cutover must not overwrite a staged table.
CREATE TRIGGER ee_table_active_guard_insert BEFORE INSERT ON memo_contents WHEN NEW.shared_table_revision IS NULL AND NEW.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*' AND EXISTS (SELECT 1 FROM ee_table_activation WHERE id = 1) BEGIN SELECT RAISE(ABORT, 'table_migration_in_progress'); END;

CREATE TRIGGER ee_table_active_guard_update BEFORE UPDATE OF content_markdown ON memo_contents WHEN NEW.content_markdown IS NOT OLD.content_markdown AND NEW.shared_table_revision IS OLD.shared_table_revision AND (OLD.shared_table_revision IS NOT NULL OR NEW.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*') AND EXISTS (SELECT 1 FROM ee_table_activation WHERE id = 1) BEGIN SELECT RAISE(ABORT, 'table_migration_in_progress'); END;
