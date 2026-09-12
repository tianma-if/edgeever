import type {
  AiAction,
  AiPromptParameterKind,
  AiPromptResultMode,
} from "./ai-assistant";

export type AiPromptSeedKey = Exclude<AiAction, "custom">;
export type AiPromptSeedLocale = "zh-CN" | "en-US" | "ru-RU";

export type AiPromptSeedTranslation = {
  name: string;
  description: string;
  instruction: string;
};

/** Factory prompt metadata. The top-level text is the Simplified Chinese fallback for legacy callers. */
export type AiPromptSeed = AiPromptSeedTranslation & {
  key: AiPromptSeedKey;
  action: AiPromptSeedKey;
  parameterKind: AiPromptParameterKind;
  resultMode: AiPromptResultMode;
  translations: Record<AiPromptSeedLocale, AiPromptSeedTranslation>;
};

const seed = (
  metadata: Omit<AiPromptSeed, keyof AiPromptSeedTranslation | "translations">,
  zhCN: AiPromptSeedTranslation,
  enUS: AiPromptSeedTranslation,
  ruRU: AiPromptSeedTranslation,
): AiPromptSeed => ({
  ...metadata,
  ...zhCN,
  translations: { "zh-CN": zhCN, "en-US": enUS, "ru-RU": ruRU },
});

export const normalizeAiPromptSeedLocale = (locale: string | null | undefined): AiPromptSeedLocale => {
  const normalized = locale?.toLowerCase() ?? "";

  if (normalized.startsWith("en")) {
    return "en-US";
  }

  if (normalized.startsWith("ru")) {
    return "ru-RU";
  }

  return "zh-CN";
};

export const localizeAiPromptSeed = (
  promptSeed: AiPromptSeed,
  locale: string | null | undefined,
): AiPromptSeedTranslation => promptSeed.translations[normalizeAiPromptSeedLocale(locale)];

/** Deterministic id for a seeded default prompt in a workspace. */
export const defaultAiPromptId = (workspaceId: string, seedKey: string) =>
  `${workspaceId}_aiprompt_${seedKey}`;

/** Parse legacy deterministic ids. New code should use the persisted seedKey field instead. */
export const parseDefaultAiPromptKey = (promptId: string): AiPromptSeedKey | null => {
  const match = /_aiprompt_([a-z0-9-]+)$/i.exec(promptId);
  if (!match) return null;
  const key = match[1] as AiPromptSeedKey;
  return DEFAULT_AI_PROMPT_SEEDS.some((item) => item.key === key) ? key : null;
};

/**
 * Single application catalog for default prompt behavior and localized copy.
 * Persisted rows only contain user overrides; untouched defaults are materialized from this catalog.
 */
