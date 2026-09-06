-- Additive upgrade: existing accounts do not silently opt into learning or discovery memory.
ALTER TABLE companion_discovery_settings ADD COLUMN learning_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companion_discovery_settings ADD COLUMN recall_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companion_discovery_settings ADD COLUMN learning_cursor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companion_discovery_settings ADD COLUMN last_memory_revision INTEGER NOT NULL DEFAULT -1;
ALTER TABLE companion_memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'explicit';
ALTER TABLE companion_memories ADD COLUMN scope_notebook_id TEXT;
ALTER TABLE companion_memories ADD COLUMN rule_key TEXT;
ALTER TABLE companion_memories ADD COLUMN state TEXT NOT NULL DEFAULT 'active';
CREATE UNIQUE INDEX idx_companion_memory_rule ON companion_memories(workspace_id, owner_id, rule_key);
CREATE TABLE companion_memory_evidence (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  choice_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, owner_id, rule_key, event_id)
);
CREATE INDEX idx_companion_evidence_scope ON companion_memory_evidence(workspace_id, owner_id, rule_key);
-- Keep only rule identifiers, never forgotten content or excerpts.
CREATE TABLE companion_memory_exclusions (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  PRIMARY KEY(workspace_id, owner_id, rule_key)
);
CREATE INDEX idx_audit_actor_learning ON audit_events(actor_id, actor_type, created_at);
-- Expand the discovery kind constraint without modifying prior migrations.
CREATE TABLE companion_discoveries_next (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  turn_id TEXT NOT NULL REFERENCES companion_turns(id) ON DELETE CASCADE,
  action_id TEXT REFERENCES companion_actions(id) ON DELETE CASCADE,
  settings_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('insight', 'merge', 'append', 'move', 'tag')),
  title TEXT NOT NULL, body TEXT NOT NULL, sources_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL, seen_at TEXT, dismissed_at TEXT, created_at TEXT NOT NULL,
  UNIQUE(workspace_id, owner_id, fingerprint)
);
INSERT INTO companion_discoveries_next SELECT * FROM companion_discoveries;
DROP TABLE companion_discoveries;
ALTER TABLE companion_discoveries_next RENAME TO companion_discoveries;
CREATE INDEX companion_discoveries_feed ON companion_discoveries(workspace_id, owner_id, created_at DESC);
ALTER TABLE companion_discoveries ADD COLUMN memory_ids_json TEXT NOT NULL DEFAULT '[]';
