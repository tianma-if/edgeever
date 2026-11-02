-- Optional expiry and an anonymous open counter for single-note shares.
-- Existing shares keep today's behavior: no expiry and a count starting at 0.
ALTER TABLE memo_shares ADD COLUMN expires_at TEXT;
ALTER TABLE memo_shares ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memo_shares ADD COLUMN last_viewed_at TEXT;
