import { z } from "zod";
import { isAiTextAttachment, type AiAttachmentMediaType } from "./ai-assistant";
import { localeEnglishNames, matchSupportedLocale } from "./i18n/locales";

export const COMPANION_MATH_FORMAT_INSTRUCTION = String.raw`In user-facing replies, write inline LaTeX as \(...\) and display LaTeX as $$...$$ on separate lines. Write monetary amounts with ordinary dollar signs, such as $5 and $10. Do not use $...$ for inline math. Preserve quoted source text and note content exactly when the task requires it.`;

export const CompanionIdSchema = z.string().uuid();
export const CompanionMemoryInputSchema = z.object({
  content: z.string().trim().min(1).max(500),
  sourceTurnId: CompanionIdSchema.optional(),
}).strict();
export const CompanionMemoryUpdateSchema = z.object({
  content: z.string().trim().min(1).max(500),
  version: z.number().int().positive(),
}).strict();
export const CompanionTurnFocusSchema = z.object({
  memoId: z.string().trim().min(1).max(100).optional(),
  notebookId: z.string().trim().min(1).max(100).optional(),
  notebookTitle: z.string().trim().max(160).optional(),
  title: z.string().trim().max(160).optional(),
  selectionMarkdown: z.string().max(2000).optional(),
  contentMarkdown: z.string().max(4000).optional(),
  contentTruncated: z.boolean().optional(),
  diagramKind: z.enum(["mind-map", "flowchart", "architecture"]).optional(),
}).strict();
export const CompanionMentionSchema = z.object({
  type: z.enum(["memo", "notebook", "tag"]),
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().max(160).optional(),
}).strict();
export type CompanionMention = z.infer<typeof CompanionMentionSchema>;

export const CompanionTurnInputSchema = z.object({
  id: CompanionIdSchema,
  threadId: CompanionIdSchema,
  message: z.string().trim().min(1).max(4000),
  useMemory: z.boolean().default(true),
  allowNotes: z.boolean().default(false),
  allowWrites: z.boolean().optional(),
  locale: z.enum(["zh-CN", "zh-TW", "en-US", "ja", "pl", "ru", "es", "de", "fr"]).default("en-US"),
  focus: CompanionTurnFocusSchema.optional(),
  mentions: z.array(CompanionMentionSchema).max(8).optional(),
  attachmentIds: z.array(z.string().uuid()).max(4).optional(),
}).strict();
export type CompanionTurnInput = z.infer<typeof CompanionTurnInputSchema>;

type ConversationLanguage = CompanionTurnInput["locale"];

/** A UI locale as a companion turn locale; unknown values fall back to English. */
export const companionTurnLocale = (locale?: string | null): ConversationLanguage =>
  matchSupportedLocale(locale) ?? "en-US";

const requestText = (message: string) =>
  // The request normally precedes pasted or quoted source text.
  message.trim().split(/[\n:：]/, 1)[0].slice(0, 200);

