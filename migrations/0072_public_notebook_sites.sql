ALTER TABLE notebook_shares ADD COLUMN site_slug TEXT;
ALTER TABLE notebook_shares ADD COLUMN site_settings_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(site_settings_json) AND json_type(site_settings_json) = 'object');
CREATE UNIQUE INDEX idx_notebook_shares_site_slug
  ON notebook_shares(lower(site_slug)) WHERE site_slug IS NOT NULL;

CREATE TABLE notebook_share_excluded_memos (
  share_id TEXT NOT NULL REFERENCES notebook_shares(id) ON UPDATE CASCADE ON DELETE CASCADE,
  memo_id TEXT NOT NULL REFERENCES memos(id) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (share_id, memo_id)
);
CREATE INDEX idx_notebook_share_excluded_memos_memo ON notebook_share_excluded_memos(memo_id);
