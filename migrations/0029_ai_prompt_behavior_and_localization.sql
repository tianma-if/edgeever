PRAGMA foreign_keys = ON;

-- Prompt execution behavior is explicit so editable prompt text is never interpreted from its id.
-- Per-field customization flags let untouched factory prompts be localized at read time.
ALTER TABLE ai_prompt_templates ADD COLUMN seed_key TEXT;
ALTER TABLE ai_prompt_templates ADD COLUMN action TEXT NOT NULL DEFAULT 'custom'
  CHECK (action IN (
    'summarize', 'extract-key-points', 'extract-todos', 'rewrite-proofread',
    'translate', 'improve-writing', 'fix-spelling-grammar', 'make-shorter',
    'make-longer', 'simplify-language', 'change-tone', 'continue-writing', 'custom'
  ));
ALTER TABLE ai_prompt_templates ADD COLUMN parameter_kind TEXT NOT NULL DEFAULT 'none'
  CHECK (parameter_kind IN ('none', 'target-language', 'tone'));
ALTER TABLE ai_prompt_templates ADD COLUMN result_mode TEXT NOT NULL DEFAULT 'both'
  CHECK (result_mode IN ('append', 'replace', 'both'));
ALTER TABLE ai_prompt_templates ADD COLUMN name_customized INTEGER NOT NULL DEFAULT 1
  CHECK (name_customized IN (0, 1));
ALTER TABLE ai_prompt_templates ADD COLUMN description_customized INTEGER NOT NULL DEFAULT 1
  CHECK (description_customized IN (0, 1));
ALTER TABLE ai_prompt_templates ADD COLUMN instruction_customized INTEGER NOT NULL DEFAULT 1
  CHECK (instruction_customized IN (0, 1));

