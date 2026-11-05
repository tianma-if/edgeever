import { AI_TARGET_LANGUAGES, type AiTargetLanguage } from "@edgeever/shared";
import type { AiBodyDraftAction } from "./ai-body-draft-store";

/**
 * Sidebar body commands (#652 PR B): `/translate` and `/improve` (and the selection menu's
 * Translate) run the shared note-generation flow instead of an Agent turn, so long notes are
 * done in parts and incomplete results cannot replace the note. `/summarize` stays an Agent turn.
 */
export type AiBodyCommand = {
  action: AiBodyDraftAction;
  targetLanguage?: AiTargetLanguage;
  /** Extra wording after the command, sent as the user's instruction. */
  instruction?: string;
};

const LANGUAGE_ALIASES: Record<string, AiTargetLanguage> = {
  en: "en", english: "en", 英文: "en", 英语: "en", 英語: "en", angielski: "en", английский: "en",
  "zh-cn": "zh-CN", zh: "zh-CN", chinese: "zh-CN", 中文: "zh-CN", 简体中文: "zh-CN", 汉语: "zh-CN", 中国語: "zh-CN", chiński: "zh-CN", китайский: "zh-CN",
  "zh-tw": "zh-TW", 繁体中文: "zh-TW", 繁體中文: "zh-TW",
  ja: "ja", japanese: "ja", 日语: "ja", 日文: "ja", 日本語: "ja", japoński: "ja", японский: "ja",
  ko: "ko", korean: "ko", 韩语: "ko", 韓国語: "ko", 한국어: "ko",
  es: "es", spanish: "es", 西班牙语: "es", español: "es",
  fr: "fr", french: "fr", 法语: "fr", français: "fr",
  de: "de", german: "de", 德语: "de", deutsch: "de",
  pt: "pt", portuguese: "pt", 葡萄牙语: "pt", português: "pt",
  pl: "pl", polish: "pl", 波兰语: "pl", polski: "pl", ポーランド語: "pl", польский: "pl",
};

/** A language named by its code or a common name, in any of the app's languages. */
export const parseAiTargetLanguage = (value: string): AiTargetLanguage | null => {
  const key = value.trim().toLowerCase();
  if ((AI_TARGET_LANGUAGES as readonly string[]).includes(value.trim())) return value.trim() as AiTargetLanguage;
  return LANGUAGE_ALIASES[key] ?? null;
};

/**
 * The body command for a sidebar skill, or `null` when the skill stays an Agent turn.
 * `/translate ja` picks the language; without one the sidebar asks which language to use, as the
 * Agent did. Other words after a command become the instruction.
 */
export const resolveAiBodyCommand = (skill: string, rest: string): AiBodyCommand | null => {
  const words = rest.trim();
  if (skill === "improve") return { action: "improve-writing", ...(words ? { instruction: words } : {}) };
  if (skill !== "translate") return null;
  const [first = "", ...others] = words.split(/\s+/);
  const named = first ? parseAiTargetLanguage(first) : null;
  const instruction = (named ? others.join(" ") : words).trim();
  return {
    action: "translate",
    ...(named ? { targetLanguage: named } : {}),
    ...(instruction ? { instruction } : {}),
  };
};
