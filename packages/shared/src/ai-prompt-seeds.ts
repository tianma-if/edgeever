import type {
  AiAction,
  AiPromptParameterKind,
  AiPromptResultMode,
} from "./ai-assistant";
import { resolveSupportedLocale } from "./i18n/locales";

export type AiPromptSeedKey = Exclude<AiAction, "custom">;
export type AiPromptSeedLocale = "zh-CN" | "zh-TW" | "en-US" | "ja" | "pl" | "ru" | "es" | "de" | "fr";

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
  zhTW: AiPromptSeedTranslation,
  enUS: AiPromptSeedTranslation,
  ja: AiPromptSeedTranslation,
  pl: AiPromptSeedTranslation,
  ru: AiPromptSeedTranslation,
  es: AiPromptSeedTranslation,
  de: AiPromptSeedTranslation,
  fr: AiPromptSeedTranslation,
): AiPromptSeed => ({
  ...metadata,
  ...zhCN,
  translations: { "zh-CN": zhCN, "zh-TW": zhTW, "en-US": enUS, ja, pl, ru, es, de, fr },
});

export const normalizeAiPromptSeedLocale = (locale: string | null | undefined): AiPromptSeedLocale =>
  resolveSupportedLocale(locale);

export const localizeAiPromptSeed = (
  promptSeed: AiPromptSeed,
  locale: string | null | undefined,
): AiPromptSeedTranslation => promptSeed.translations[normalizeAiPromptSeedLocale(locale)];

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
      name: "精簡總結",
      description: "壓縮全文，提煉主題、結論與可執行結果",
      instruction: [
        "對筆記做真正的精簡總結，不要逐句改寫、同義複述或回聲式重寫。",
        "識別中心主題、主要主張、關鍵結論與可執行結果。",
        "省略重複、修辭、舉例、引語和次要細節，除非它們對理解關鍵結論必不可少。",
        "較長筆記目標約為原文 20–30% 篇幅，用 3–7 條簡潔 Markdown 要點；短筆記用 1–3 句即可。",
        "不要大段照搬原文，也不要新增原文沒有的資訊。",
        "保持筆記原語言，只返回 Markdown 總結。",
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
      description: "Streść notatkę do jej tematu, wniosków i konkretnych rezultatów",
      instruction: [
        "Stwórz autentycznie skondensowane podsumowanie notatki zamiast jej przepisywania, parafrazowania linijka po linijce czy powtarzania jak echo. ",
        "Zidentyfikuj główny temat, najważniejsze tezy, istotne wnioski i rezultaty wymagające działania. ",
        "Pomiń powtórzenia, figury retoryczne, przykłady, cytaty i drugorzędne szczegóły, chyba że są niezbędne do zrozumienia kluczowego wniosku. ",
        "W przypadku obszernej notatki dąż do objętości rzędu 20–30% tekstu źródłowego i użyj 3–7 zwięzłych punktów Markdown; w przypadku krótkiej notatki wystarczą 1–3 zwięzłe zdania. ",
        "Nie przepisuj długich fragmentów dosłownie ani nie dodawaj faktów, których nie ma w tekście źródłowym. ",
        "Zachowaj język notatki i zwróć wyłącznie podsumowanie w formacie Markdown.",
      ].join(""),
    },
    {
      name: "Краткий пересказ",
      description: "Сжать текст до темы, выводов и действий",
      instruction: [
        "Сделайте действительно сжатый пересказ заметки, а не построчный пересказ, парафраз или эхо. ",
        "Выделите главную тему, ключевые утверждения, важные выводы и практические шаги. ",
        "Опустите повторы, риторику, примеры, цитаты и мелкие детали, кроме тех, без которых вывод непонятен. ",
        "Для большой заметки ориентируйтесь на 20–30% исходного объёма и 3–7 коротких пунктов Markdown; для короткой заметки хватит 1–3 предложений. ",
        "Не переписывайте длинные куски слово в слово и не добавляйте фактов, которых нет в источнике. ",
        "Сохраните язык заметки и верните только пересказ в Markdown.",
      ].join(""),
    },
    {
      name: "Resumir",
      description: "Condensar la nota en su tema, conclusiones y resultados accionables",
      instruction: [
        "Cree un resumen verdaderamente condensado de la nota en lugar de reescribirla o parafrasearla línea por línea. ",
        "Identifique el tema central, afirmaciones principales, conclusiones esenciales y resultados accionables. ",
        "Omita repeticiones, recursos retóricos, ejemplos, citas y detalles menores a menos que sean imprescindibles para entender una conclusión clave. ",
        "Para una nota extensa, procure un 20–30% de la longitud original con 3–7 viñetas Markdown concisas; para una nota breve, bastan 1–3 frases. ",
        "No reproduzca pasajes largos textualmente ni agregue hechos inexistentes en la fuente. ",
        "Conserve el idioma de la nota y devuelva únicamente el resumen en Markdown.",
      ].join(""),
    },
    {
      name: "Zusammenfassen",
      description: "Komprimieren Sie die Notiz auf Thema, Kernaussagen und konkrete Ergebnisse",
      instruction: [
        "Erstellen Sie eine prägnante Zusammenfassung der Notiz, anstatt sie zeilenweise umzuschreiben oder zu wiederholen. ",
        "Identifizieren Sie das Hauptthema, wesentliche Thesen, wichtige Schlussfolgerungen und Handlungsergebnisse. ",
        "Lassen Sie Wiederholungen, rhetorische Wendungen, Beispiele, Zitate und Nebensächlichkeiten weg, sofern sie nicht zwingend für das Verständnis erforderlich sind. ",
        "Zielen Sie bei längeren Notizen auf etwa 20–30 % der Originallänge und 3–7 prägnante Markdown-Aufzählungspunkte ab; bei kurzen Notizen reichen 1–3 Sätze. ",
        "Übernehmen Sie keine langen Passagen wortwörtlich und erfinden Sie keine Fakten hinzu. ",
        "Behalten Sie die Sprache der Notiz bei und geben Sie nur die Zusammenfassung in Markdown zurück.",
      ].join(""),
    },
    {
      name: "Résumer",
      description: "Condenser la note en dégageant son thème, ses conclusions et ses résultats concrets",
      instruction: [
        "Rédigez un résumé véritablement condensé de la note plutôt que de la réécrire ou de la paraphraser ligne par ligne. ",
        "Identifiez le thème central, les affirmations clés, les conclusions essentielles et les actions concrètes. ",
        "Omettez les répétitions, les effets rhétoriques, les exemples, les citations et les détails secondaires, sauf s'ils sont indispensables à la compréhension d'une conclusion clé. ",
        "Pour une note volumineuse, visez environ 20 à 30 % de la longueur d'origine avec 3 à 7 puces Markdown concises ; pour une note courte, 1 à 3 phrases suffisent. ",
        "Ne reproduisez pas de longs passages mot à mot et n'ajoutez aucun fait absent de la source. ",
        "Conservez la langue de la note et renvoyez uniquement le résumé au format Markdown.",
      ].join(""),
    },
  ),
  seed(
    { key: "translate", action: "translate", parameterKind: "target-language", resultMode: "both" },
    {
      name: "翻译",
      description: "翻译为目标语言，保留结构与格式",
      instruction: "将完整笔记翻译成用户指定的目标语言。保留原意、Markdown 结构、链接与代码块。只返回译文，不要评论。",
    },
    {
      name: "翻譯",
      description: "翻譯為目標語言，保留結構與格式",
      instruction: "將完整筆記翻譯成使用者指定的目標語言。保留原意、Markdown 結構、連結與程式碼區塊。只返回譯文，不要評論。",
    },
    {
      name: "Translate",
      description: "Translate into target language while preserving structure and formatting",
      instruction: "Translate the complete note into the target language specified by the user. Preserve its meaning, Markdown structure, links, and code blocks. Return only the translated note without commentary.",
    },
    {
      name: "翻訳する",
      description: "構成と書式を保ち、指定の言語へ翻訳する",
      instruction: "ノート全体を、ユーザーが指定した目標言語へ翻訳してください。意味、Markdown の構造、リンク、コードブロックは残してください。解説は付けず、訳文だけを返してください。",
    },
    {
      name: "Przetłumacz",
      description: "Przetłumacz na język docelowy z zachowaniem struktury i formatowania",
      instruction: "Przetłumacz całą notatkę na język docelowy wskazany przez użytkownika. Zachowaj jej znaczenie, strukturę Markdown, linki i bloki kodu. Zwróć wyłącznie przetłumaczoną notatkę, bez komentarzy.",
    },
    {
      name: "Перевести",
      description: "Перевести на выбранный язык с сохранением структуры и разметки",
      instruction: "Переведите заметку целиком на язык, который указал пользователь. Сохраните смысл, структуру Markdown, ссылки и блоки кода. Верните только перевод, без комментариев.",
    },
    {
      name: "Traducir",
      description: "Traducir al idioma de destino conservando estructura y formato",
      instruction: "Traduzca la nota completa al idioma de destino especificado por el usuario. Conserve su significado, estructura de Markdown, enlaces y bloques de código. Devuelva solo la nota traducida sin comentarios.",
    },
    {
      name: "Übersetzen",
      description: "In die Zielsprache übersetzen unter Beibehaltung von Struktur und Formatierung",
      instruction: "Übersetzen Sie die gesamte Notiz in die vom Benutzer angegebene Zielsprache. Behalten Sie Bedeutung, Markdown-Struktur, Links und Codeblöcke bei. Geben Sie nur die übersetzte Notiz ohne Kommentare zurück.",
    },
    {
      name: "Traduire",
      description: "Traduire dans la langue cible tout en préservant la structure et la mise en forme",
      instruction: "Traduisez l'intégralité de la note dans la langue cible spécifiée par l'utilisateur. Conservez son sens, sa structure Markdown, ses liens et ses blocs de code. Renvoyez uniquement la note traduite sans commentaires.",
    },
  ),
  seed(
    { key: "improve-writing", action: "improve-writing", parameterKind: "none", resultMode: "both" },
    {
      name: "润色改写",
      description: "修正错别字、语法，改善用词、语句流畅度与表达",
      instruction: "润色内容，修正错别字、语法与标点，改善用词、句式、清晰度和流畅度，但不要改变原意或刻意缩短内容。保持原语言与有用的 Markdown 格式。只返回润色后的内容。",
    },
    {
      name: "潤色改寫",
      description: "修正錯別字、語法，改善用詞、語句流暢度與表達",
      instruction: "潤色內容，修正錯別字、語法與標點，改善用詞、句式、清晰度和流暢度，但不要改變原意或刻意縮短內容。保持原語言與有用的 Markdown 格式。只返回潤色後的內容。",
    },
    {
      name: "Improve Writing",
      description: "Fix spelling, grammar, flow, and vocabulary",
      instruction: "Polish the content by correcting spelling, grammar, and punctuation and improving word choice, sentence structure, clarity, and flow. Do not change its meaning or deliberately shorten it. Preserve its language and useful Markdown formatting. Return only the polished content.",
    },
    {
      name: "文章を整える",
      description: "誤字、文法、語彙、読みやすさを改善する",
      instruction: "内容を整えてください。誤字、文法、句読点を直し、語彙、文の形、明瞭さ、流れを改善します。意味を変えたり、意図的に短くしたりしないでください。元の言語と有用な Markdown 書式は残してください。整えた本文だけを返してください。",
    },
    {
      name: "Dopracuj tekst",
      description: "Popraw pisownię, gramatykę, płynność i dobór słów",
      instruction: "Dopracuj treść: popraw pisownię, gramatykę i interpunkcję oraz ulepsz dobór słów, budowę zdań, przejrzystość i płynność. Nie zmieniaj jej znaczenia ani celowo jej nie skracaj. Zachowaj jej język i przydatne formatowanie Markdown. Zwróć wyłącznie dopracowaną treść.",
    },
    {
      name: "Улучшить текст",
      description: "Исправить орфографию и грамматику, подобрать слова и улучшить связность",
      instruction: "Улучшите текст: исправьте орфографию, грамматику и пунктуацию, подберите слова, структуру фраз, ясность и плавность. Не меняйте смысл и не сокращайте текст нарочно. Сохраните язык и полезное оформление Markdown. Верните только улучшенный текст.",
    },
    {
      name: "Mejorar redacción",
      description: "Corregir ortografía y gramática, y mejorar fluidez y vocabulario",
      instruction: "Mejore el contenido corrigiendo ortografía, gramática y puntuación, optimizando el vocabulario, la estructura de las frases, la claridad y la fluidez. No altere el significado original ni lo acorte deliberadamente. Conserve el idioma y el formato Markdown útil. Devuelva únicamente el contenido mejorado.",
    },
    {
      name: "Ausdruck verbessern",
      description: "Rechtschreibung und Grammatik korrigieren, Wortwahl und Fluss verfeinern",
      instruction: "Überarbeiten Sie den Inhalt, indem Sie Rechtschreibung, Grammatik und Zeichensetzung korrigieren und Wortwahl, Satzstruktur, Klarheit sowie Lesefluss verbessern. Ändern Sie weder den Sinn noch kürzen Sie den Text absichtlich. Behalten Sie die Sprache und nützliche Markdown-Formatierungen bei. Geben Sie nur den verbesserten Inhalt zurück.",
    },
    {
      name: "Améliorer le style",
      description: "Corriger l'orthographe, la grammaire, la fluidité et le vocabulaire",
      instruction: "Peaufinez le contenu en corrigeant l'orthographe, la grammaire et la ponctuation, et en améliorant le choix des mots, la syntaxe, la clarté et la fluidité. Ne modifiez pas le sens et ne cherchez pas à raccourcir le texte délibérément. Conservez sa langue et le formatage Markdown utile. Renvoyez uniquement le texte amélioré.",
    },
  ),
  seed(
    { key: "make-shorter", action: "make-shorter", parameterKind: "none", resultMode: "both" },
    {
      name: "精炼缩短",
      description: "删除冗余空话，使表达简洁、清晰、有力",
      instruction: "精炼内容，删除重复、空话和不必要的修饰，合并可以合并的句子，使表达简洁、清晰、有力。保留所有关键事实、观点与原意，不要添加新信息。保持原语言与有用的 Markdown 格式。只返回精炼后的内容。",
    },
    {
      name: "精煉縮短",
      description: "刪除冗餘空話，使表達簡潔、清晰、有力",
      instruction: "精煉內容，刪除重複、空話和不必要的修飾，合併可以合併的句子，使表達簡潔、清晰、有力。保留所有關鍵事實、觀點與原意，不要新增新資訊。保持原語言與有用的 Markdown 格式。只返回精煉後的內容。",
    },
    {
      name: "Make Shorter",
      description: "Trim filler and make the text concise, clear, and direct",
      instruction: "Refine the content by removing repetition, filler, and unnecessary modifiers and by combining sentences where useful. Make it concise, clear, and direct while preserving every key fact, claim, and the original meaning. Do not add new information. Preserve its language and useful Markdown formatting. Return only the refined content.",
    },
    {
      name: "短くする",
      description: "冗長さを省き、簡潔で力強い表現にする",
      instruction: "内容を簡潔にしてください。繰り返し、空疎な言い回し、不要な修飾を削り、まとめられる文はまとめて、短く、はっきり、力強くしてください。重要な事実、主張、元の意味はすべて残し、新しい情報は足さないでください。元の言語と有用な Markdown 書式は残してください。簡潔にした本文だけを返してください。",
    },
    {
      name: "Skróć",
      description: "Usuń zbędne słowa i spraw, by tekst był zwięzły, jasny i konkretny",
      instruction: "Dopracuj treść, usuwając powtórzenia, puste frazy i zbędne określenia oraz łącząc zdania tam, gdzie to pomaga. Spraw, by tekst był zwięzły, jasny i konkretny, zachowując każdy kluczowy fakt, tezę i pierwotne znaczenie. Nie dodawaj nowych informacji. Zachowaj jej język i przydatne formatowanie Markdown. Zwróć wyłącznie dopracowaną treść.",
    },
    {
      name: "Сделать короче",
      description: "Убрать воду и сделать текст ёмким, ясным и прямым",
      instruction: "Сократите текст: уберите повторы, пустые фразы и лишние определения, объедините предложения, где это уместно. Сделайте его коротким, ясным и прямым, сохранив каждый важный факт, мысль и исходный смысл. Не добавляйте новой информации. Сохраните язык и полезное оформление Markdown. Верните только сокращённый текст.",
    },
    {
      name: "Acortar",
      description: "Eliminar redundancias y hacer el texto conciso, claro y directo",
      instruction: "Depure el contenido eliminando repeticiones, frases vacías y modificadores innecesarios, combinando oraciones cuando sea útil. Hágalo conciso, claro y directo, preservando todos los hechos clave y el sentido original. No agregue información nueva. Conserve el idioma y el formato Markdown útil. Devuelva solo el contenido sintetizado.",
    },
    {
      name: "Kürzen",
      description: "Überflüssiges streichen und den Text prägnant, klar und direkt gestalten",
      instruction: "Straffen Sie den Text, indem Sie Wiederholungen, Füllwörter und unnötige Zusätze entfernen und Sätze sinnvoll zusammenfassen. Formulieren Sie prägnant, klar und direkt, während alle wesentlichen Fakten und die ursprüngliche Bedeutung erhalten bleiben. Fügen Sie keine neuen Informationen hinzu. Behalten Sie die Sprache und das Markdown bei. Geben Sie nur den gekürzten Text zurück.",
    },
    {
      name: "Raccourcir",
      description: "Supprimer le superflu pour un texte concis, clair et direct",
      instruction: "Allégez le texte en supprimant les répétitions, le remplissage et les modificateurs inutiles, et en combinant les phrases lorsque cela est judicieux. Rendez-le concis, clair et direct tout en préservant chaque fait clé, affirmation et sens d'origine. N'ajoutez aucune nouvelle information. Conservez sa langue et le formatage Markdown. Renvoyez uniquement le contenu épuré.",
    },
  ),
  seed(
    { key: "extract-todos", action: "extract-todos", parameterKind: "none", resultMode: "append" },
    {
      name: "提取待办事项",
      description: "梳理笔记中的任务、行动项与责任清单",
      instruction: "从笔记中提取明确或隐含的可执行任务，用 Markdown 任务列表（- [ ]）输出。保持原语言，不要编造任务。若没有可执行事项，用原文语言简短说明。",
    },
    {
      name: "提取待辦事項",
      description: "梳理筆記中的任務、行動項與責任清單",
      instruction: "從筆記中提取明確或隱含的可執行任務，用 Markdown 任務清單（- [ ]）輸出。保持原語言，不要編造任務。若沒有可執行事項，用原文語言簡短說明。",
    },
    {
      name: "Extract Action Items",
      description: "Identify todos, next steps, and checklist items",
      instruction: "Extract explicit or implied actionable tasks from the note as a Markdown task list using '- [ ]'. Preserve its language and do not invent tasks. If there are no actionable tasks, say so briefly in the note's language.",
    },
    {
      name: "ToDo を抽出する",
      description: "タスク、次のアクション、チェックリストを整理する",
      instruction: "ノートから明示または含意された実行可能なタスクを抜き出し、Markdown のタスクリスト（- [ ]）で出力してください。ノートの言語を保ち、タスクを捏造しないでください。実行できることがなければ、ノートの言語で短くそう書いてください。",
    },
    {
      name: "Wyodrębnij zadania",
      description: "Zidentyfikuj zadania do wykonania, kolejne kroki i elementy listy kontrolnej",
      instruction: "Wyodrębnij z notatki jawne lub domniemane zadania do wykonania jako listę zadań Markdown z użyciem '- [ ]'. Zachowaj jej język i nie wymyślaj zadań. Jeśli nie ma zadań do wykonania, napisz to krótko w języku notatki.",
    },
    {
      name: "Найти задачи",
      description: "Собрать дела, шаги и чек-лист из текста",
      instruction: "Выделите из заметки явные и подразумеваемые дела и оформите их списком задач Markdown через '- [ ]'. Сохраните язык заметки и не придумывайте задачи. Если дел нет, коротко напишите об этом на языке заметки.",
    },
    {
      name: "Extraer tareas",
      description: "Organizar tareas pendientes, acciones y listas de verificación",
      instruction: "Extraiga las tareas pendientes explícitas o implícitas de la nota como una lista de tareas de Markdown con '- [ ]'. Conserve su idioma y no invente tareas. Si no hay elementos accionables, indíquelo brevemente en el idioma de la nota.",
    },
    {
      name: "Aufgaben extrahieren",
      description: "Aufgaben, Handlungsschritte und To-do-Listen aus der Notiz erfassen",
      instruction: "Extrahieren Sie explizite oder implizite Aufgaben aus der Notiz als Markdown-Aufgabenliste mit '- [ ]'. Behalten Sie die Sprache bei und erfinden Sie keine Aufgaben hinzu. Gibt es keine Aufgaben, teilen Sie dies kurz in der Sprache der Notiz mit.",
    },
    {
      name: "Extraire les tâches",
      description: "Identifier les tâches, prochaines étapes et éléments de liste de contrôle",
      instruction: "Extrayez les tâches concrètes, explicites ou implicites, sous forme de liste de tâches Markdown avec '- [ ]'. Conservez la langue de la note et n'inventez pas de tâches. S'il n'y a aucune tâche exploitable, indiquez-le brièvement dans la langue de la note.",
    },
  ),
  seed(
    { key: "continue-writing", action: "continue-writing", parameterKind: "none", resultMode: "append" },
    {
      name: "接续撰写",
      description: "沿着现有脉络自然续写后续内容",
      instruction: "从笔记结束处自然续写。只返回新增续写内容，不要重复原文。保持原语言与 Markdown 风格。",
    },
    {
      name: "接續撰寫",
      description: "沿著現有脈絡自然續寫後續內容",
      instruction: "從筆記結束處自然續寫。只返回新增續寫內容，不要重複原文。保持原語言與 Markdown 風格。",
    },
    {
      name: "Continue Writing",
      description: "Pick up naturally from where the note leaves off",
      instruction: "Continue writing naturally from where the note ends. Return only the new continuation, not the original content. Preserve its language and Markdown style.",
    },
    {
      name: "続きを書く",
      description: "ノートの文脈を引き継いで自然に書き継ぐ",
      instruction: "ノートの終わりから自然に書き継いでください。原文は繰り返さず、新しい続きだけを返してください。元の言語と Markdown の調子を保ってください。",
    },
    {
      name: "Kontynuuj pisanie",
      description: "Podejmij wątek naturalnie w miejscu, w którym kończy się notatka",
      instruction: "Kontynuuj pisanie naturalnie od miejsca, w którym kończy się notatka. Zwróć wyłącznie nową kontynuację, bez oryginalnej treści. Zachowaj jej język i styl Markdown.",
    },
    {
      name: "Продолжить текст",
      description: "Естественно продолжить мысль с места, где заметка обрывается",
      instruction: "Продолжите текст естественно с того места, где заметка заканчивается. Верните только продолжение, без исходного текста. Сохраните язык и стиль Markdown.",
    },
    {
      name: "Continuar escribiendo",
      description: "Continuar de forma natural siguiendo el hilo existente",
      instruction: "Continúe escribiendo de forma natural desde donde termina la nota. Devuelva únicamente la continuación, sin repetir el texto original. Conserve su idioma y estilo Markdown.",
    },
    {
      name: "Weiterschreiben",
      description: "Den Text nahtlos im gleichen Stil fortsetzen",
      instruction: "Setzen Sie den Text nahtlos an der Stelle fort, an der die Notiz endet. Geben Sie nur die neue Fortsetzung zurück, nicht den Ausgangstext. Behalten Sie Sprache und Markdown-Stil bei.",
    },
    {
      name: "Poursuivre la rédaction",
      description: "Continuer naturellement dans la lignée du contenu existant",
      instruction: "Poursuivez la rédaction naturellement à partir de la fin de la note. Renvoyez uniquement la nouvelle suite, sans répéter le contenu original. Conservez sa langue et son style Markdown.",
    },
  ),
];

export const getDefaultAiPromptSeed = (key: string) =>
  DEFAULT_AI_PROMPT_SEEDS.find((item) => item.key === key);