const messageLanguage = (message: string): ConversationLanguage | "latin" | null => {
  const request = requestText(message);
  // Sidebar translation actions generate localized prompts. Their wording is
  // interface text, not evidence of the user's conversation language.
  if (/^(?:请翻译我正在看的内容|请翻译下面这段文字|请把下面这段翻译成|Translate what I'm looking at|Translate the passage below|今見ている内容を翻訳|下の文章を|Przetłumacz to, na co patrzę|Przetłumacz poniższy fragment|Переведи то, что я сейчас смотрю|Переведи отрывок ниже)/iu.test(request)) return null;
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(request)) return "ja";
  if (/\p{Script=Han}/u.test(request)) return "zh-CN";
  if (/\p{Script=Cyrillic}/u.test(request)) return "ru";
  if (/[ąćęłńśźżĄĆĘŁŃŚŹŻ]/u.test(request)) return "pl";
  if (/[A-Za-z]{2,}/u.test(request)) return "latin";
  return null;
};

// Common words that tell English from Polish typed without diacritics. Words
// both languages use (such as "to", "do", "on", "a", "i", "my") are left out.
const ENGLISH_WORDS = new Set([
  "the", "and", "or", "is", "are", "was", "be", "of", "for", "with", "in", "this", "that", "these",
  "what", "how", "why", "when", "please", "can", "could", "would", "you", "your", "me", "it",
  "write", "make", "give", "summarize", "translate", "explain", "about", "from", "into", "tomorrow", "today",
]);
const POLISH_WORDS = new Set([
  "w", "z", "na", "nie", "jest", "czy", "jak", "co", "sie", "mi", "mnie", "dla", "oraz", "albo", "jutro",
  "dzis", "dzisiaj", "prosze", "napisz", "zrob", "podsumuj", "przetlumacz", "wyjasnij", "moje", "moja", "moj",
  "tego", "ten", "ta", "te", "po", "od", "przez", "pomoz", "daj", "jaki", "jaka", "jakie", "dlaczego",
  "ktory", "ktora", "ktore", "notatke", "notatki",
]);

// Latin text without diacritics only proves English when the interface is
// not Polish; with a Polish interface it is resolved by its common words.
const latinLanguage = (message: string, fallbackLocale: ConversationLanguage): ConversationLanguage | null => {
  if (fallbackLocale !== "pl") return "en-US";
  let english = 0;
  let polish = 0;
  for (const word of requestText(message).toLowerCase().match(/[a-z]+/g) ?? []) {
    if (ENGLISH_WORDS.has(word)) english += 1;
    if (POLISH_WORDS.has(word)) polish += 1;
  }
  if (english > polish) return "en-US";
  if (polish > english) return "pl";
  return null;
};

export const conversationLanguage = (
  message: string, recentUserMessages: readonly string[], fallbackLocale: ConversationLanguage,
): { locale: ConversationLanguage; source: "current request" | "recent conversation" | "interface" } => {
  const candidates = [
    { text: message, source: "current request" as const },
    ...recentUserMessages.slice(0, 6).map((text) => ({ text, source: "recent conversation" as const })),
  ];
  for (const { text, source } of candidates) {
    const detected = messageLanguage(text);
    const locale = detected === "latin" ? latinLanguage(text, fallbackLocale) : detected;
    if (locale) return { locale, source };
  }
  return { locale: fallbackLocale, source: "interface" };
};

export const translationTargetInstruction = (
  language: ReturnType<typeof conversationLanguage>,
): string => {
  const name = localeEnglishNames[language.locale];
  return `For a translation request without an explicit target language, use the language of the current user request, then recent user messages, and only then the interface language. The best available signal for this turn is ${name} (${language.source}). If the source text is mainly in another language, translate into ${name} without asking. If the source is already mainly in ${name}, use an explicit target from this same translation task; otherwise ask which other language the user wants. An explicit target for this text always takes precedence; an older request about different text does not.`;
};

export type CompanionModelContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType: string }
  | { type: "file"; data: string; mediaType: string; filename?: string };

export const COMPANION_NOTE_EDIT_MAX_CHARS = 200_000;

export const companionSupportsAttachment = (
  provider: "openai-compatible" | "anthropic" | "google",
  mediaType: string,
) => {
  if (isAiTextAttachment(mediaType as AiAttachmentMediaType)) return true;
  if (mediaType === "image/jpeg" || mediaType === "image/png" || mediaType === "image/webp" || mediaType === "image/gif") return true;
  if (mediaType === "application/pdf") return provider === "anthropic" || provider === "google";
  return false;
};

