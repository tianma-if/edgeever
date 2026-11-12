-- Default access for notebooks without an explicit grant on notebook-scoped
-- API tokens (PR #820). NULL and 'none' keep the original allow-list behaviour;
-- 'read' / 'write' also cover notebooks created after the token.
ALTER TABLE api_tokens ADD COLUMN notebook_default_access TEXT;
