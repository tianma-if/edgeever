-- Proposals are not notes. Only an explicit authenticated confirmation can
-- commit them; history deletion also removes its proposals.
CREATE TABLE companion_actions (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES companion_turns(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
  result_memo_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_companion_actions_owner ON companion_actions(workspace_id, owner_id, created_at DESC);
CREATE INDEX idx_companion_actions_turn ON companion_actions(turn_id);

-- Transaction-local assertions: an invalid preview aborts the entire memo
-- mutation batch. A successful batch removes its check row before commit.
CREATE TABLE companion_action_checks (
  id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);
