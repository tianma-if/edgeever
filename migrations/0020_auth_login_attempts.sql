CREATE TABLE auth_login_attempts (
  scope TEXT NOT NULL CHECK (scope IN ('username', 'ip')),
  attempt_key TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, attempt_key)
);

CREATE INDEX idx_auth_login_attempts_updated
  ON auth_login_attempts(updated_at);