UPDATE ai_prompt_templates
SET
  seed_key = substr(id, length(workspace_id) + 11),
  action = substr(id, length(workspace_id) + 11),
  parameter_kind = CASE substr(id, length(workspace_id) + 11)
    WHEN 'translate' THEN 'target-language'
    WHEN 'change-tone' THEN 'tone'
    ELSE 'none'
  END,
  result_mode = CASE substr(id, length(workspace_id) + 11)
    WHEN 'summarize' THEN 'append'
    WHEN 'extract-key-points' THEN 'append'
    WHEN 'extract-todos' THEN 'append'
    WHEN 'continue-writing' THEN 'append'
    ELSE 'both'
  END,
  name_customized = CASE WHEN
    (substr(id, length(workspace_id) + 11) = 'summarize' AND name = '总结') OR
    (substr(id, length(workspace_id) + 11) = 'extract-key-points' AND name = '提炼要点') OR
    (substr(id, length(workspace_id) + 11) = 'extract-todos' AND name = '提取待办') OR
    (substr(id, length(workspace_id) + 11) = 'rewrite-proofread' AND name = '改写与校对') OR
    (substr(id, length(workspace_id) + 11) = 'translate' AND name = '翻译') OR
    (substr(id, length(workspace_id) + 11) = 'improve-writing' AND name = '改进表达') OR
    (substr(id, length(workspace_id) + 11) = 'fix-spelling-grammar' AND name = '修正错别字与语法') OR
    (substr(id, length(workspace_id) + 11) = 'make-shorter' AND name = '缩短内容') OR
    (substr(id, length(workspace_id) + 11) = 'make-longer' AND name = '扩写内容') OR
    (substr(id, length(workspace_id) + 11) = 'simplify-language' AND name = '简化表达') OR
    (substr(id, length(workspace_id) + 11) = 'change-tone' AND name = '改变语气') OR
    (substr(id, length(workspace_id) + 11) = 'continue-writing' AND name = '继续写作')
    THEN 0 ELSE 1 END,
  description_customized = CASE WHEN
    (substr(id, length(workspace_id) + 11) = 'summarize' AND description = '压缩全文，提炼主题、结论与可执行结果') OR
    (substr(id, length(workspace_id) + 11) = 'extract-key-points' AND description = '提取最重要观点，输出简洁要点列表') OR
    (substr(id, length(workspace_id) + 11) = 'extract-todos' AND description = '识别可执行任务，生成任务清单') OR
    (substr(id, length(workspace_id) + 11) = 'rewrite-proofread' AND description = '润色全文并校对语法、标点与结构') OR
    (substr(id, length(workspace_id) + 11) = 'translate' AND description = '翻译为指定目标语言，保留结构与格式') OR
    (substr(id, length(workspace_id) + 11) = 'improve-writing' AND description = '提升表达清晰度与流畅度') OR
    (substr(id, length(workspace_id) + 11) = 'fix-spelling-grammar' AND description = '只修正错别字、语法与标点') OR
    (substr(id, length(workspace_id) + 11) = 'make-shorter' AND description = '删减冗余，保留关键事实') OR
    (substr(id, length(workspace_id) + 11) = 'make-longer' AND description = '在不编造事实的前提下扩写说明') OR
    (substr(id, length(workspace_id) + 11) = 'simplify-language' AND description = '用更通俗易懂的语言改写') OR
    (substr(id, length(workspace_id) + 11) = 'change-tone' AND description = '按指定语气重写，不改变含义') OR
    (substr(id, length(workspace_id) + 11) = 'continue-writing' AND description = '从笔记末尾自然续写')
    THEN 0 ELSE 1 END,
  instruction_customized = CASE WHEN
    (substr(id, length(workspace_id) + 11) = 'summarize' AND instruction = '对笔记做真正的精简总结，不要逐句改写或复述原文。提炼中心主题、主要观点、关键结论与可执行结果。去掉重复、修辞、举例和次要细节，除非它们对理解结论必不可少。较长笔记用 3–7 条简洁 Markdown 要点；短笔记用 1–3 句即可。不要大段照搬原文，也不要添加原文没有的信息。保持笔记原语言，只返回总结内容。') OR
    (substr(id, length(workspace_id) + 11) = 'extract-key-points' AND instruction = '提取笔记中最重要的要点，用简洁的 Markdown 列表输出。保持原语言，不要添加原文没有的信息。') OR
    (substr(id, length(workspace_id) + 11) = 'extract-todos' AND instruction = '从笔记中提取明确或隐含的待办事项，用 Markdown 任务列表（- [ ]）输出。保持原语言，不要编造任务。若没有可执行事项，用原文语言简短说明。') OR
    (substr(id, length(workspace_id) + 11) = 'rewrite-proofread' AND instruction = '改写并校对整篇笔记。修正拼写、语法、标点、清晰度与结构，不改变原意。保持原语言与 Markdown 格式，只返回修订后的完整内容。') OR
    (substr(id, length(workspace_id) + 11) = 'translate' AND instruction = '将完整笔记翻译成用户指定的目标语言。保留原意、Markdown 结构、链接与代码块。只返回译文，不要评论。') OR
    (substr(id, length(workspace_id) + 11) = 'improve-writing' AND instruction = '改进文字的清晰度、流畅度与用词，不改变原意。保持原语言与有用的 Markdown 格式，只返回改进后的内容。') OR
    (substr(id, length(workspace_id) + 11) = 'fix-spelling-grammar' AND instruction = '只修正拼写、语法与标点。不要改变语气、结构或含义。保持原语言与 Markdown 格式。只返回修正后的内容。') OR
    (substr(id, length(workspace_id) + 11) = 'make-shorter' AND instruction = '把内容改写得更简洁。去掉重复与废话，保留每一个重要事实。保持原语言与有用的 Markdown 格式，只返回缩短后的内容。') OR
    (substr(id, length(workspace_id) + 11) = 'make-longer' AND instruction = '扩写内容，补充有用的说明与更顺畅的过渡，但不要编造事实。保持原语言与有用的 Markdown 格式，只返回扩写后的内容。') OR
    (substr(id, length(workspace_id) + 11) = 'simplify-language' AND instruction = '用清晰、平实、更好懂的语言改写内容。保持原意、原语言与有用的 Markdown 格式，只返回简化后的内容。') OR
    (substr(id, length(workspace_id) + 11) = 'change-tone' AND instruction = '按用户指定的语气重写内容，不改变原意。保持原语言与有用的 Markdown 格式。只返回改写后的内容。') OR
    (substr(id, length(workspace_id) + 11) = 'continue-writing' AND instruction = '从笔记结束处自然续写。只返回新增续写内容，不要重复原文。保持原语言与 Markdown 风格。')
    THEN 0 ELSE 1 END
WHERE id = workspace_id || '_aiprompt_' || substr(id, length(workspace_id) + 11)
  AND substr(id, length(workspace_id) + 11) IN (
    'summarize', 'extract-key-points', 'extract-todos', 'rewrite-proofread',
    'translate', 'improve-writing', 'fix-spelling-grammar', 'make-shorter',
    'make-longer', 'simplify-language', 'change-tone', 'continue-writing'
  );

CREATE UNIQUE INDEX idx_ai_prompt_templates_workspace_seed
  ON ai_prompt_templates(workspace_id, seed_key)
  WHERE seed_key IS NOT NULL;
