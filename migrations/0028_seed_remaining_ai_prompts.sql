PRAGMA foreign_keys = ON;

-- Seed any default prompts added after 0027 (translate / fix-spelling-grammar / change-tone).
-- Safe for workspaces that already have the earlier seeds.

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_translate',
  id,
  '翻译',
  '翻译为指定目标语言，保留结构与格式',
  '将完整笔记翻译成用户指定的目标语言。保留原意、Markdown 结构、链接与代码块。只返回译文，不要评论。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_fix-spelling-grammar',
  id,
  '修正错别字与语法',
  '只修正错别字、语法与标点',
  '只修正拼写、语法与标点。不要改变语气、结构或含义。保持原语言与 Markdown 格式。只返回修正后的内容。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, name, description, instruction, created_at, updated_at
)
SELECT
  id || '_aiprompt_change-tone',
  id,
  '改变语气',
  '按指定语气重写，不改变含义',
  '按用户指定的语气重写内容，不改变原意。保持原语言与有用的 Markdown 格式。只返回改写后的内容。',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;