export const DEFAULT_AI_PROMPT_SEEDS: readonly AiPromptSeed[] = [
  seed(
    { key: "summarize", action: "summarize", parameterKind: "none", resultMode: "append" },
    {
      name: "总结",
      description: "压缩全文，提炼主题、结论与可执行结果",
      instruction: [
        "对笔记做真正的精简总结，不要逐句改写、同义复述或回声式重写。",
        "识别中心主题、主要主张、关键结论与可执行结果。",
        "省略重复、修辞、举例、引语和次要细节，除非它们对理解关键结论必不可少。",
        "较长笔记目标约为原文 20–30% 篇幅，用 3–7 条简洁 Markdown 要点；短笔记用 1–3 句即可。",
        "不要大段照搬原文，也不要添加原文没有的信息。",
        "保持笔记原语言，只返回 Markdown 总结。",
      ].join(""),
    },
    {
      name: "Summarize",
      description: "Condense the note into its topic, conclusions, and actionable outcomes",
      instruction: [
        "Create a genuinely condensed summary of the note rather than rewriting, paraphrasing line by line, or echoing it. ",
        "Identify the central topic, main claims, essential conclusions, and actionable outcomes. ",
        "Omit repetition, rhetorical phrasing, examples, quotations, and minor details unless necessary to understand a key conclusion. ",
        "For a substantial note, target roughly 20–30% of the source length and use 3–7 concise Markdown bullet points; for a short note, use 1–3 concise sentences. ",
        "Do not reproduce long passages verbatim or add facts that are not present in the source. ",
        "Preserve the note's language and return only the summary in Markdown.",
      ].join(""),
    },
    {
      name: "Суммировать",
      description: "Сжать заметку до темы, выводов и практических результатов",
      instruction: [
        "Сделай по-настоящему сжатое резюме заметки, а не переписывай её построчно, не пересказывай синонимами и не повторяй вслед за текстом. ",
        "Определи центральную тему, основные утверждения, ключевые выводы и практические результаты. ",
        "Опусти повторы, риторические обороты, примеры, цитаты и второстепенные детали, если только они не нужны для понимания ключевого вывода. ",
        "Для объёмной заметки ориентируйся примерно на 20–30% от исходной длины и используй 3–7 сжатых пунктов Markdown; для короткой — 1–3 предложения. ",
        "Не воспроизводи длинные отрывки дословно и не добавляй факты, которых нет в источнике. ",
        "Сохрани язык заметки и верни только резюме в формате Markdown.",
      ].join(""),
    },
  ),
  seed(
    { key: "translate", action: "translate", parameterKind: "target-language", resultMode: "both" },
    {
      name: "翻译",
      description: "翻译为指定目标语言，保留结构与格式",
      instruction: "将完整笔记翻译成用户指定的目标语言。保留原意、Markdown 结构、链接与代码块。只返回译文，不要评论。",
    },
    {
      name: "Translate",
      description: "Translate into a selected language while preserving formatting",
      instruction: "Translate the complete note into the target language specified by the user. Preserve its meaning, Markdown structure, links, and code blocks. Return only the translated note without commentary.",
    },
    {
      name: "Перевести",
      description: "Перевести на выбранный язык с сохранением структуры и форматирования",
      instruction: "Переведи всю заметку на указанный пользователем целевой язык. Сохрани смысл, структуру Markdown, ссылки и блоки кода. Верни только перевод, без комментариев.",
    },
  ),
  seed(
    { key: "improve-writing", action: "improve-writing", parameterKind: "none", resultMode: "both" },
    {
      name: "润色",
      description: "校正语言并提升文字的清晰度与流畅度",
      instruction: "润色内容，修正错别字、语法与标点，改善用词、句式、清晰度和流畅度，但不要改变原意或刻意缩短内容。保持原语言与有用的 Markdown 格式。只返回润色后的内容。",
    },
    {
      name: "Polish",
      description: "Correct the language and improve clarity and flow",
      instruction: "Polish the content by correcting spelling, grammar, and punctuation and improving word choice, sentence structure, clarity, and flow. Do not change its meaning or deliberately shorten it. Preserve its language and useful Markdown formatting. Return only the polished content.",
    },
    {
      name: "Отредактировать",
      description: "Исправить язык и улучшить ясность и плавность текста",
      instruction: "Отредактируй текст: исправь орфографию, грамматику и пунктуацию, улучши выбор слов, структуру предложений, ясность и плавность. Не меняй смысл и не сокращай намеренно. Сохрани язык оригинала и полезное форматирование Markdown. Верни только отредактированный текст.",
    },
  ),
  seed(
    { key: "make-shorter", action: "make-shorter", parameterKind: "none", resultMode: "both" },
    {
      name: "精炼表达",
      description: "删去重复与冗余，让表达更简洁有力",
      instruction: "精炼内容，删除重复、空话和不必要的修饰，合并可以合并的句子，使表达简洁、清晰、有力。保留所有关键事实、观点与原意，不要添加新信息。保持原语言与有用的 Markdown 格式。只返回精炼后的内容。",
    },
    {
      name: "Make concise",
      description: "Remove repetition and make the writing concise and direct",
      instruction: "Refine the content by removing repetition, filler, and unnecessary modifiers and by combining sentences where useful. Make it concise, clear, and direct while preserving every key fact, claim, and the original meaning. Do not add new information. Preserve its language and useful Markdown formatting. Return only the refined content.",
    },
    {
      name: "Сделать короче",
      description: "Убрать повторы и сделать текст кратким и прямым",
      instruction: "Отредактируй текст: убери повторы, воду и лишние украшения, объедини предложения, где это уместно. Сделай изложение кратким, ясным и прямым, сохранив все ключевые факты, утверждения и исходный смысл. Не добавляй новую информацию. Сохрани язык оригинала и полезное форматирование Markdown. Верни только отредактированный текст.",
    },
  ),
  seed(
    { key: "rewrite-proofread", action: "rewrite-proofread", parameterKind: "none", resultMode: "both" },
    {
      name: "转为小红书风格",
      description: "改写成自然、有吸引力的小红书笔记",
      instruction: "将内容改写成适合小红书发布的笔记：生成吸引人的标题，使用自然、有亲和力的口吻、短段落和清晰层次，可适量加入贴合语义的 Emoji，并在结尾给出 3–8 个相关话题标签。保留原文的关键事实与观点，不夸大效果，不编造经历、数据或结论。只返回可直接发布的内容。",
    },
    {
      name: "Convert to Xiaohongshu style",
      description: "Rewrite as a natural and engaging Xiaohongshu post",
      instruction: "Rewrite the content as a Xiaohongshu-ready post. Add an engaging title, use a natural and approachable voice, short paragraphs, and clear structure, include a few contextually appropriate emoji, and end with 3–8 relevant hashtags. Preserve the source's key facts and claims without exaggerating results or inventing experiences, data, or conclusions. Return only the publishable post.",
    },
    {
      name: "В стиле Xiaohongshu",
      description: "Переписать как естественный и увлекательный пост для Xiaohongshu",
      instruction: "Перепиши текст как пост, готовый к публикации в Xiaohongshu: добавь привлекательный заголовок, используй естественный и дружелюбный тон, короткие абзацы и чёткую структуру, добавь несколько уместных по смыслу эмодзи и заверши 3–8 релевантными хештегами. Сохрани ключевые факты и утверждения источника, не преувеличивай результаты и не выдумывай опыт, данные или выводы. Верни только готовый к публикации пост.",
    },
  ),
  seed(
    { key: "simplify-language", action: "simplify-language", parameterKind: "none", resultMode: "both" },
    {
      name: "转为推特风格",
      description: "改写成简洁、有观点的推文或推文串",
      instruction: "将内容改写成适合推特发布的文本：开头直接抓住重点，表达简洁、有观点、易读。内容较短时输出一条推文；无法在一条内保留关键信息时，输出带序号的精简推文串。只在确有帮助时使用少量标签。保留原文事实与立场，不制造噱头或编造信息。只返回可直接发布的内容。",
    },
    {
      name: "Convert to X (Twitter) style",
      description: "Rewrite as a concise, opinionated post or thread",
      instruction: "Rewrite the content for X (Twitter): lead with the main point and make it concise, opinionated, and easy to scan. Return one post when the key information fits; otherwise return a compact numbered thread. Use hashtags sparingly and only when useful. Preserve the source's facts and position without manufacturing hype or information. Return only the publishable post or thread.",
    },
    {
      name: "В стиле X (Twitter)",
      description: "Переписать как краткий пост или тред с позицией",
      instruction: "Перепиши текст для X (Twitter): начинай сразу с главного, формулируй кратко, с позицией и удобно для чтения. Если ключевая информация умещается — верни один пост; если нет — компактный нумерованный тред. Используй хештеги умеренно и только когда это уместно. Сохрани факты и позицию источника, не создавай искусственного ажиотажа и не выдумывай информацию. Верни только готовый к публикации пост или тред.",
    },
  ),
];

export const getDefaultAiPromptSeed = (key: string) =>
  DEFAULT_AI_PROMPT_SEEDS.find((item) => item.key === key) ?? null;
