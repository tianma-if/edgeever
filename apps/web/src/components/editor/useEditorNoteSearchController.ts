import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { Editor } from "@tiptap/react";
import {
  createNoteSearchHighlightPlugin,
  formatNoteSearchMatchLabel,
  getNextSearchMatchIndex,
  getSearchMatchesFromDocument,
  getSearchNavigationIdentity,
  NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY,
  type NoteSearchMatch,
} from "./note-search";

type EditorNoteSearchControllerOptions = {
  contentSearchQuery: string;
  dirtyVersion: number;
  editor: Editor | null;
  editorScrollContainerRef: RefObject<HTMLDivElement | null>;
  noteSearchIndex: number;
  noteSearchInputRef: RefObject<HTMLInputElement | null>;
  noteSearchOpen: boolean;
  noteSearchQuery: string;
  noteSearchReplacement: string;
  readOnly: boolean;
  replaceFocusToken: number;
  searchFocusToken: number;
  memoId: string | null;
  setNoteSearchIndex: Dispatch<SetStateAction<number>>;
  setNoteSearchOpen: Dispatch<SetStateAction<boolean>>;
  setNoteSearchReplaceOpen: Dispatch<SetStateAction<boolean>>;
};

const isEditorReady = (editor: Editor | null | undefined): editor is Editor =>
  Boolean(editor && !editor.isDestroyed && (editor as { extensionManager?: unknown }).extensionManager);

const getEditorSearchMatches = (editor: Editor | null, query: string): NoteSearchMatch[] => {
  if (!isEditorReady(editor)) {
    return [];
  }

  return getSearchMatchesFromDocument(editor.state.doc, query);
};

