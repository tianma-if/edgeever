PRAGMA foreign_keys = ON;

-- Remove the untouched legacy project-weekly seed. If a user edited it, keep
-- it as an ordinary custom template alongside the new starter templates.
DELETE FROM memo_templates
WHERE id = workspace_id || '_template_project_weekly'
  AND name = '项目周报模板'
  AND description = '每周同步项目进展、风险与下一步计划'
  AND title = '项目周报｜第 {{周次}} 周'
  AND updated_at = created_at;

-- Existing workspaces have no persisted locale preference, so migrate them
-- with the historical Simplified Chinese catalog. New workspaces use the
-- request language in workspace-provisioning.ts.
WITH seed_catalog AS (
  SELECT
    json_extract(value, '$.key') AS seed_key,
    json_extract(value, '$.name') AS name,
    json_extract(value, '$.description') AS description,
    json_extract(value, '$.contentMarkdown') AS content_markdown,
    json_extract(value, '$.tags') AS tags_json
  FROM json_each('[
    {"key":"quick-note","name":"灵感速记","description":"快速捕捉闪念、临时灵感、资料链接与即刻行动。","contentMarkdown":"## 💡 闪念记录\n\n- \n\n## 📌 背景与补充说明\n\n\n\n## 🚀 下一步动作\n\n- [ ] ","tags":["template","quick-note"]},
    {"key":"meeting","name":"会议纪要","description":"结构化记录议题背景、核心结论与带负责人的待办事项。","contentMarkdown":"# 📝 会议纪要\n\n- **时间**：\n- **主持人/记录人**：\n- **参会人**：\n\n---\n\n## 🎯 会议目标\n\n- \n\n## 💬 核心讨论与决策\n\n1. **[议题 1]**\n   - 讨论要点：\n   - ✅ **决议**：\n\n2. **[议题 2]**\n   - 讨论要点：\n   - ✅ **决议**：\n\n## 📋 待办事项 (Action Items)\n\n- [ ] **[负责人]** 任务描述 (截止日期：MM-DD)\n- [ ] **[负责人]** 任务描述 (截止日期：MM-DD)\n","tags":["template","meeting"]},
    {"key":"weekly-review","name":"周报与进展复盘","description":"梳理本周核心产出、风险卡点与下周关键优先级。","contentMarkdown":"# 🗓️ 工作周报\n\n## 🌟 本周核心进展 (Highlights)\n\n- [x] **[项目/功能]** 完成情况与成果说明\n- [x] **[项目/功能]** 完成情况与成果说明\n\n## 🚧 卡点与风险 (Blockers & Risks)\n\n- ⚠️ **阻塞项**：原因及所需支持\n\n## 🎯 下周优先级 (Next Week Priorities)\n\n- [ ] \n- [ ] \n- [ ] \n\n## 💡 总结与思考\n\n- \n","tags":["template","weekly-review"]},
    {"key":"reading","name":"深度阅读卡片","description":"提炼核心观点、精妙摘录、个人理解与关联知识卡片。","contentMarkdown":"# 📖 深度阅读卡片\n\n- **书名/文章**：\n- **作者/来源**：\n- **推荐指数**：⭐⭐⭐⭐⭐\n\n---\n\n## 💡 一句话总结 (Key Takeaway)\n\n> \n\n## ✍️ 核心观点与金句摘录\n\n> [摘录内容]\n> —— *原书/原文*\n\n## 🧠 我的理解与延伸思考\n\n- \n\n## 🔗 关联知识与行动\n\n- [ ] **落地实践**：\n","tags":["template","reading"]},
    {"key":"okr","name":"目标与任务拆解","description":"明确 OKR 目标、关键结果、里程碑与具体执行清单。","contentMarkdown":"# 🎯 目标拆解\n\n- **周期**：\n- **负责人**：\n\n---\n\n## 📌 目标 (Objective)\n\n> \n\n## 📈 关键结果 (Key Results)\n\n- **KR 1**：期望指标 -> 当前进度\n- **KR 2**：期望指标 -> 当前进度\n\n## 🗓️ 里程碑节点 (Milestones)\n\n- [ ] **阶段一 (日期)**：完成标的\n- [ ] **阶段二 (日期)**：完成标的\n\n## 📋 执行任务清单\n\n- [ ] \n- [ ] \n","tags":["template","okr"]},
    {"key":"post-mortem","name":"问题排查与复盘","description":"记录故障现象、根因分析 (5 Whys) 与防范机制。","contentMarkdown":"# 🔍 问题排查与复盘 (Post-mortem)\n\n- **发生时间**：\n- **影响范围**：\n- **处理状态**：已解决 / 处理中\n\n---\n\n## 🚨 故障现象与影响\n\n\n\n## 🛠️ 排查过程与解决方案\n\n1. \n2. \n\n## 🔬 根因分析 (Root Cause / 5 Whys)\n\n- **根本原因**：\n\n## 🛡️ 预防措施 (Action Items)\n\n- [ ] **[短期规避]** \n- [ ] **[长期优化]** \n","tags":["template","post-mortem"]}
  ]')
)
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
  workspaces.id || '_template_' || seed_catalog.seed_key,
  workspaces.id,
  seed_catalog.name,
  seed_catalog.description,
  seed_catalog.name,
  '{"type":"doc","content":[]}',
  seed_catalog.content_markdown,
  seed_catalog.tags_json
FROM workspaces
CROSS JOIN seed_catalog;
