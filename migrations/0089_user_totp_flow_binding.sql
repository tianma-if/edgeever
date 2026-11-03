-- Binds a TOTP enrollment, rebind or recovery-code regeneration to the session
-- that passed identity verification, caps enrollment code attempts, and ties the
-- pending recovery-code batch to the secret version that was verified.
-- Additive only; every existing row keeps working with the defaults.

ALTER TABLE user_totp ADD COLUMN pending_session_id TEXT;
ALTER TABLE user_totp ADD COLUMN pending_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_totp ADD COLUMN pending_batch_id TEXT;

ALTER TABLE user_recovery_codes ADD COLUMN session_id TEXT;
