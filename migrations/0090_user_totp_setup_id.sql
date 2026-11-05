-- Gives every enrollment or rebind flow an id when its pending secret is issued.
-- The client sends that id back on verify, and the recovery-code batch id back
-- on confirm, so a flow replaced by another tab of the same session is refused
-- instead of activating the newer flow's secret or codes.
-- Additive only; existing rows keep working with NULL.

ALTER TABLE user_totp ADD COLUMN pending_setup_id TEXT;
