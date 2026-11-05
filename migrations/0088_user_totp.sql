-- Per-account TOTP two-factor authentication with one-time recovery codes.
-- Every table is additive and every account starts with TOTP off, so existing
-- password logins keep working unchanged after this migration.

CREATE TABLE user_totp (
  user_id TEXT PRIMARY KEY,
  -- AES-GCM ciphertext of the active base32 secret; NULL until enabled.
  secret_encrypted TEXT,
  enabled_at TEXT,
  -- Highest accepted 30-second time step, so a code can never be replayed.
  last_used_step INTEGER NOT NULL DEFAULT 0,
  -- Enrollment or rebind in progress. The active secret stays valid until confirm.
  pending_secret_encrypted TEXT,
  pending_created_at TEXT,
  pending_verified_step INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

-- Only salted slow hashes are stored. A batch is pending until the user
-- confirms it was saved; confirming replaces every older batch at once.
CREATE TABLE user_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX idx_user_recovery_codes_user
  ON user_recovery_codes(user_id, status, used_at);

-- Short-lived second-step login challenges; only the token hash is stored.
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  device_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX idx_auth_challenges_user
  ON auth_challenges(user_id, expires_at);

-- A restricted session may only finish rebinding TOTP; the server rejects it
-- everywhere else regardless of client version.
ALTER TABLE sessions ADD COLUMN mfa_restricted INTEGER NOT NULL DEFAULT 0;
