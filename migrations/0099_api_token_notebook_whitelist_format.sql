-- Normalize notebook_access_json to the runtime object format (PR #820).
--
-- An earlier revision of the whitelist migration stored it as a plain JSON array of
-- notebook id strings (["nb_a","nb_b"]). The runtime parser
-- (parseNotebookAccessJson) requires {notebookId, read, write} objects, so a
-- string array parses to an empty whitelist and silently revokes access. This
-- migration converts that legitimate string-array whitelist into objects.
--
-- It is strict and idempotent, mirroring the runtime parser:
-- - NULL whitelist stays NULL (unrestricted legacy tokens).
-- - A LEGITIMATE old string-array whitelist is an array whose every item is a
--   non-empty string; it is converted to objects at the stored level.
-- - An all-object array is validated item by item; if ANY item is malformed
--   the whole record fails closed (never drop the bad item and keep the good).
-- - Mixed arrays, arrays containing empty strings / numbers / nulls, non-array
--   values and invalid JSON all fail closed to an empty whitelist.
--
-- One access level applies to the whole whitelist (notebook_access_level), so
-- every entry is emitted with read=true and write matching that level. The
-- level is authoritative at resolution time; the per-entry booleans only need
-- to be well-formed for the parser.

-- A. Legitimate old string-array whitelist: every item a non-empty string.
UPDATE api_tokens
SET notebook_access_json = (
    SELECT json_group_array(
      json_object(
        'notebookId', je.value,
        'read', json('true'),
        'write',
          CASE WHEN COALESCE(notebook_access_level, 'read') = 'write'
               THEN json('true') ELSE json('false') END
      )
    )
    FROM json_each(notebook_access_json) je
  ),
  notebook_access_level = COALESCE(notebook_access_level, 'read')
WHERE notebook_access_json IS NOT NULL
  AND json_valid(notebook_access_json)
  AND json_type(notebook_access_json) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(notebook_access_json) je
    WHERE je.type != 'text' OR trim(je.value) = ''
  );

-- B. All-object array: validate every item, then normalize to the uniform
--    level. Idempotent for rows 0098 already emitted as objects.
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
            CASE WHEN COALESCE(notebook_access_level, 'read') = 'write'
                 THEN json('true') ELSE json('false') END
        )
      )
      FROM json_each(notebook_access_json) je
    )
  END,
  notebook_access_level = COALESCE(notebook_access_level, 'read')
WHERE notebook_access_json IS NOT NULL
  AND json_valid(notebook_access_json)
  AND json_type(notebook_access_json) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(notebook_access_json) je WHERE je.type != 'object'
  );

-- C. Everything else non-null fails closed: invalid JSON, non-array values,
--    and arrays that still contain any non-object item (mixed string/object,
--    empty strings, numbers, nulls, booleans).
UPDATE api_tokens
SET notebook_access_json = '[]',
    notebook_access_level = 'read'
WHERE notebook_access_json IS NOT NULL
  AND (NOT json_valid(notebook_access_json) OR json_type(notebook_access_json) != 'array');

UPDATE api_tokens
SET notebook_access_json = '[]',
    notebook_access_level = 'read'
WHERE notebook_access_json IS NOT NULL
  AND json_valid(notebook_access_json)
  AND json_type(notebook_access_json) = 'array'
  AND EXISTS (
    SELECT 1 FROM json_each(notebook_access_json) je WHERE je.type != 'object'
  );
