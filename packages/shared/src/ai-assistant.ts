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

export const AI_TARGET_LANGUAGES = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru"] as const;
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

export const getDefaultAiTargetLanguage = (locale: string | undefined): AiTargetLanguage => {
  const normalized = locale?.toLowerCase() ?? "";

  if (normalized.startsWith("zh")) {
    return "en";
  }

  if (normalized.startsWith("ru")) {
    return "en";
  }

  return "zh-CN";
};

export const AI_ASSISTANT_LAST_ACTION_STORAGE_KEY = "edgeever.aiAssistant.lastAction";

export type AiPromptSeedAction = Exclude<AiAction, "custom">;

export type AiAssistantLastActionPreference = {
  action: AiAction;
  promptId: string | null;
  seedKey: AiPromptSeedAction | null;
  targetLanguage?: AiTargetLanguage;
  tone?: AiTone;
};

export type AiAssistantPromptOption = {
  id: string;
  action: AiAction;
  seedKey?: AiPromptSeedAction | null;
};

const isAiAction = (value: unknown): value is AiAction =>
  typeof value === "string" && (AI_ACTIONS as readonly string[]).includes(value);

const isAiPromptSeedAction = (value: unknown): value is AiPromptSeedAction =>
  isAiAction(value) && value !== "custom";

const isAiTargetLanguage = (value: unknown): value is AiTargetLanguage =>
  typeof value === "string" && (AI_TARGET_LANGUAGES as readonly string[]).includes(value);

const isAiTone = (value: unknown): value is AiTone =>
  typeof value === "string" && (AI_TONES as readonly string[]).includes(value);

const getLocalStorage = (): Storage | null => {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
};

export const parseAiAssistantLastActionPreference = (
  raw: string | null | undefined,
): AiAssistantLastActionPreference | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!isAiAction(parsed.action)) return null;
    return {
      action: parsed.action,
      promptId: typeof parsed.promptId === "string" ? parsed.promptId : null,
      seedKey: isAiPromptSeedAction(parsed.seedKey) ? parsed.seedKey : null,
      ...(isAiTargetLanguage(parsed.targetLanguage) ? { targetLanguage: parsed.targetLanguage } : {}),
      ...(isAiTone(parsed.tone) ? { tone: parsed.tone } : {}),
    };
  } catch {
    return null;
  }
};

export const serializeAiAssistantLastActionPreference = (
  preference: AiAssistantLastActionPreference,
) => JSON.stringify({
  action: preference.action,
  promptId: preference.promptId,
  seedKey: preference.seedKey,
  ...(preference.targetLanguage ? { targetLanguage: preference.targetLanguage } : {}),
  ...(preference.tone ? { tone: preference.tone } : {}),
});

export const buildAiAssistantLastActionPreference = ({
  action,
  promptId,
  seedKey,
  targetLanguage,
  tone,
}: {
  action: AiAction;
  promptId?: string | null;
  seedKey?: AiPromptSeedAction | null;
  targetLanguage?: AiTargetLanguage;
  tone?: AiTone;
}): AiAssistantLastActionPreference => ({
  action,
  promptId: promptId ?? null,
  seedKey: seedKey ?? null,
  ...(targetLanguage ? { targetLanguage } : {}),
  ...(tone ? { tone } : {}),
});

export const resolveAiAssistantLastAction = ({
  fallbackAction,
  preference,
  prompts,
}: {
  fallbackAction: AiAction;
  preference: AiAssistantLastActionPreference | null;
  prompts: readonly AiAssistantPromptOption[];
}): {
  action: AiAction;
  selectedPromptId: string | null;
  targetLanguage?: AiTargetLanguage;
  tone?: AiTone;
} => {
  const extras = {
    ...(preference?.targetLanguage ? { targetLanguage: preference.targetLanguage } : {}),
    ...(preference?.tone ? { tone: preference.tone } : {}),
  };

  if (preference) {
    if (preference.promptId) {
      const byId = prompts.find((prompt) => prompt.id === preference.promptId);
      if (byId) return { action: byId.action, selectedPromptId: byId.id, ...extras };
    }
    if (preference.seedKey) {
      const bySeed = prompts.find((prompt) => prompt.seedKey === preference.seedKey);
      if (bySeed) return { action: bySeed.action, selectedPromptId: bySeed.id, ...extras };
    }
    if (preference.action === "custom" || prompts.length === 0) {
      return { action: preference.action, selectedPromptId: null, ...extras };
    }
  }

  const fallbackPrompt = prompts.find((prompt) => prompt.seedKey === fallbackAction) ?? prompts[0] ?? null;
  if (fallbackPrompt) {
    return { action: fallbackPrompt.action, selectedPromptId: fallbackPrompt.id };
  }
  return { action: fallbackAction, selectedPromptId: null };
};

export const readStoredAiAssistantLastActionPreference = (): AiAssistantLastActionPreference | null =>
  parseAiAssistantLastActionPreference(getLocalStorage()?.getItem(AI_ASSISTANT_LAST_ACTION_STORAGE_KEY));

export const writeStoredAiAssistantLastActionPreference = (
  preference: AiAssistantLastActionPreference,
) => {
  try {
    getLocalStorage()?.setItem(
      AI_ASSISTANT_LAST_ACTION_STORAGE_KEY,
      serializeAiAssistantLastActionPreference(preference),
    );
  } catch {
    // Private mode / blocked storage — keep the in-session selection only.
  }
};

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
