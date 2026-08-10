export const AI_ACTIONS = [
  "summarize",
  "extract-key-points",
  "extract-todos",
  "rewrite-proofread",
  "translate",
  "improve-writing",
  "fix-spelling-grammar",
  "make-shorter",
  "make-longer",
  "simplify-language",
  "change-tone",
  "continue-writing",
  "custom",
] as const;

export type AiAction = (typeof AI_ACTIONS)[number];

export const AI_TONES = ["professional", "friendly", "casual", "direct"] as const;
export type AiTone = (typeof AI_TONES)[number];

export const AI_TARGET_LANGUAGES = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt"] as const;
export type AiTargetLanguage = (typeof AI_TARGET_LANGUAGES)[number];

export const AI_SELECTED_TEXT_ACTIONS: readonly AiAction[] = [
  "improve-writing",
  "fix-spelling-grammar",
  "make-shorter",
  "make-longer",
  "simplify-language",
  "change-tone",
  "translate",
  "summarize",
  "extract-key-points",
  "extract-todos",
  "custom",
];

export const AI_WHOLE_NOTE_ACTIONS: readonly AiAction[] = [
  "summarize",
  "extract-key-points",
  "extract-todos",
  "rewrite-proofread",
  "translate",
  "continue-writing",
  "make-shorter",
  "make-longer",
  "simplify-language",
  "change-tone",
  "custom",
];

const NON_REPLACEABLE_AI_ACTIONS: readonly AiAction[] = [
  "summarize",
  "extract-key-points",
  "extract-todos",
  "continue-writing",
];

export const getDefaultAiAction = (hasSelection: boolean): AiAction =>
  hasSelection ? "improve-writing" : "summarize";

export const getDefaultAiTargetLanguage = (locale: string | undefined): AiTargetLanguage =>
  locale?.toLowerCase().startsWith("zh") ? "en" : "zh-CN";

export const canReplaceAiSource = (action: AiAction) => !NON_REPLACEABLE_AI_ACTIONS.includes(action);
