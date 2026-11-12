-- Simplify notebook-scoped API tokens to a whitelist model (PR #820).
--
-- Each token now carries one access level (read-only or read/write) that
-- applies to the whole whitelist of granted notebook subtrees. The previous
-- per-notebook read/write flags and the configurable default policy are
-- folded into:
--   notebook_access_json: JSON array of granted notebook ids
--   notebook_access_level: 'read' | 'write'
--
-- Migration of existing rows:
-- - NULL grants stay NULL (unrestricted legacy tokens).
-- - A whitelist entry with write=true anywhere keeps level 'write';
--   otherwise 'read'.
-- - Explicit deny entries (read=false, write=false) are dropped: under the
--   whitelist model a notebook is either on the list or not.
-- - The default policy column is no longer read; it is cleared.
ALTER TABLE api_tokens ADD COLUMN notebook_access_level TEXT
  CHECK (notebook_access_level IS NULL OR notebook_access_level IN ('read', 'write'));

UPDATE api_tokens
SET notebook_access_json = (
  SELECT json_group_array(json_extract(value, '$.notebookId'))
  FROM json_each(notebook_access_json)
  WHERE json_extract(value, '$.read') = 1
     OR json_extract(value, '$.write') = 1
),
 notebook_access_level = CASE
  WHEN EXISTS (
    SELECT 1 FROM json_each(notebook_access_json)
    WHERE json_extract(value, '$.write') = 1
  ) THEN 'write'
  ELSE 'read'
END
WHERE notebook_access_json IS NOT NULL;

UPDATE api_tokens
SET notebook_default_access = NULL;
