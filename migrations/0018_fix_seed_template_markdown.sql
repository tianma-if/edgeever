PRAGMA foreign_keys = ON;

-- SQLite string literals do not interpret backslash-n as a line break.
UPDATE memo_templates
SET content_markdown = '## 本周进展' || char(10) || char(10) || '- ' || char(10) || char(10) ||
  '## 关键成果' || char(10) || char(10) || '- ' || char(10) || char(10) ||
  '## 风险与阻塞' || char(10) || char(10) || '- ' || char(10) || char(10) ||
  '## 下周计划' || char(10) || char(10) || '- [ ] ' || char(10) || char(10) ||
  '## 需要协助' || char(10) || char(10) || '- '
WHERE name = '项目周报模板'
  AND description = '每周同步项目进展、风险与下一步计划';
