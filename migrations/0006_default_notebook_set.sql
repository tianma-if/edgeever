PRAGMA foreign_keys = ON;

UPDATE notebooks
SET
  name = '宸ヤ綔椤圭洰',
  slug = 'work-projects',
  icon = 'notebook',
  color = '#2563eb',
  sort_order = 20,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'nb_projects'
  AND is_deleted = 0;

INSERT INTO notebooks (id, parent_id, name, slug, icon, color, sort_order)
SELECT 'nb_projects', NULL, '宸ヤ綔椤圭洰', 'work-projects', 'notebook', '#2563eb', 20
WHERE NOT EXISTS (
  SELECT 1 FROM notebooks WHERE id = 'nb_projects' OR slug = 'work-projects'
);

INSERT INTO notebooks (id, parent_id, name, slug, icon, color, sort_order)
SELECT 'nb_learning', NULL, '瀛︿範璧勬枡', 'learning-resources', 'notebook', '#7c3aed', 30
WHERE NOT EXISTS (
  SELECT 1 FROM notebooks WHERE id = 'nb_learning' OR slug = 'learning-resources'
);

INSERT INTO notebooks (id, parent_id, name, slug, icon, color, sort_order)
SELECT 'nb_creative', NULL, '鐏垫劅鍒涗綔', 'creative-ideas', 'notebook', '#db2777', 40
WHERE NOT EXISTS (
  SELECT 1 FROM notebooks WHERE id = 'nb_creative' OR slug = 'creative-ideas'
);

INSERT INTO notebooks (id, parent_id, name, slug, icon, color, sort_order)
SELECT 'nb_personal', NULL, '鐢熸椿涓汉', 'personal-life', 'notebook', '#ea580c', 50
WHERE NOT EXISTS (
  SELECT 1 FROM notebooks WHERE id = 'nb_personal' OR slug = 'personal-life'
);
