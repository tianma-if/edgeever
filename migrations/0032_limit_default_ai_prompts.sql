PRAGMA foreign_keys = ON;

-- Retire the old system catalog completely. Rows created by users have no
-- seed_key and are unaffected, while edited legacy presets also leave the
-- catalog instead of lingering as unexpected custom prompts.
DELETE FROM ai_prompt_templates
WHERE seed_key IN (
  'extract-key-points', 'extract-todos', 'rewrite-proofread',
  'fix-spelling-grammar', 'make-shorter', 'make-longer',
  'simplify-language', 'change-tone', 'continue-writing'
);

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, seed_key, action, parameter_kind, result_mode,
  name, description, instruction,
  name_customized, description_customized, instruction_customized,
  created_at, updated_at
)
SELECT
  id || '_aiprompt_make-shorter', id, 'make-shorter', 'make-shorter', 'none', 'both',
  '精炼表达', '删去重复与冗余，让表达更简洁有力',
  '精炼内容，删除重复、空话和不必要的修饰，合并可以合并的句子，使表达简洁、清晰、有力。保留所有关键事实、观点与原意，不要添加新信息。保持原语言与有用的 Markdown 格式。只返回精炼后的内容。',
  0, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, seed_key, action, parameter_kind, result_mode,
  name, description, instruction,
  name_customized, description_customized, instruction_customized,
  created_at, updated_at
)
SELECT
  id || '_aiprompt_rewrite-proofread', id, 'rewrite-proofread', 'rewrite-proofread', 'none', 'both',
  '转为小红书风格', '改写成自然、有吸引力的小红书笔记',
  '将内容改写成适合小红书发布的笔记：生成吸引人的标题，使用自然、有亲和力的口吻、短段落和清晰层次，可适量加入贴合语义的 Emoji，并在结尾给出 3–8 个相关话题标签。保留原文的关键事实与观点，不夸大效果，不编造经历、数据或结论。只返回可直接发布的内容。',
  0, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;

INSERT OR IGNORE INTO ai_prompt_templates (
  id, workspace_id, seed_key, action, parameter_kind, result_mode,
  name, description, instruction,
  name_customized, description_customized, instruction_customized,
  created_at, updated_at
)
SELECT
  id || '_aiprompt_simplify-language', id, 'simplify-language', 'simplify-language', 'none', 'both',
  '转为推特风格', '改写成简洁、有观点的推文或推文串',
  '将内容改写成适合推特发布的文本：开头直接抓住重点，表达简洁、有观点、易读。内容较短时输出一条推文；无法在一条内保留关键信息时，输出带序号的精简推文串。只在确有帮助时使用少量标签。保留原文事实与立场，不制造噱头或编造信息。只返回可直接发布的内容。',
  0, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces;
