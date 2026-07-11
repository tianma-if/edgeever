INSERT INTO notebooks (id, parent_id, name, slug, icon, color, sort_order)
VALUES
  ('nb_inbox', NULL, '等待分类', 'inbox', 'notebook', '#0f766e', 10),
  ('nb_projects', NULL, '工作项目', 'work-projects', 'notebook', '#2563eb', 20),
  ('nb_learning', NULL, '学习资料', 'learning-resources', 'notebook', '#7c3aed', 30),
  ('nb_creative', NULL, '灵感创作', 'creative-ideas', 'notebook', '#db2777', 40),
  ('nb_personal', NULL, '生活个人', 'personal-life', 'notebook', '#ea580c', 50);

INSERT INTO memos (
  id,
  notebook_id,
  title,
  excerpt,
  tags_json,
  created_by,
  updated_by
)
VALUES (
  'memo_welcome',
  'nb_inbox',
  '欢迎来到 EdgeEver',
  '这是第一条 EdgeEver 笔记，三栏、边缘、Agent-ready。',
  json_array('edgeever', 'welcome'),
  'system',
  'system'
);

INSERT INTO memo_contents (
  memo_id,
  content_json,
  content_markdown,
  content_text,
  content_hash,
  revision
)
VALUES (
  'memo_welcome',
  json('{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"欢迎来到 EdgeEver"}]},{"type":"paragraph","content":[{"type":"text","text":"这是第一条 EdgeEver 笔记，三栏、边缘、Agent-ready。"}]},{"type":"paragraph","content":[{"type":"text","text":"接下来可以创建笔记本、写笔记、搜索内容，并把多条笔记合并成一条新的长期笔记。"}]}]}'),
  '## 欢迎来到 EdgeEver

这是第一条 EdgeEver 笔记，三栏、边缘、Agent-ready。

接下来可以创建笔记本、写笔记、搜索内容，并把多条笔记合并成一条新的长期笔记。',
  '欢迎来到 EdgeEver 这是第一条 EdgeEver 笔记，三栏、边缘、Agent-ready。 接下来可以创建笔记本、写笔记、搜索内容，并把多条笔记合并成一条新的长期笔记。',
  'seed',
  0
);

INSERT INTO memos_fts (memo_id, title, content_text, tags)
VALUES (
  'memo_welcome',
  '欢迎来到 EdgeEver',
  '欢迎来到 EdgeEver 这是第一条 EdgeEver 笔记，三栏、边缘、Agent-ready。 接下来可以创建笔记本、写笔记、搜索内容，并把多条笔记合并成一条新的长期笔记。',
  'edgeever welcome'
);
