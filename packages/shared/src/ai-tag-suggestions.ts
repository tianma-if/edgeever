export const DEFAULT_AI_TAG_SUGGESTION_PROMPT_EN = [
  "Suggest concise tags that classify the supplied note.",
  "Derive every tag solely from a concrete topic explicitly supported by the title or note content.",
  "Relevance is mandatory: never invent a topic, and prefer no tag over a weak or generic match.",
  "Return zero to seven tags.",
  "Avoid duplicates, near-duplicates, overly broad labels, sentences, and leading hash signs.",
  "Use the note's language.",
].join(" ");

export const DEFAULT_AI_TAG_SUGGESTION_PROMPT_ZH_CN = [
  "为给定笔记建议简洁的分类标签。",
  "每个标签必须仅来自标题或正文明确支持的具体主题。",
  "相关性是硬性要求：不得臆造主题；宁可不返回标签，也不要给出牵强或宽泛的匹配。",
  "返回零到七个标签。",
  "避免重复、近义重复、过于宽泛的标签、完整句子和开头的井号。",
  "使用笔记本身的语言。",
].join("");

export const getDefaultAiTagSuggestionPrompt = (locale?: string) =>
  locale?.toLocaleLowerCase().startsWith("zh")
    ? DEFAULT_AI_TAG_SUGGESTION_PROMPT_ZH_CN
    : DEFAULT_AI_TAG_SUGGESTION_PROMPT_EN;

export const DEFAULT_AI_TAG_SUGGESTION_PROMPT = DEFAULT_AI_TAG_SUGGESTION_PROMPT_EN;
