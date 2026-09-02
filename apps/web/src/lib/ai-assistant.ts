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
  type AiAttachmentInput,
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

export const resolveAiAssistantComposerInput = ({
  composerText,
  isFreeformCustom,
  noteContentMarkdown,
  noteTitle,
}: {
  composerText: string;
  isFreeformCustom: boolean;
  noteContentMarkdown: string;
  noteTitle: string;
}) => {
  const usesComposerAsSource = !isFreeformCustom && Boolean(composerText.trim());
  return {
    contentMarkdown: usesComposerAsSource ? composerText : noteContentMarkdown,
    customInstruction: isFreeformCustom ? composerText : "",
    title: usesComposerAsSource ? "" : noteTitle,
    usesComposerAsSource,
  };
};

export const buildAiRefinementInstruction = ({
  originalAction,
  originalInstruction,
  refinement,
  targetLanguage,
  tone,
}: {
  originalAction: AiAction;
  originalInstruction?: string;
  refinement: string;
  targetLanguage?: AiTargetLanguage;
  tone?: AiTone;
}) => [
  "Revise only the supplied current result according to the follow-up request.",
  "Continue the original processing task instead of starting a different task. Preserve the result's language, purpose, factual meaning, and useful formatting unless the follow-up explicitly requests a change.",
  `Original processing action:\n${originalAction}`,
  originalInstruction?.trim()
    ? `Original processing instruction:\n${originalInstruction.trim()}`
    : undefined,
  targetLanguage
    ? `Keep the entire revised result in the target language: ${targetLanguage}. Do not translate it back to the language used by the follow-up request.`
    : undefined,
  tone ? `Keep the revised result in the requested tone: ${tone}.` : undefined,
  `Follow-up request:\n${refinement}`,
].filter(Boolean).join("\n\n");

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
  attachments,
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
  attachments?: AiAttachmentInput[];
}): {
  action: AiAction;
  title: string;
  contentMarkdown: string;
  promptId?: string;
  locale?: string;
  targetLanguage?: AiTargetLanguage;
  tone?: AiTone;
  instruction?: string;
  attachments?: AiAttachmentInput[];
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
    ...(attachments?.length ? { attachments } : {}),
    ...(needsTargetLanguage ? { targetLanguage } : {}),
    ...(needsTone ? { tone } : {}),
  };
};

export type { AiPromptParameterKind, AiPromptResultMode };
