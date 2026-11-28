-- Staged heads become visible in the same transaction as activation.
-- A converted plain memo may retain a table head for history.
CREATE VIEW memo_contents_for_read AS
SELECT c.memo_id, c.content_json, c.content_markdown, c.content_text, c.content_hash,
       c.revision, c.created_at, c.updated_at,
       c.shared_table_revision AS stored_shared_table_revision,
       COALESCE(c.shared_table_revision, h.revision) AS shared_table_revision
FROM memo_contents c
LEFT JOIN ee_table_activation a ON a.id = 1 AND c.shared_table_revision IS NULL
  AND c.content_markdown GLOB '*<!--*edgeever-table-v1:*-->*'
LEFT JOIN ee_table_heads h ON h.table_id = c.memo_id AND h.migration_run_id = a.run_id;
