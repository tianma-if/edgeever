-- Simplify notebook-scoped API tokens to a whitelist model (PR #820).
--
-- Each token now carries one access level (read-only or read/write) that
-- applies to the whole whitelist of granted notebook subtrees. The previous
-- per-notebook read/write flags and the configurable default policy are
-- folded into:
--   notebook_access_json: JSON array of {notebookId, read, write} objects
--   notebook_access_level: 'read' | 'write'
--
-- Migration of existing rows:
-- - NULL grants stay NULL (unrestricted legacy tokens).
-- - A whitelist entry with write=true anywhere keeps level 'write';
--   otherwise 'read'.
-- - Explicit deny entries (read=false, write=false) are dropped: under the
--   whitelist model a notebook is either on the list or not.
-- - Corrupted / non-array grant JSON fails closed to an empty whitelist.
-- - The default policy column is no longer read; it is cleared.
--
-- The emitted objects use the same shape the runtime parser expects, so a
-- fresh install needs no further conversion. Instances that already ran an
-- earlier revision of this migration (which stored a plain string array) are
-- normalized by 0096.
ALTER TABLE api_tokens ADD COLUMN notebook_access_level TEXT
  CHECK (notebook_access_level IS NULL OR notebook_access_level IN ('read', 'write'));

UPDATE api_tokens
SET notebook_access_json = (
  SELECT json_group_array(
    json_object(
      'notebookId', json_extract(value, '$.notebookId'),
      'read', json('true'),
      'write', CASE WHEN json_extract(value, '$.write') = 1 THEN json('true') ELSE json('false') END
    )
  )
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
WHERE notebook_access_json IS NOT NULL
  AND json_valid(notebook_access_json)
  AND json_type(notebook_access_json) = 'array';

-- Corrupted grant rows (invalid JSON or non-array) fail closed: an empty
-- whitelist with the read level, matching the runtime parser's behaviour.
UPDATE api_tokens
SET notebook_access_json = '[]',
    notebook_access_level = 'read'
WHERE notebook_access_json IS NOT NULL
  AND (NOT json_valid(notebook_access_json) OR json_type(notebook_access_json) != 'array');

UPDATE api_tokens
SET notebook_default_access = NULL;
