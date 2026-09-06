PRAGMA foreign_keys = ON;

-- Seed each workspace with editable starter prompts (not locked "system" prompts).
-- IDs are deterministic per workspace so the insert is safe to re-run.

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_summarize',
  id,
  '总结',
  '压缩全文，提炼主题、结论与可执行结果',
  '对笔记做真正的精简总结，不要逐句改写或复述原文。提炼中心主题、主要观点、关键结论与可执行结果。去掉重复、修辞、举例和次要细节，除非它们对理解结论必不可少。较长笔记用 3–7 条简洁 Markdown 要点；短笔记用 1–3 句即可。不要大段照搬原文，也不要添加原文没有的信息。保持笔记原语言，只返回总结内容。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_extract-key-points',
  id,
  '提炼要点',
  '提取最重要观点，输出简洁要点列表',
  '提取笔记中最重要的要点，用简洁的 Markdown 列表输出。保持原语言，不要添加原文没有的信息。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_extract-todos',
  id,
  '提取待办',
  '识别可执行任务，生成任务清单',
  '从笔记中提取明确或隐含的待办事项，用 Markdown 任务列表（- [ ]）输出。保持原语言，不要编造任务。若没有可执行事项，用原文语言简短说明。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_rewrite-proofread',
  id,
  '改写与校对',
  '润色全文并校对语法、标点与结构',
  '改写并校对整篇笔记。修正拼写、语法、标点、清晰度与结构，不改变原意。保持原语言与 Markdown 格式，只返回修订后的完整内容。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_improve-writing',
  id,
  '改进表达',
  '提升表达清晰度与流畅度',
  '改进文字的清晰度、流畅度与用词，不改变原意。保持原语言与有用的 Markdown 格式，只返回改进后的内容。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_make-shorter',
  id,
  '缩短内容',
  '删减冗余，保留关键事实',
  '把内容改写得更简洁。去掉重复与废话，保留每一个重要事实。保持原语言与有用的 Markdown 格式，只返回缩短后的内容。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_make-longer',
  id,
  '扩写内容',
  '在不编造事实的前提下扩写说明',
  '扩写内容，补充有用的说明与更顺畅的过渡，但不要编造事实。保持原语言与有用的 Markdown 格式，只返回扩写后的内容。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_simplify-language',
  id,
  '简化表达',
  '用更通俗易懂的语言改写',
  '用清晰、平实、更好懂的语言改写内容。保持原意、原语言与有用的 Markdown 格式，只返回简化后的内容。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_continue-writing',
  id,
  '继续写作',
  '从笔记末尾自然续写',
  '从笔记结束处自然续写。只返回新增续写内容，不要重复原文。保持原语言与 Markdown 风格。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;
