ALTER TABLE companion_turns ADD COLUMN origin TEXT NOT NULL DEFAULT 'chat';

CREATE TABLE companion_discovery_settings (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  notebook_ids_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 0,
  last_cursor INTEGER NOT NULL DEFAULT -1,
  last_check_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'quiet',
  active_turn_id TEXT,
  PRIMARY KEY(workspace_id, owner_id)
);
CREATE TABLE companion_discoveries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  turn_id TEXT NOT NULL REFERENCES companion_turns(id) ON DELETE CASCADE,
  action_id TEXT REFERENCES companion_actions(id) ON DELETE CASCADE,
  settings_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('insight', 'merge', 'append')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  seen_at TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, owner_id, fingerprint)
);
CREATE INDEX companion_discoveries_feed ON companion_discoveries(workspace_id, owner_id, created_at DESC);
