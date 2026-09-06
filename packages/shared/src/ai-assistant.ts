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

export const AI_ATTACHMENT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/json",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;
export type AiAttachmentMediaType = (typeof AI_ATTACHMENT_MEDIA_TYPES)[number];
export const MAX_AI_ATTACHMENTS = 4;
export const MAX_AI_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_AI_TEXT_ATTACHMENT_BYTES = 256 * 1024;
export const MAX_AI_ATTACHMENTS_TOTAL_BYTES = 8 * 1024 * 1024;

export const getBase64DecodedByteLength = (data: string) => {
  if (!data || data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    return null;
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
};

export const isAiTextAttachment = (mediaType: AiAttachmentMediaType) =>
  mediaType.startsWith("text/") || mediaType === "application/json";

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
