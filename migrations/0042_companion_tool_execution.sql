-- Durable, non-replayable execution claim for the shared MCP tool adapter.
-- A crash after a write leaves a visible uncertain receipt, never a retryable action.
ALTER TABLE companion_actions ADD COLUMN execution_token TEXT;
ALTER TABLE companion_actions ADD COLUMN workspace_cursor INTEGER;
ALTER TABLE companion_actions ADD COLUMN result_notebook_id TEXT;
ALTER TABLE companion_actions ADD COLUMN result_json TEXT;
