import { useEffect, useState } from "react";
import {
  DEFAULT_NOTE_PROSE_EMPHASIS_STYLE,
  DEFAULT_NOTE_PROSE_HEADING_STYLE,
  DEFAULT_NOTE_PROSE_QUOTE_STYLE,
  parseNoteProseParagraphSpacing,
  parseNoteProseTextAlign,
  parseNoteProseLetterSpacing,
  parseNoteProseEmphasisStyle,
  parseNoteProseHeadingStyle,
  parseNoteProseQuoteStyle,
  type NoteProseStylePreferences,
} from "@edgeever/shared";

export const NOTE_PROSE_STYLE_STORAGE_KEY = "edgeever.note-prose-style";
export const NOTE_PROSE_STYLE_CHANGED_EVENT = "edgeever:note-prose-style-changed";

let unsavedNoteProseStylePreference: NoteProseStylePreferences | null = null;

export const DEFAULT_NOTE_PROSE_STYLE_PREFERENCES: NoteProseStylePreferences = {
  paragraphSpacing: 8,
  textAlign: "left",
  letterSpacing: "default",
  headingStyle: DEFAULT_NOTE_PROSE_HEADING_STYLE,
  quoteStyle: DEFAULT_NOTE_PROSE_QUOTE_STYLE,
  emphasisStyle: DEFAULT_NOTE_PROSE_EMPHASIS_STYLE,
  showMagazineCover: false,
};

export const resolveStoredNoteProseStylePreference = (
  stored: string | null,
): NoteProseStylePreferences => {
  if (!stored) return DEFAULT_NOTE_PROSE_STYLE_PREFERENCES;
  try {
    const parsed = JSON.parse(stored) as {
      paragraphSpacing?: unknown;
      textAlign?: unknown;
      letterSpacing?: unknown;
      headingStyle?: unknown;
      quoteStyle?: unknown;
      emphasisStyle?: unknown;
      showMagazineCover?: unknown;
    } | null;
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_NOTE_PROSE_STYLE_PREFERENCES;
    }
    return {
      paragraphSpacing: parseNoteProseParagraphSpacing(parsed.paragraphSpacing) ?? 8,
      textAlign: parseNoteProseTextAlign(parsed.textAlign) ?? "left",
      letterSpacing: parseNoteProseLetterSpacing(parsed.letterSpacing) ?? "default",
      headingStyle: parseNoteProseHeadingStyle(parsed.headingStyle) ?? DEFAULT_NOTE_PROSE_HEADING_STYLE,
      quoteStyle: parseNoteProseQuoteStyle(parsed.quoteStyle) ?? DEFAULT_NOTE_PROSE_QUOTE_STYLE,
      emphasisStyle: parseNoteProseEmphasisStyle(parsed.emphasisStyle) ?? DEFAULT_NOTE_PROSE_EMPHASIS_STYLE,
      showMagazineCover: typeof parsed.showMagazineCover === "boolean" ? parsed.showMagazineCover : false,
    };
  } catch {
    return DEFAULT_NOTE_PROSE_STYLE_PREFERENCES;
  }
};

export const readNoteProseStylePreference = (): NoteProseStylePreferences => {
  if (unsavedNoteProseStylePreference !== null) return unsavedNoteProseStylePreference;
  if (typeof window === "undefined") return DEFAULT_NOTE_PROSE_STYLE_PREFERENCES;
  try {
    return resolveStoredNoteProseStylePreference(
      window.localStorage?.getItem(NOTE_PROSE_STYLE_STORAGE_KEY) ?? null,
    );
  } catch {
    return DEFAULT_NOTE_PROSE_STYLE_PREFERENCES;
  }
};

export const writeNoteProseStylePreference = (
  patch: Partial<NoteProseStylePreferences>,
): NoteProseStylePreferences => {
  const current = readNoteProseStylePreference();
  const next: NoteProseStylePreferences = {
    paragraphSpacing: parseNoteProseParagraphSpacing(patch.paragraphSpacing) ?? current.paragraphSpacing,
    textAlign: parseNoteProseTextAlign(patch.textAlign) ?? current.textAlign,
    letterSpacing: parseNoteProseLetterSpacing(patch.letterSpacing) ?? current.letterSpacing,
    headingStyle: parseNoteProseHeadingStyle(patch.headingStyle) ?? current.headingStyle,
    quoteStyle: parseNoteProseQuoteStyle(patch.quoteStyle) ?? current.quoteStyle,
    emphasisStyle: parseNoteProseEmphasisStyle(patch.emphasisStyle) ?? current.emphasisStyle,
    showMagazineCover: typeof patch.showMagazineCover === "boolean" ? patch.showMagazineCover : current.showMagazineCover,
  };
  if (typeof window === "undefined") {
    unsavedNoteProseStylePreference = next;
    return next;
  }
  try {
    window.localStorage?.setItem(NOTE_PROSE_STYLE_STORAGE_KEY, JSON.stringify(next));
    unsavedNoteProseStylePreference = null;
  } catch {
    unsavedNoteProseStylePreference = next;
  }
  window.dispatchEvent(
    new CustomEvent(NOTE_PROSE_STYLE_CHANGED_EVENT, { detail: next }),
  );
  return next;
};

export const useNoteProseStylePreference = (): NoteProseStylePreferences => {
  const [preference, setPreference] = useState<NoteProseStylePreferences>(readNoteProseStylePreference);

  useEffect(() => {
    const syncPreference = () => setPreference(readNoteProseStylePreference());
    const handlePreferenceChanged = (event: Event) => {
      const detail = (event as CustomEvent<NoteProseStylePreferences | undefined>).detail;
      if (detail && typeof detail === "object") {
        setPreference({
          paragraphSpacing: parseNoteProseParagraphSpacing(detail.paragraphSpacing) ?? 8,
          textAlign: parseNoteProseTextAlign(detail.textAlign) ?? "left",
          letterSpacing: parseNoteProseLetterSpacing(detail.letterSpacing) ?? "default",
          headingStyle: parseNoteProseHeadingStyle(detail.headingStyle) ?? DEFAULT_NOTE_PROSE_HEADING_STYLE,
          quoteStyle: parseNoteProseQuoteStyle(detail.quoteStyle) ?? DEFAULT_NOTE_PROSE_QUOTE_STYLE,
          emphasisStyle: parseNoteProseEmphasisStyle(detail.emphasisStyle) ?? DEFAULT_NOTE_PROSE_EMPHASIS_STYLE,
          showMagazineCover: typeof detail.showMagazineCover === "boolean" ? detail.showMagazineCover : false,
        });
        return;
      }
      syncPreference();
    };
    window.addEventListener(NOTE_PROSE_STYLE_CHANGED_EVENT, handlePreferenceChanged);
    window.addEventListener("storage", syncPreference);
    return () => {
      window.removeEventListener(NOTE_PROSE_STYLE_CHANGED_EVENT, handlePreferenceChanged);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  return preference;
};
