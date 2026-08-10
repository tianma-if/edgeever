import {
  AI_SELECTED_TEXT_ACTIONS,
  AI_TARGET_LANGUAGES,
  AI_TONES,
  AI_WHOLE_NOTE_ACTIONS,
  canReplaceAiSource,
  getDefaultAiAction,
  getDefaultAiTargetLanguage,
  type AiAction,
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
export { canReplaceAiSource, getDefaultAiAction };

export const buildAiAssistantRequest = ({
  action,
  contentMarkdown,
  customInstruction,
  targetLanguage,
  title,
  tone,
}: {
  action: AiAssistantAction;
  contentMarkdown: string;
  customInstruction: string;
  targetLanguage: TargetLanguage;
  title: string;
  tone: AiTone;
}): {
  action: AiAction;
  title: string;
  contentMarkdown: string;
  targetLanguage?: AiTargetLanguage;
  tone?: AiTone;
  instruction?: string;
} => ({
  action,
  title,
  contentMarkdown,
  ...(action === "translate" ? { targetLanguage } : {}),
  ...(action === "change-tone" ? { tone } : {}),
  ...(action === "custom" ? { instruction: customInstruction.trim() } : {}),
});
