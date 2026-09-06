PRAGMA foreign_keys = ON;

CREATE TABLE ai_provider_configs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai-compatible', 'anthropic', 'google')),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  base_url TEXT NOT NULL CHECK (length(trim(base_url)) > 0),
  api_key_encrypted TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE INDEX idx_ai_provider_configs_workspace
  ON ai_provider_configs(workspace_id, is_enabled, created_at);

CREATE TABLE ai_models (
  id TEXT PRIMARY KEY,
  provider_config_id TEXT NOT NULL,
  model_id TEXT NOT NULL CHECK (length(trim(model_id)) > 0),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (provider_config_id) REFERENCES ai_provider_configs(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  UNIQUE (provider_config_id, model_id)
);

CREATE INDEX idx_ai_models_provider
  ON ai_models(provider_config_id, created_at);

CREATE TABLE ai_workspace_settings (
  workspace_id TEXT PRIMARY KEY,
  default_model_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  FOREIGN KEY (default_model_id) REFERENCES ai_models(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

INSERT INTO ai_provider_configs (
  id, workspace_id, provider, display_name, base_url, api_key_encrypted,
  is_enabled, created_at, updated_at
)
SELECT
  id, workspace_id, provider, display_name, base_url, api_key_encrypted,
  is_enabled, created_at, updated_at
FROM ai_model_configs;

INSERT INTO ai_models (
  id, provider_config_id, model_id, display_name, created_at, updated_at
)
SELECT
  'aim_' || id, id, model_id, model_id, created_at, updated_at
FROM ai_model_configs;

INSERT INTO ai_workspace_settings (
  workspace_id, default_model_id, created_at, updated_at
)
SELECT
  workspace_id, 'aim_' || id, created_at, updated_at
FROM ai_model_configs;
