-- Simplify notebook-scoped API tokens to a whitelist model (PR #820).
--
-- Each token now carries one access level (read-only or read/write) that
-- applies to the whole whitelist of granted notebook subtrees. The previous
-- per-notebook read/write flags and the configurable default policy are
-- folded into:
--   notebook_access_json: JSON array of {notebookId, read, write} objects
--   notebook_access_level: 'read' | 'write'
--
-- Migration of existing (0094-era object grant) rows:
-- - NULL grants stay NULL (unrestricted legacy tokens).
-- - The array is validated ITEM BY ITEM, exactly like the runtime parser:
--   every item must be an object with a non-empty notebookId and boolean
--   read/write. If ANY item is malformed the WHOLE record fails closed to an
--   empty whitelist (dropping the bad item and keeping the good ones would
--   re-open access the parser denies).
-- - Valid explicit deny entries (read=false, write=false) are dropped: under
--   the whitelist model a notebook is either on the list or not.
-- - A whitelist entry with write=true anywhere keeps level 'write';
--   otherwise 'read'.
-- - The default policy column is no longer read; it is cleared.
--
-- Only arrays whose items are ALL objects are transformed here. String arrays
-- (the output of an earlier revision of this migration) and mixed arrays are
-- left untouched for 0096, which distinguishes the legitimate string-array
-- whitelist from corrupted data. This keeps 0095 from calling json_extract on
-- a bare string element (which would raise "malformed JSON").
ALTER TABLE api_tokens ADD COLUMN notebook_access_level TEXT
  CHECK (notebook_access_level IS NULL OR notebook_access_level IN ('read', 'write'));

-- 1. Transform all-object arrays, validating every item.
UPDATE api_tokens
SET notebook_access_json = CASE
    WHEN EXISTS (
      SELECT 1 FROM json_each(notebook_access_json) je
      WHERE json_type(je.value, '$.notebookId') IS NOT 'text'
         OR trim(COALESCE(json_extract(je.value, '$.notebookId'), '')) = ''
         OR COALESCE(json_type(je.value, '$.read'), '') NOT IN ('true', 'false')
         OR COALESCE(json_type(je.value, '$.write'), '') NOT IN ('true', 'false')
    ) THEN '[]'
    ELSE (
      SELECT json_group_array(
        json_object(
          'notebookId', json_extract(je.value, '$.notebookId'),
          'read', json('true'),
          'write',
            CASE WHEN EXISTS (
              SELECT 1 FROM json_each(notebook_access_json) jw
              WHERE json_extract(jw.value, '$.write') = 1
            ) THEN json('true') ELSE json('false') END
        )
      )
      FROM json_each(notebook_access_json) je
      WHERE json_extract(je.value, '$.read') = 1
         OR json_extract(je.value, '$.write') = 1
    )
  END,
  notebook_access_level = CASE
    WHEN EXISTS (
      SELECT 1 FROM json_each(notebook_access_json) je
      WHERE json_type(je.value, '$.notebookId') IS NOT 'text'
         OR trim(COALESCE(json_extract(je.value, '$.notebookId'), '')) = ''
         OR COALESCE(json_type(je.value, '$.read'), '') NOT IN ('true', 'false')
         OR COALESCE(json_type(je.value, '$.write'), '') NOT IN ('true', 'false')
    ) THEN 'read'
    WHEN EXISTS (
      SELECT 1 FROM json_each(notebook_access_json) je
      WHERE json_extract(je.value, '$.write') = 1
    ) THEN 'write'
    ELSE 'read'
  END
WHERE notebook_access_json IS NOT NULL
  AND json_valid(notebook_access_json)
  AND json_type(notebook_access_json) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(notebook_access_json) je WHERE je.type != 'object'
  );

-- 2. Invalid JSON or a non-array value fails closed.
UPDATE api_tokens
SET notebook_access_json = '[]',
    notebook_access_level = 'read'
WHERE notebook_access_json IS NOT NULL
  AND (NOT json_valid(notebook_access_json) OR json_type(notebook_access_json) != 'array');

UPDATE api_tokens
SET notebook_default_access = NULL;
