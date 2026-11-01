-- Seek backup and bootstrap pages by workspace and memo ID, including deleted notes for sync.
CREATE INDEX idx_memos_workspace_id
  ON memos(workspace_id, id);