export const CompanionQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(200),
  inputType: z.enum(["free_text", "single_select", "multi_select"]),
  options: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(80),
  }).strict()).min(2).max(6).optional(),
}).strict();
export type CompanionQuestion = z.infer<typeof CompanionQuestionSchema>;
export const CompanionAnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(80),
  optionIds: z.array(z.string().trim().min(1).max(80)).max(6).optional(),
  text: z.string().trim().max(400).optional(),
}).strict();
export type CompanionAnswer = z.infer<typeof CompanionAnswerSchema>;
export const CompanionTurnResumeSchema = z.object({
  answers: z.array(CompanionAnswerSchema).max(3).optional(),
}).strict();
export type CompanionTurnResume = z.infer<typeof CompanionTurnResumeSchema>;
/** Per-turn storage limits enforced by the instance; clients must clip before saving. */
export const COMPANION_RESPONSE_MAX_CHARS = 16000;
export const COMPANION_PROCESS_MAX_CHARS = 32000;
/** Request body limit of the companion JSON endpoints (UTF-8 bytes of the whole JSON). */
export const COMPANION_REQUEST_MAX_BYTES = 128 * 1024;
export const CompanionToolExecuteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  input: z.record(z.string(), z.unknown()).default({}),
  callId: z.string().trim().min(1).max(100).optional(),
  response: z.string().max(COMPANION_RESPONSE_MAX_CHARS).optional(),
  process: z.string().max(COMPANION_PROCESS_MAX_CHARS).optional(),
}).strict();
export type CompanionToolExecuteInput = z.infer<typeof CompanionToolExecuteSchema>;
export const CompanionTurnCheckpointSchema = z.object({
  response: z.string().max(COMPANION_RESPONSE_MAX_CHARS),
  process: z.string().max(COMPANION_PROCESS_MAX_CHARS).optional(),
}).strict();
export type CompanionTurnCheckpointInput = z.infer<typeof CompanionTurnCheckpointSchema>;
export const CompanionTurnCompleteSchema = z.object({
  response: z.string().max(COMPANION_RESPONSE_MAX_CHARS),
  process: z.string().max(COMPANION_PROCESS_MAX_CHARS).optional(),
  status: z.enum(["completed", "interrupted", "failed"]),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
}).strict();
export type CompanionTurnCompleteInput = z.infer<typeof CompanionTurnCompleteSchema>;
export type CompanionToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};
export type CompanionPreparedMessage = {
  role: "user" | "assistant";
  content: string | CompanionModelContentPart[];
};
export type CompanionPreparedTurn = {
  turn: CompanionTurn;
  provider: "openai-compatible" | "anthropic" | "google";
  baseUrl: string;
  apiKey: string;
  modelId: string;
  instructions: string;
  messages: CompanionPreparedMessage[];
  tools: CompanionToolDefinition[];
  maxSteps: number;
  maxOutputTokens: number;
};
export type CompanionToolExecuteResult = {
  result: unknown;
  tools: CompanionToolCall[];
  todos: CompanionTodo[];
  questions: CompanionQuestion[];
  pause: boolean;
};
export type CompanionTodoStatus = "pending" | "in_progress" | "completed";
export type CompanionTodo = { id: string; content: string; status: CompanionTodoStatus };
export type CompanionToolEffectKind =
  | "created" | "updated" | "merged" | "moved" | "trashed" | "restored" | "tagged" | "read" | "listed" | "other";
