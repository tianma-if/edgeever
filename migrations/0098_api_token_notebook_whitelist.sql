-- Simplify notebook-scoped API tokens to a whitelist model (PR #820).
--
-- Each token now carries one access level (read-only or read/write) that
-- applies to the whole whitelist of granted notebook subtrees. The previous
-- per-notebook read/write flags and the configurable default policy are
-- folded into:
--   notebook_access_json: JSON array of {notebookId, read, write} objects
--   notebook_access_level: 'read' | 'write'
--
-- Migration of existing (pre-whitelist object grant) rows:
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
-- Only arrays whose items are ALL objects are transformed here. At this
-- (object-grant) stage a string array or any array with a non-object item is
-- CORRUPTED, not a whitelist: the runtime parser rejects it, so the whole
-- record fails closed to an empty whitelist in step 2 below. It must not be
-- left for 0099, which would otherwise mistake it for the legitimate
-- string-array output of the earlier whitelist migration and re-open access.
-- (The legitimate string-array whitelist only exists on instances where that
-- earlier migration already ran; there 0098 is already applied and skipped,
-- and 0099 handles it.) Restricting the transform to all-object arrays also
-- keeps 0098 from calling json_extract on a bare string element ("malformed
-- JSON").
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

-- 2. A string array (or any array holding a non-object item) at the object-grant
--    stage is corrupted, not a whitelist. Fail the WHOLE record closed so 0099
--    cannot later re-open it as a legacy string-array whitelist.
UPDATE api_tokens
SET notebook_access_json = '[]',
    notebook_access_level = 'read'
WHERE notebook_access_json IS NOT NULL
  AND json_valid(notebook_access_json)
  AND json_type(notebook_access_json) = 'array'
  AND EXISTS (
    SELECT 1 FROM json_each(notebook_access_json) je WHERE je.type != 'object'
  );

-- 3. Invalid JSON or a non-array value fails closed.
UPDATE api_tokens
SET notebook_access_json = '[]',
    notebook_access_level = 'read'
WHERE notebook_access_json IS NOT NULL
  AND (NOT json_valid(notebook_access_json) OR json_type(notebook_access_json) != 'array');

UPDATE api_tokens
SET notebook_default_access = NULL;
