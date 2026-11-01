-- Preserve creation-time export order while seeking directly to continuation pages.
CREATE INDEX idx_memos_workspace_created_export
  ON memos(workspace_id, is_deleted, created_at, id);
