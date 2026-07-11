PRAGMA foreign_keys = ON;

UPDATE notebooks
SET
  parent_id = NULL,
  name = '绛夊緟鍒嗙被',
  slug = 'inbox',
  icon = 'notebook',
  color = '#0f766e',
  sort_order = 10,
  is_deleted = 0,
  deleted_at = NULL,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'nb_inbox'
   OR slug = 'inbox'
   OR name = '绛夊緟鍒嗙被';

INSERT INTO notebooks (id, parent_id, name, slug, icon, color, sort_order)
SELECT 'nb_inbox', NULL, '绛夊緟鍒嗙被', 'inbox', 'notebook', '#0f766e', 10
WHERE NOT EXISTS (
  SELECT 1
  FROM notebooks
  WHERE id = 'nb_inbox'
     OR slug = 'inbox'
     OR name = '绛夊緟鍒嗙被'
);
