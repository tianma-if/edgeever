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

/** A rough guess at the language a text is written in, to leave it out of the choices. */
export const guessAiSourceLanguage = (text: string): AiTargetLanguage | null => {
  const sample = text.slice(0, 4000);
  const count = (pattern: RegExp) => sample.match(pattern)?.length ?? 0;
  const kana = count(/[぀-ヿ]/g);
  const hangul = count(/[가-힯]/g);
  const han = count(/[一-鿿]/g);
  const latin = count(/[A-Za-z]/g);
  const total = kana + hangul + han + latin;
  if (!total) return null;
  if (kana > total * 0.05) return "ja";
  if (hangul > total * 0.3) return "ko";
  if (han > total * 0.3) return "zh-CN";
  if (latin > total * 0.5) return "en";
  return null;
};

const UI_LANGUAGE_TARGETS: Record<string, AiTargetLanguage> = { zh: "zh-CN", en: "en", ja: "ja", pl: "pl" };

/**
 * Three target languages to offer for a translation (#652 PR B): the default for the UI
 * language first, then the UI language and common choices, leaving out the source's language.
 */
export const suggestAiTargetLanguages = (source: string, locale: string, fallback: AiTargetLanguage): AiTargetLanguage[] => {
  const sourceLanguage = guessAiSourceLanguage(source);
  const ui = UI_LANGUAGE_TARGETS[locale.toLowerCase().split("-")[0] ?? ""];
  const ordered = [fallback, ui, "en", "zh-CN", "ja", "ko"].filter((item): item is AiTargetLanguage => Boolean(item));
  return [...new Set(ordered)].filter((item) => item !== sourceLanguage).slice(0, 3);
};
