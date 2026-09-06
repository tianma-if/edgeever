import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type NoteSearchMatch = {
  from: number;
  to: number;
};

export const getSearchNavigationIdentity = (
  memoId: string | null,
  source: "note" | "content",
  query: string,
) => JSON.stringify([memoId, source, query]);

export const NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY = new PluginKey("edgeever-note-search-highlight");

export const getSearchMatchesFromDocument = (
  doc: Editor["state"]["doc"],
  query: string,
): NoteSearchMatch[] => {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return [];

  const characters: Array<{ char: string; pos: number }> = [];
  let previousTextEnd: number | null = null;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    if (previousTextEnd !== null && pos > previousTextEnd) {
      characters.push({ char: "\u0000", pos: -1 });
    }
    for (let index = 0; index < node.text.length; index += 1) {
      characters.push({ char: node.text[index] ?? "", pos: pos + index });
    }
    previousTextEnd = pos + node.text.length;
  });

  const haystack = characters.map((item) => item.char).join("").toLocaleLowerCase();
  const matches: NoteSearchMatch[] = [];
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

export const createNoteSearchHighlightPlugin = (options: {
  getQuery: () => string;
  getActiveIndex: () => number;
}) => new Plugin({
  key: NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY,
  props: {
    decorations: (state) => {
      const matches = getSearchMatchesFromDocument(state.doc, options.getQuery());
      if (matches.length === 0) return DecorationSet.empty;
      const activeIndex = options.getActiveIndex();
      return DecorationSet.create(
        state.doc,
        matches.map((match, index) => Decoration.inline(match.from, match.to, {
          class: index === activeIndex
            ? "edgeever-search-match edgeever-search-match-active"
            : "edgeever-search-match",
        })),
      );
    },
  },
});

export const getNextSearchMatchIndex = (
  current: number,
  direction: 1 | -1,
  matchCount: number,
) => matchCount > 0 ? (current + direction + matchCount) % matchCount : 0;

export const formatNoteSearchMatchLabel = (
  query: string,
  activeIndex: number,
  matchCount: number,
) => query.trim()
  ? `${matchCount > 0 ? activeIndex + 1 : 0}/${matchCount}`
  : "0/0";
