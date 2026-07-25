PRAGMA foreign_keys = ON;

-- Replace the original oversized demo template with a compact, reusable example.
DELETE FROM memo_templates
WHERE name = '产品周报模板'
  AND description = '用于每周产品进展记录';

DELETE FROM memo_templates
WHERE name = '项目周报模板'
  AND description = '每周同步项目进展、风险与下一步计划';

INSERT OR IGNORE INTO memo_templates (
  id,
  workspace_id,
  name,
  description,
  title,
  content_json,
  content_markdown,
  tags_json
)
SELECT
  id || '_template_project_weekly',
  id,
  '项目周报模板',
  '每周同步项目进展、风险与下一步计划',
  '项目周报｜第 {{周次}} 周',
  '{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"本周进展"}]},{"type":"paragraph"},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"关键成果"}]},{"type":"paragraph"},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"风险与阻塞"}]},{"type":"paragraph"},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"下周计划"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph"}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"需要协助"}]},{"type":"paragraph"}]}',
  '## 本周进展\n\n- \n\n## 关键成果\n\n- \n\n## 风险与阻塞\n\n- \n\n## 下周计划\n\n- [ ] \n\n## 需要协助\n\n- ',
  '["项目管理","周报"]'
FROM workspaces;
