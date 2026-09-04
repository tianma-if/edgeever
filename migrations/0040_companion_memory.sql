-- Server-owned preview data. Local clients use authenticated API access;
-- these tables are not part of the desktop/mobile note mirror protocol.
CREATE TABLE companion_state (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  memory_revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, owner_id)
);

CREATE TABLE companion_memories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 500),
  source_turn_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_companion_memories_owner ON companion_memories(workspace_id, owner_id, updated_at DESC);

CREATE TABLE companion_turns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  memory_revision INTEGER NOT NULL,
  message TEXT NOT NULL,
  response TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
  sources_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  use_memory INTEGER NOT NULL,
  allow_notes INTEGER NOT NULL,
  locale TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_companion_turns_thread ON companion_turns(workspace_id, owner_id, thread_id, created_at DESC);
CREATE INDEX idx_companion_turns_owner ON companion_turns(workspace_id, owner_id, created_at DESC);
-- One billed generation at a time for an account, including other devices.
CREATE UNIQUE INDEX idx_companion_running ON companion_turns(workspace_id, owner_id) WHERE status = 'running';
