import type {
  AiAction,
  AiPromptParameterKind,
  AiPromptResultMode,
} from "./ai-assistant";
import { resolveSupportedLocale } from "./i18n/locales";

export type AiPromptSeedKey = Exclude<AiAction, "custom">;
export type AiPromptSeedLocale = "zh-CN" | "en-US" | "ja" | "pl" | "ru";

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
  ja: AiPromptSeedTranslation,
  pl: AiPromptSeedTranslation,
  ru: AiPromptSeedTranslation,
): AiPromptSeed => ({
  ...metadata,
  ...zhCN,
  translations: { "zh-CN": zhCN, "en-US": enUS, ja, pl, ru },
});

export const normalizeAiPromptSeedLocale = (locale: string | null | undefined): AiPromptSeedLocale =>
  resolveSupportedLocale(locale);

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
      name: "精简总结",
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
      name: "要約する",
      description: "テーマ、結論、実行できる結果に圧縮する",
      instruction: [
        "ノートを本当に要約してください。逐語の言い換え、行ごとの書き換え、エコーのような再述はしないでください。",
        "中心テーマ、主要な主張、重要な結論、実行できる結果を抜き出してください。",
        "繰り返し、修辞、例示、引用、枝葉の詳細は、重要な結論を理解するのに必要でない限り省いてください。",
        "長いノートは原文のおよそ 20–30% を目安に、3–7 個の簡潔な Markdown 箇条書きにしてください。短いノートは 1–3 文で構いません。",
        "長い原文をそのまま写したり、原文にない事実を足したりしないでください。",
        "ノートの言語を保ち、Markdown の要約だけを返してください。",
      ].join(""),
    },
    {
      name: "Podsumuj",
      description: "Streść notatkę do tematu, wniosków i działań do podjęcia",
      instruction: [
        "Utwórz faktycznie skondensowane podsumowanie notatki, zamiast ją przepisywać, parafrazować zdanie po zdaniu lub powtarzać. ",
        "Wskaż główny temat, najważniejsze tezy, kluczowe wnioski i działania do podjęcia. ",
        "Pomiń powtórzenia, ozdobniki retoryczne, przykłady, cytaty i drobne szczegóły, chyba że są niezbędne do zrozumienia kluczowego wniosku. ",
        "W przypadku obszernej notatki celuj w około 20–30% długości oryginału i użyj 3–7 zwięzłych punktów listy Markdown; w przypadku krótkiej notatki wystarczą 1–3 zwięzłe zdania. ",
        "Nie przytaczaj dosłownie długich fragmentów i nie dodawaj faktów, których nie ma w oryginale. ",
        "Zachowaj język notatki i zwróć wyłącznie podsumowanie w formacie Markdown.",
      ].join(""),
    },
    {
      name: "Кратко",
      description: "Сжать заметку до темы, выводов и действий",
      instruction: [
        "Сделайте настоящее краткое изложение заметки, а не пересказ предложения за предложением и не повтор текста. ",
        "Выделите главную тему, основные мысли, ключевые выводы и действия. ",
        "Опустите повторы, риторику, примеры, цитаты и второстепенные детали, если без них вывод всё равно понятен. ",
        "Для длинной заметки ориентируйтесь примерно на 20–30% исходного объёма и 3–7 коротких пунктов Markdown; для короткой хватит 1–3 предложений. ",
        "Не копируйте длинные фрагменты дословно и не добавляйте факты, которых нет в тексте. ",
        "Сохраните язык заметки и верните только краткое изложение в Markdown.",
      ].join(""),
    },
  ),
  seed(
    { key: "translate", action: "translate", parameterKind: "target-language", resultMode: "both" },
    {
      name: "全文翻译",
      description: "翻译为指定目标语言，保留结构与格式",
      instruction: "将完整笔记翻译成用户指定的目标语言。保留原意、Markdown 结构、链接与代码块。只返回译文，不要评论。",
    },
    {
      name: "Translate",
      description: "Translate into a selected language while preserving formatting",
      instruction: "Translate the complete note into the target language specified by the user. Preserve its meaning, Markdown structure, links, and code blocks. Return only the translated note without commentary.",
    },
    {
      name: "翻訳する",
      description: "指定した言語へ翻訳し、構造と書式を残す",
      instruction: "ノート全体を、ユーザーが指定した目標言語へ翻訳してください。意味、Markdown の構造、リンク、コードブロックは残してください。解説は付けず、訳文だけを返してください。",
    },
    {
      name: "Przetłumacz",
      description: "Przetłumacz na wybrany język, zachowując formatowanie",
      instruction: "Przetłumacz całą notatkę na język docelowy wskazany przez użytkownika. Zachowaj jej znaczenie, strukturę Markdown, linki i bloki kodu. Zwróć wyłącznie przetłumaczoną notatkę, bez komentarzy.",
    },
    {
      name: "Перевести",
      description: "Перевести на выбранный язык, сохранив оформление",
      instruction: "Переведите заметку целиком на язык, который указал пользователь. Сохраните смысл, структуру Markdown, ссылки и блоки кода. Верните только перевод, без комментариев.",
    },
  ),
  seed(
    { key: "improve-writing", action: "improve-writing", parameterKind: "none", resultMode: "both" },
    {
      name: "润色表达",
      description: "校正语言并提升文字的清晰度与流畅度",
      instruction: "润色内容，修正错别字、语法与标点，改善用词、句式、清晰度和流畅度，但不要改变原意或刻意缩短内容。保持原语言与有用的 Markdown 格式。只返回润色后的内容。",
    },
    {
      name: "Polish",
      description: "Correct the language and improve clarity and flow",
      instruction: "Polish the content by correcting spelling, grammar, and punctuation and improving word choice, sentence structure, clarity, and flow. Do not change its meaning or deliberately shorten it. Preserve its language and useful Markdown formatting. Return only the polished content.",
    },
    {
      name: "文章を整える",
      description: "誤字と文法を直し、わかりやすさと流れを上げる",
      instruction: "内容を整えてください。誤字、文法、句読点を直し、語彙、文の形、明瞭さ、流れを改善します。意味を変えたり、意図的に短くしたりしないでください。元の言語と有用な Markdown 書式は残してください。整えた本文だけを返してください。",
    },
    {
      name: "Popraw styl",
      description: "Popraw język oraz zwiększ przejrzystość i płynność tekstu",
      instruction: "Dopracuj treść: popraw pisownię, gramatykę i interpunkcję oraz ulepsz dobór słów, budowę zdań, przejrzystość i płynność. Nie zmieniaj jej znaczenia ani celowo jej nie skracaj. Zachowaj jej język i przydatne formatowanie Markdown. Zwróć wyłącznie dopracowaną treść.",
    },
    {
      name: "Улучшить текст",
      description: "Исправить язык и сделать текст яснее и плавнее",
      instruction: "Улучшите текст: исправьте орфографию, грамматику и пунктуацию, подберите слова, структуру фраз, ясность и плавность. Не меняйте смысл и не сокращайте текст нарочно. Сохраните язык и полезное оформление Markdown. Верните только улучшенный текст.",
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
      name: "簡潔にする",
      description: "重複と冗長さを削り、短くはっきり書く",
      instruction: "内容を簡潔にしてください。繰り返し、空疎な言い回し、不要な修飾を削り、まとめられる文はまとめて、短く、はっきり、力強くしてください。重要な事実、主張、元の意味はすべて残し、新しい情報は足さないでください。元の言語と有用な Markdown 書式は残してください。簡潔にした本文だけを返してください。",
    },
    {
      name: "Skróć i uprość",
      description: "Usuń powtórzenia i napisz tekst zwięźle i konkretnie",
      instruction: "Dopracuj treść, usuwając powtórzenia, puste frazy i zbędne określenia oraz łącząc zdania tam, gdzie to pomaga. Spraw, by tekst był zwięzły, jasny i konkretny, zachowując każdy kluczowy fakt, tezę i pierwotne znaczenie. Nie dodawaj nowych informacji. Zachowaj jej język i przydatne formatowanie Markdown. Zwróć wyłącznie dopracowaną treść.",
    },
    {
      name: "Короче и яснее",
      description: "Убрать повторы и написать короче и прямее",
      instruction: "Сократите текст: уберите повторы, пустые фразы и лишние определения, объедините предложения, где это уместно. Сделайте его коротким, ясным и прямым, сохранив каждый важный факт, мысль и исходный смысл. Не добавляйте новой информации. Сохраните язык и полезное оформление Markdown. Верните только сокращённый текст.",
    },
  ),
  seed(
    { key: "extract-todos", action: "extract-todos", parameterKind: "none", resultMode: "append" },
    {
      name: "提取待办",
      description: "识别可执行任务，生成任务清单",
      instruction: "从笔记中提取明确或隐含的可执行任务，用 Markdown 任务列表（- [ ]）输出。保持原语言，不要编造任务。若没有可执行事项，用原文语言简短说明。",
    },
    {
      name: "Extract tasks",
      description: "Identify actionable work and produce a task list",
      instruction: "Extract explicit or implied actionable tasks from the note as a Markdown task list using '- [ ]'. Preserve its language and do not invent tasks. If there are no actionable tasks, say so briefly in the note's language.",
    },
    {
      name: "タスクを抜き出す",
      description: "実行できる作業を見つけ、チェックリストにする",
      instruction: "ノートから明示または含意された実行可能なタスクを抜き出し、Markdown のタスクリスト（- [ ]）で出力してください。ノートの言語を保ち、タスクを捏造しないでください。実行できることがなければ、ノートの言語で短くそう書いてください。",
    },
    {
      name: "Wyodrębnij zadania",
      description: "Znajdź działania do wykonania i utwórz listę zadań",
      instruction: "Wyodrębnij z notatki jawne lub domniemane zadania do wykonania jako listę zadań Markdown z użyciem '- [ ]'. Zachowaj jej język i nie wymyślaj zadań. Jeśli nie ma zadań do wykonania, napisz to krótko w języku notatki.",
    },
    {
      name: "Выделить задачи",
      description: "Найти дела и составить список задач",
      instruction: "Выделите из заметки явные и подразумеваемые дела и оформите их списком задач Markdown через '- [ ]'. Сохраните язык заметки и не придумывайте задачи. Если дел нет, коротко напишите об этом на языке заметки.",
    },
  ),
  seed(
    { key: "continue-writing", action: "continue-writing", parameterKind: "none", resultMode: "append" },
    {
      name: "继续写作",
      description: "从笔记末尾自然续写",
      instruction: "从笔记结束处自然续写。只返回新增续写内容，不要重复原文。保持原语言与 Markdown 风格。",
    },
    {
      name: "Continue writing",
      description: "Continue naturally from the end of the note",
      instruction: "Continue writing naturally from where the note ends. Return only the new continuation, not the original content. Preserve its language and Markdown style.",
    },
    {
      name: "続きを書く",
      description: "ノートの末尾から自然に書き継ぐ",
      instruction: "ノートの終わりから自然に書き継いでください。原文は繰り返さず、新しい続きだけを返してください。元の言語と Markdown の調子を保ってください。",
    },
    {
      name: "Pisz dalej",
      description: "Kontynuuj naturalnie od końca notatki",
      instruction: "Kontynuuj pisanie naturalnie od miejsca, w którym kończy się notatka. Zwróć wyłącznie nową kontynuację, bez oryginalnej treści. Zachowaj jej język i styl Markdown.",
    },
    {
      name: "Продолжить текст",
      description: "Продолжить естественно с конца заметки",
      instruction: "Продолжите текст естественно с того места, где заметка заканчивается. Верните только продолжение, без исходного текста. Сохраните язык и стиль Markdown.",
    },
  ),
];

export const getDefaultAiPromptSeed = (key: string) =>
  DEFAULT_AI_PROMPT_SEEDS.find((item) => item.key === key) ?? null;
