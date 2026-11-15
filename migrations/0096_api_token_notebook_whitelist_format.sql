-- Normalize notebook_access_json to the runtime object format (PR #820).
--
-- 0095 folded the old per-notebook grants into a whitelist, but wrote it as a
-- plain JSON array of notebook id strings (["nb_a","nb_b"]). The runtime
-- parser (parseNotebookAccessJson) requires {notebookId, read, write} objects,
-- so a string array parses to an empty whitelist and silently revokes access.
--
-- This migration rewrites the whitelist into the object format. It is
-- idempotent: rows already stored as objects are re-emitted unchanged in
-- shape, so it is safe whether or not 0095's string-array output is present.
--
-- One access level applies to the whole whitelist (notebook_access_level), so
-- every entry is emitted with read=true and write matching that level. The
-- level itself is authoritative at resolution time; the per-entry booleans
-- only need to be well-formed for the parser.
--
-- Row handling:
-- - NULL whitelist stays NULL (unrestricted legacy tokens).
-- - Invalid JSON or a non-array value fails closed: empty whitelist, read.
-- - A string array (0095 output) or object array is normalized to objects.

-- 1. Corrupted / non-array rows fail closed.
UPDATE api_tokens
SET notebook_access_json = '[]',
    notebook_access_level = 'read'
WHERE notebook_access_json IS NOT NULL
  AND (NOT json_valid(notebook_access_json) OR json_type(notebook_access_json) != 'array');

-- 2. Normalize string arrays and object arrays to the uniform-level object
--    format. json_group_array over an empty array yields '[]', so an empty
--    whitelist stays empty.
UPDATE api_tokens
SET notebook_access_json = (
  SELECT json_group_array(
    json_object(
      'notebookId',
        CASE WHEN json_each.type = 'text' THEN json_each.value
             ELSE json_extract(json_each.value, '$.notebookId') END,
      'read', json('true'),
      'write',
        CASE WHEN COALESCE(notebook_access_level, 'read') = 'write'
             THEN json('true') ELSE json('false') END
    )
  )
  FROM json_each(notebook_access_json)
)
WHERE notebook_access_json IS NOT NULL
  AND json_valid(notebook_access_json)
  AND json_type(notebook_access_json) = 'array';
