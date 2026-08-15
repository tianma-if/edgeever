PRAGMA foreign_keys = ON;

-- Five starter templates cover the most common workflows. Remove only the
-- untouched post-mortem preset; edited copies remain ordinary user templates.
DELETE FROM memo_templates
WHERE id = workspace_id || '_template_post-mortem'
  AND name = '问题排查与复盘'
  AND description = '记录故障现象、根因分析 (5 Whys) 与防范机制。'
  AND title = '问题排查与复盘'
  AND updated_at = created_at;
