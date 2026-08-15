import {
  AI_SELECTED_TEXT_ACTIONS,
  AI_TARGET_LANGUAGES,
  AI_TONES,
  AI_WHOLE_NOTE_ACTIONS,
  actionNeedsTargetLanguage,
  actionNeedsTone,
  canReplaceAiSource,
  getDefaultAiAction,
  getDefaultAiTargetLanguage,
  parseDefaultAiPromptKey,
  promptAllowsAppend,
  promptAllowsReplace,
  promptNeedsTargetLanguage,
  promptNeedsTone,
  type AiAction,
  type AiPromptParameterKind,
  type AiPromptResultMode,
  type AiTargetLanguage,
  type AiTone,
} from "@edgeever/shared";

export const targetLanguages = AI_TARGET_LANGUAGES;
export type TargetLanguage = AiTargetLanguage;

export const aiTones = AI_TONES;
export type { AiTone };

export type AiAssistantAction = AiAction;
export const selectedTextAiActions = AI_SELECTED_TEXT_ACTIONS;
export const wholeNoteAiActions = AI_WHOLE_NOTE_ACTIONS;
export const getDefaultTargetLanguage = getDefaultAiTargetLanguage;
export {
  actionNeedsTargetLanguage,
  actionNeedsTone,
  canReplaceAiSource,
  getDefaultAiAction,
  parseDefaultAiPromptKey,
  promptAllowsAppend,
  promptAllowsReplace,
  promptNeedsTargetLanguage,
  promptNeedsTone,
};

export const buildAiAssistantRequest = ({
  action,
  contentMarkdown,
  customInstruction,
  locale,
  parameterKind,
  promptId,
  targetLanguage,
  title,
  tone,
}: {
  action: AiAssistantAction;
  contentMarkdown: string;
  customInstruction: string;
  locale?: string;
  parameterKind?: AiPromptParameterKind;
  promptId?: string | null;
  targetLanguage: TargetLanguage;
  title: string;
  tone: AiTone;
}): {
  action: AiAction;
  title: string;
  contentMarkdown: string;
  promptId?: string;
  locale?: string;
  targetLanguage?: AiTargetLanguage;
  tone?: AiTone;
  instruction?: string;
} => {
  const instruction = customInstruction.trim();
  const needsTargetLanguage = parameterKind
    ? promptNeedsTargetLanguage(parameterKind)
    : actionNeedsTargetLanguage(action);
  const needsTone = parameterKind ? promptNeedsTone(parameterKind) : actionNeedsTone(action);
  return {
    action,
    ...(promptId ? { promptId } : {}),
    ...(locale ? { locale } : {}),
    title,
    contentMarkdown,
    // Saved prompts are resolved by id on the server; only freeform actions send client text.
    ...(!promptId && instruction ? { instruction } : {}),
    ...(needsTargetLanguage ? { targetLanguage } : {}),
    ...(needsTone ? { tone } : {}),
  };
};

export type { AiPromptParameterKind, AiPromptResultMode };