export const useEditorNoteSearchController = ({
  contentSearchQuery,
  dirtyVersion,
  editor,
  editorScrollContainerRef,
  memoId,
  noteSearchIndex,
  noteSearchInputRef,
  noteSearchOpen,
  noteSearchQuery,
  noteSearchReplacement,
  readOnly,
  replaceFocusToken,
  searchFocusToken,
  setNoteSearchIndex,
  setNoteSearchOpen,
  setNoteSearchReplaceOpen,
}: EditorNoteSearchControllerOptions) => {
  const automaticSelectionRef = useRef<{ editor: Editor; identity: string } | null>(null);
  const noteSearchMatches = useMemo(
    () => getEditorSearchMatches(editor, noteSearchQuery),
    [dirtyVersion, editor, memoId, noteSearchQuery],
  );
  const contentSearchMatches = useMemo(
    () => getEditorSearchMatches(editor, contentSearchQuery),
    [contentSearchQuery, dirtyVersion, editor, memoId],
  );

  const selectMatch = useCallback(
    (index: number, matches: NoteSearchMatch[]) => {
      const match = matches[index];

      if (!isEditorReady(editor) || !match) {
        return;
      }

      editor.chain().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run();

      window.requestAnimationFrame(() => {
        const scrollContainer = editorScrollContainerRef.current;
        const domPosition = editor.view.domAtPos(match.from);
        const node = domPosition.node.nodeType === Node.TEXT_NODE
          ? domPosition.node.parentElement
          : domPosition.node instanceof Element
            ? domPosition.node
            : domPosition.node.parentElement;

        if (!scrollContainer || !node) {
          return;
        }

        const containerRect = scrollContainer.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        const padding = 24;
        const isAbove = nodeRect.top < containerRect.top + padding;
        const isBelow = nodeRect.bottom > containerRect.bottom - padding;

        if (isAbove || isBelow) {
          const targetTop = scrollContainer.scrollTop + nodeRect.top - containerRect.top
            - (scrollContainer.clientHeight - nodeRect.height) / 2;
          scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
        }
      });
    },
    [editor, editorScrollContainerRef],
  );

  useEffect(() => {
    if (!isEditorReady(editor)) {
      return;
    }

    const searchHighlightPlugin = createNoteSearchHighlightPlugin({
      getQuery: () => noteSearchOpen ? noteSearchQuery : contentSearchQuery,
      getActiveIndex: () => noteSearchOpen ? noteSearchIndex : 0,
    });

    editor.registerPlugin(searchHighlightPlugin);

    return () => {
      if (isEditorReady(editor)) {
        editor.unregisterPlugin(NOTE_SEARCH_HIGHLIGHT_PLUGIN_KEY);
      }
    };
  }, [contentSearchQuery, editor, noteSearchIndex, noteSearchOpen, noteSearchQuery]);

  const focusSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      noteSearchInputRef.current?.focus();
      noteSearchInputRef.current?.select();
    });
  }, [noteSearchInputRef]);

  const openSearch = useCallback((showReplace = false) => {
    setNoteSearchOpen(true);
    setNoteSearchReplaceOpen(showReplace);
    focusSearchInput();
  }, [focusSearchInput, setNoteSearchOpen, setNoteSearchReplaceOpen]);

  const openReplace = useCallback(() => {
    if (readOnly) return;
    openSearch(true);
  }, [openSearch, readOnly]);

  const closeSearch = useCallback(() => {
    setNoteSearchOpen(false);
    if (isEditorReady(editor)) {
      editor.commands.focus();
    }
  }, [editor, setNoteSearchOpen]);

  useEffect(() => {
    if (!noteSearchOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      closeSearch();
    };

    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [closeSearch, noteSearchOpen]);

  const moveMatch = useCallback((direction: 1 | -1) => {
    if (noteSearchMatches.length === 0) {
      return;
    }

    setNoteSearchIndex((current) => {
      const next = getNextSearchMatchIndex(current, direction, noteSearchMatches.length);
      selectMatch(next, noteSearchMatches);
      return next;
    });
  }, [noteSearchMatches, selectMatch, setNoteSearchIndex]);

  useEffect(() => {
    if (searchFocusToken !== 0) {
      openSearch();
    }
  }, [openSearch, searchFocusToken]);

  useEffect(() => {
    if (replaceFocusToken !== 0) {
      openReplace();
    }
  }, [openReplace, replaceFocusToken]);

  useEffect(() => {
    if (!isEditorReady(editor)) {
      return;
    }

    const source = noteSearchOpen ? "note" : "content";
    const query = noteSearchOpen ? noteSearchQuery : contentSearchQuery;
    const matches = noteSearchOpen ? noteSearchMatches : contentSearchMatches;
    const identity = getSearchNavigationIdentity(memoId, source, query);
    const previousSelection = automaticSelectionRef.current;

    if (previousSelection?.editor === editor && previousSelection.identity === identity) {
      return;
    }

    automaticSelectionRef.current = { editor, identity };
    setNoteSearchIndex(0);

    if (matches[0]) {
      selectMatch(0, matches);
    }
  }, [
    contentSearchMatches,
    contentSearchQuery,
    editor,
    memoId,
    noteSearchMatches,
    noteSearchOpen,
    noteSearchQuery,
    selectMatch,
    setNoteSearchIndex,
  ]);

  useEffect(() => {
    setNoteSearchIndex((current) => noteSearchMatches.length === 0
      ? 0
      : Math.min(current, noteSearchMatches.length - 1));
  }, [noteSearchMatches.length, setNoteSearchIndex]);

  const replaceAllMatches = useCallback(() => {
    if (!isEditorReady(editor) || readOnly || noteSearchMatches.length === 0) {
      return;
    }

    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        for (const match of [...noteSearchMatches].reverse()) {
          tr.insertText(noteSearchReplacement, match.from, match.to);
        }

        dispatch?.(tr);
        return true;
      })
      .run();

    setNoteSearchIndex(0);
    window.requestAnimationFrame(() => noteSearchInputRef.current?.focus());
  }, [
    editor,
    noteSearchInputRef,
    noteSearchMatches,
    noteSearchReplacement,
    readOnly,
    setNoteSearchIndex,
  ]);

  return {
    closeSearch,
    matchLabel: formatNoteSearchMatchLabel(
      noteSearchQuery,
      noteSearchIndex,
      noteSearchMatches.length,
    ),
    matches: noteSearchMatches,
    moveMatch,
    openReplace,
    openSearch,
    replaceAllMatches,
  };
};
