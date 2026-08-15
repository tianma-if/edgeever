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

export const AI_PROMPT_PARAMETER_KINDS = ["none", "target-language", "tone"] as const;
export type AiPromptParameterKind = (typeof AI_PROMPT_PARAMETER_KINDS)[number];

export const AI_PROMPT_RESULT_MODES = ["append", "replace", "both"] as const;
export type AiPromptResultMode = (typeof AI_PROMPT_RESULT_MODES)[number];

export const AI_SELECTED_TEXT_ACTIONS: readonly AiAction[] = [
  "summarize",
  "translate",
  "improve-writing",
  "make-shorter",
  "rewrite-proofread",
  "simplify-language",
  "custom",
];

export const AI_WHOLE_NOTE_ACTIONS: readonly AiAction[] = [
  "summarize",
  "translate",
  "improve-writing",
  "make-shorter",
  "rewrite-proofread",
  "simplify-language",
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

/** Actions that need an extra picker (language / tone) in the assistant UI. */
export const AI_ACTIONS_WITH_EXTRA_PARAMS: readonly AiAction[] = ["translate", "change-tone"];

export const actionNeedsTargetLanguage = (action: AiAction | string | null | undefined) =>
  action === "translate";

export const actionNeedsTone = (action: AiAction | string | null | undefined) =>
  action === "change-tone";

export const promptNeedsTargetLanguage = (parameterKind: AiPromptParameterKind) =>
  parameterKind === "target-language";

export const promptNeedsTone = (parameterKind: AiPromptParameterKind) =>
  parameterKind === "tone";

export const promptAllowsAppend = (resultMode: AiPromptResultMode) =>
  resultMode === "append" || resultMode === "both";

export const promptAllowsReplace = (resultMode: AiPromptResultMode) =>
  resultMode === "replace" || resultMode === "both";
