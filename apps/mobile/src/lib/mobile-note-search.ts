import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type MobileNoteSearchMatch = {
  from: number;
  to: number;
};

export const MOBILE_NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY = new PluginKey("edgeever-mobile-note-search-highlight");

export const getMobileNoteSearchMatches = (
  doc: Editor["state"]["doc"],
  query: string
): MobileNoteSearchMatch[] => {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) {
    return [];
  }

  const characters: Array<{ char: string; pos: number }> = [];
  let previousTextEnd: number | null = null;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return;
    }
    if (previousTextEnd !== null && pos > previousTextEnd) {
      characters.push({ char: "\u0000", pos: -1 });
    }
    for (let index = 0; index < node.text.length; index += 1) {
      characters.push({ char: node.text[index] ?? "", pos: pos + index });
    }
    previousTextEnd = pos + node.text.length;
  });

  const haystack = characters.map((item) => item.char).join("").toLocaleLowerCase();
  const matches: MobileNoteSearchMatch[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const start = characters[index];
    const end = characters[index + needle.length - 1];
    if (start && end && start.pos >= 0 && end.pos >= 0) {
      matches.push({ from: start.pos, to: end.pos + 1 });
    }
    index = haystack.indexOf(needle, index + needle.length);
  }
  return matches;
};

export const createMobileNoteSearchHighlightPlugin = (options: {
  getActiveIndex: () => number;
  getQuery: () => string;
}) => new Plugin({
  key: MOBILE_NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY,
  props: {
    decorations: (state) => {
      const matches = getMobileNoteSearchMatches(state.doc, options.getQuery());
      if (matches.length === 0) {
        return DecorationSet.empty;
      }
      const activeIndex = options.getActiveIndex();
      return DecorationSet.create(
        state.doc,
        matches.map((match, index) => Decoration.inline(match.from, match.to, {
          class: index === activeIndex
            ? "edgeever-search-match edgeever-search-match-active"
            : "edgeever-search-match",
        }))
      );
    },
  },
});

export const getNextMobileNoteSearchIndex = (
  current: number,
  direction: 1 | -1,
  matchCount: number
) => matchCount > 0 ? (current + direction + matchCount) % matchCount : 0;
