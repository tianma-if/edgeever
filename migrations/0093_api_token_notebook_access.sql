-- Per-notebook read/write access for API tokens (#817).
-- NULL keeps the previous behaviour: the token reaches every notebook in its
-- workspace. A JSON array restricts it to the listed notebook subtrees, each
-- with its own read/write grant. Rows are validated on read; entries whose
-- notebook no longer exists are ignored.
ALTER TABLE api_tokens ADD COLUMN notebook_access_json TEXT;