export type CompanionToolEffect = {
  kind: CompanionToolEffectKind;
  memoId?: string;
  notebookId?: string;
  title?: string;
  revision?: number;
  previousRevision?: number;
};
export type CompanionToolCall = {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  effects: CompanionToolEffect[];
  error?: string;
};
export type CompanionMemory = {
  id: string;
  content: string;
  sourceTurnId: string | null;
  kind?: "explicit" | "inferred";
  state?: "active" | "candidate" | "conflicted";
  scopeNotebookId?: string | null;
  ruleKey?: string | null;
  scopeNotebookName?: string | null;
  evidence?: { memoId: string; createdAt: string; title?: string; notebookId?: string }[];
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type CompanionSource = { id: string; title: string; revision: number; notebookId?: string };
export type CompanionTurnAttachmentMeta = {
  id: string;
  filename: string;
  mediaType: string;
  byteLength: number;
};

export const CompanionDiscoverySettingsInputSchema = z.object({
  enabled: z.boolean(),
  learningEnabled: z.boolean().optional(),
  useMemory: z.boolean().optional(),
  version: z.number().int().nonnegative(),
}).strict();
export type CompanionDiscoverySettingsInput = z.infer<typeof CompanionDiscoverySettingsInputSchema>;
export type CompanionDiscoverySettings = CompanionDiscoverySettingsInput & {
  lastCheckAt: string | null;
  lastStatus: "quiet" | "ready" | "failed" | "running";
};
const compactDiscoveryBody = z.string().trim().min(1).max(180).refine(
  value => value.split(/\r?\n/).length <= 3,
  "Discovery body must contain at most 3 lines.",
);
export const CompanionDiscoveryOutputSchema = z.object({
  suggestion: z.object({
    kind: z.enum(["insight", "merge", "append", "move", "tag"]),
    title: z.string().trim().min(1).max(60),
    body: compactDiscoveryBody,
    sourceIds: z.array(z.string().min(1).max(100)).min(1).max(5),
    memoryIds: z.array(z.string().max(100)).max(8).optional(),
    notebookId: z.string().max(100).nullable().optional(),
    tags: z.array(z.string().min(1).max(40)).max(5).optional(),
    targetId: z.string().max(100).nullable(),
  }).nullable(),
});
export type CompanionDiscoveryOutput = z.infer<typeof CompanionDiscoveryOutputSchema>;
export const CompanionDiscoveryCompleteSchema = z.object({
  turnId: CompanionIdSchema,
  output: z.unknown(),
}).strict();
export type CompanionDiscoveryCompleteInput = z.infer<typeof CompanionDiscoveryCompleteSchema>;
export type CompanionPreparedDiscovery = {
  quiet: true;
  items: CompanionDiscoveryItem[];
} | {
  quiet: false;
  turnId: string;
  provider: "openai-compatible" | "anthropic" | "google";
  baseUrl: string;
  apiKey: string;
  modelId: string;
  instructions: string;
  prompt: string;
  maxOutputTokens: number;
};
export type CompanionDiscoveryItem = {
  id: string; kind: "insight" | "merge" | "append" | "move" | "tag"; title: string; body: string;
  sources: (CompanionSource & { notebookId: string })[];
  memories?: CompanionMemory[];
  action: CompanionAction | null; seen: boolean; createdAt: string;
};

const actionReason = z.string().trim().min(1).max(400);
const noteId = z.string().trim().min(1).max(100);
export const CompanionMergePlanSchema = z.object({
  kind: z.literal("merge"),
  memoIds: z.array(noteId).min(2).max(5),
  title: z.string().trim().min(1).max(160),
  reason: actionReason,
}).strict();
export const CompanionTagPlanSchema = z.object({
  kind: z.literal("tag"),
  memoId: noteId,
  tags: z.array(z.string().trim().min(1).max(40)).min(1).max(5),
  reason: actionReason,
}).strict();
export const CompanionToolPlanSchema = z.object({
  kind: z.literal("tool"),
  toolName: z.string().min(1).max(80),
  arguments: z.record(z.string(), z.unknown()),
  reason: actionReason,
}).strict();
export const CompanionActionPlanSchema = z.discriminatedUnion("kind", [CompanionMergePlanSchema, CompanionTagPlanSchema, CompanionToolPlanSchema]);
export type CompanionActionPlan = z.infer<typeof CompanionActionPlanSchema>;
export type CompanionActionNote = CompanionSource & { notebookId: string; updatedAt: string; tags: string[]; excerpt: string };
export type CompanionAction = {
  id: string;
  turnId: string;
  plan: CompanionActionPlan;
  notes: CompanionActionNote[];
  status: "pending" | "applied" | "dismissed" | "unavailable" | "uncertain";
  resultMemoId: string | null;
  resultNotebookId?: string | null;
  result?: unknown;
  preview?: { notebooks: Array<{ id: string; name: string }>; affectedCount?: number; baseContentMarkdown?: string };
  createdAt: string;
};
export type CompanionTurn = {
  id: string;
  threadId: string;
  message: string;
  response: string;
  process: string;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  sources: CompanionSource[];
  tools: CompanionToolCall[];
  todos: CompanionTodo[];
  questions: CompanionQuestion[];
  mentions: CompanionMention[];
  attachments?: CompanionTurnAttachmentMeta[];
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
};
export type CompanionEvent =
  | { type: "start"; id: string }
  | { type: "text-delta"; text: string }
  | { type: "process"; text: string }
  | { type: "tools"; tools: CompanionToolCall[]; todos: CompanionTodo[]; questions: CompanionQuestion[] }
  | { type: "done"; turn: CompanionTurn }
  | { type: "error"; code: string; diagnostics?: CompanionFailureDiagnostics };

export const sealCompanionProcess = (process: string, response: string) => ({
  process: [process.trim(), response.trim()].filter(Boolean).join("\n\n"),
  response: "",
});

/** Keep the most recent process text within the instance limit; older steps are dropped first. */
export const clipCompanionProcess = (process: string) => {
  if (process.length <= COMPANION_PROCESS_MAX_CHARS) return process;
  const marker = "…\n\n";
  let start = process.length - (COMPANION_PROCESS_MAX_CHARS - marker.length);
  // Do not start inside a surrogate pair.
  if (/[\uDC00-\uDFFF]/.test(process[start] ?? "")) start += 1;
  return `${marker}${process.slice(start)}`;
};

const PROCESS_CLIP_MARKER = "…\n\n";
const utf8JsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** The last `count` UTF-16 units of `text`, without starting inside a surrogate pair. */
const tailOf = (text: string, count: number) => {
  if (count >= text.length) return text;
  let start = text.length - count;
  if (/[\uDC00-\uDFFF]/.test(text[start] ?? "")) start += 1;
  return text.slice(start);
};

/**
 * Make a checkpoint, completion or tool-execution body fit both the per-field character
 * limits and the instance's JSON request size (UTF-8 bytes). Older process text is dropped
 * first; the user-facing reply is only shortened if the body still does not fit.
 */
export const fitCompanionTurnBody = <T extends { response?: string; process?: string }>(
  body: T,
  maxBytes = COMPANION_REQUEST_MAX_BYTES - 1024,
): T => {
  let response = body.response === undefined ? undefined : clipToCharLimit(body.response, COMPANION_RESPONSE_MAX_CHARS);
  let process = body.process === undefined ? undefined : clipCompanionProcess(body.process);
  const build = () => ({
    ...body,
    ...(response === undefined ? {} : { response }),
    ...(process === undefined ? {} : { process }),
  });
  if (utf8JsonBytes(build()) <= maxBytes) return build();

  if (process) {
    const source = process.startsWith(PROCESS_CLIP_MARKER) ? process.slice(PROCESS_CLIP_MARKER.length) : process;
    const withTail = (count: number) => (count >= source.length && source === process ? source : `${PROCESS_CLIP_MARKER}${tailOf(source, count)}`);
    let low = 0;
    let high = source.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      process = withTail(mid);
      if (utf8JsonBytes(build()) <= maxBytes) low = mid;
      else high = mid - 1;
    }
    process = low > 0 ? withTail(low) : "";
    if (utf8JsonBytes(build()) <= maxBytes) return build();
  }

  if (response) {
    const source = response;
    let low = 0;
    let high = source.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      response = clipToCharLimit(source, mid);
      if (utf8JsonBytes(build()) <= maxBytes) low = mid;
      else high = mid - 1;
    }
    response = clipToCharLimit(source, low);
  }
  return build();
};

/** Longest prefix of `text` that fits in `limit` UTF-16 units without splitting a surrogate pair. */
export const clipToCharLimit = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  let end = limit;
  if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end -= 1;
  return text.slice(0, end);
};

export const parseCompanionMentionQuery = (text: string, cursor: number) => {
  const prefix = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  const match = prefix.match(/@([^\s@]*)$/);
  if (!match) return null;
  return { query: match[1] ?? "", start: prefix.length - match[0].length, end: cursor };
};

export const CompanionMemoryImportSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  memories: z.array(z.object({ content: z.string().trim().min(1).max(500), kind: z.enum(["explicit", "inferred"]).optional() })).max(50),
  controls: z.object({ useMemory: z.boolean(), learningEnabled: z.boolean() }).optional(),
}).strict();

/** Only fixed categories and HTTP status cross the UI boundary. Never forward SDK
 * messages, request bodies, response bodies, URLs, headers, or credentials. */
export type CompanionFailureDiagnostics = {
  reason: "http" | "timeout" | "server" | "network" | "invalidResponse" | "emptyResponse" | "responseLimit";
  status?: number;
};

export const companionFailureDiagnostics = (error: unknown, depth = 0): CompanionFailureDiagnostics | undefined => {
  if (!error || typeof error !== "object" || depth >= 3) return undefined;
  const record = error as { statusCode?: unknown; status?: unknown; name?: unknown; message?: unknown; cause?: unknown };
  const status = record.statusCode ?? record.status;
  if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
    if (status === 408 || status === 504) return { reason: "timeout", status };
    if (status >= 500) return { reason: "server", status };
    return { reason: "http", status };
  }
  if (record.name === "AI_InvalidResponseDataError" || record.name === "AI_JSONParseError"
    || record.name === "AI_TypeValidationError") return { reason: "invalidResponse" };
  if (record.name === "AI_NoOutputGeneratedError" || record.message === "No text returned.") return { reason: "emptyResponse" };
  if (record.message === "Response limit exceeded.") return { reason: "responseLimit" };
  if (typeof record.message === "string" && (
    (record.name === "TypeError" && /fetch|network|cors/i.test(record.message))
    || /^(?:fetch failed|failed to fetch|net::ERR_[A-Z_]+)(?:$|\b)/i.test(record.message)
  )) return { reason: "network" };
  return companionFailureDiagnostics(record.cause, depth + 1);
};
