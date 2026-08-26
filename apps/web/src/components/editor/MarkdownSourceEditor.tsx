import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import CodeMirror, {
  EditorView,
  type ReactCodeMirrorRef,
  type Extension,
} from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import {
  githubLight,
  githubDark,
  atomone,
  tokyoNight,
  tokyoNightStorm,
  dracula,
  nord,
  monokai,
  solarizedLight,
  solarizedDark,
  vscodeDark,
  xcodeLight,
  sublime,
  duotoneLight,
  duotoneDark,
  gruvboxDark,
} from "@uiw/codemirror-themes-all";
import type { MarkdownThemeName } from "../ThemeProvider";
import { getAiSlashCommandStart } from "@/lib/editor-shortcuts";
import { cn } from "@/lib/utils";

export interface MarkdownSourceEditorRef {
  getScrollContainer: () => HTMLElement | null;
  getSelection: () => { from: number; to: number };
  setSelection: (from: number, to: number) => void;
  focus: () => void;
  insertText: (text: string, from?: number, to?: number) => void;
  getSelectionCoordinates: () => { top: number; left: number; bottom: number; right: number } | null;
}

export interface MarkdownSourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  themeName: MarkdownThemeName;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  onSlashCommandTrigger?: (commandStart: number) => void;
  onLinkShortcut?: () => void;
}

export const CODE_MIRROR_THEME_MAP: Record<MarkdownThemeName, Extension> = {
  "github-light": githubLight,
  "github-dark": githubDark,
  "one-dark": atomone,
  "tokyo-night": tokyoNight,
  "tokyo-night-storm": tokyoNightStorm,
  dracula,
  nord,
  monokai,
  "solarized-light": solarizedLight,
  "solarized-dark": solarizedDark,
  "vscode-dark": vscodeDark,
  "xcode-light": xcodeLight,
  sublime,
  "duotone-light": duotoneLight,
  "duotone-dark": duotoneDark,
  "gruvbox-dark": gruvboxDark,
};

const baseEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    width: "100%",
    fontSize: "14px",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  },
  ".cm-scroller": {
    overflow: "auto",
    height: "100%",
    lineHeight: "1.6",
    fontFamily: "inherit",
  },
  ".cm-content": {
    padding: "16px 24px 64px",
    minHeight: "100%",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-gutters": {
    borderRight: "1px solid rgba(128, 128, 128, 0.15)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

export const MarkdownSourceEditor = forwardRef<MarkdownSourceEditorRef, MarkdownSourceEditorProps>(
  (
    {
      value,
      onChange,
      themeName,
      readOnly = false,
      placeholder,
      className,
      ariaLabel,
      onSlashCommandTrigger,
      onLinkShortcut,
    },
    ref,
  ) => {
    const cmRef = useRef<ReactCodeMirrorRef | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        getScrollContainer: () => {
          return (
            cmRef.current?.view?.scrollDOM ??
            (cmRef.current?.editor?.querySelector(".cm-scroller") as HTMLElement | null)
          );
        },
        getSelection: () => {
          const view = cmRef.current?.view;
          if (!view) return { from: 0, to: 0 };
          const main = view.state.selection.main;
          return { from: main.from, to: main.to };
        },
        setSelection: (from: number, to: number) => {
          const view = cmRef.current?.view;
          if (!view) return;
          const safeFrom = Math.max(0, Math.min(from, view.state.doc.length));
          const safeTo = Math.max(safeFrom, Math.min(to, view.state.doc.length));
          view.dispatch({
            selection: { anchor: safeFrom, head: safeTo },
            scrollIntoView: true,
          });
        },
        focus: () => {
          cmRef.current?.view?.focus();
        },
        insertText: (text: string, from?: number, to?: number) => {
          const view = cmRef.current?.view;
          if (!view) return;
          const main = view.state.selection.main;
          const insertFrom = from ?? main.from;
          const insertTo = to ?? main.to;
          view.dispatch({
            changes: { from: insertFrom, to: insertTo, insert: text },
            selection: { anchor: insertFrom + text.length },
            scrollIntoView: true,
          });
        },
        getSelectionCoordinates: () => {
          const view = cmRef.current?.view;
          if (!view) return null;
          const main = view.state.selection.main;
          const coords = view.coordsAtPos(main.from);
          if (!coords) return null;
          return {
            top: coords.top,
            left: coords.left,
            bottom: coords.bottom,
            right: coords.right,
          };
        },
      }),
      [],
    );

    const activeThemeExtension = useMemo(() => {
      return CODE_MIRROR_THEME_MAP[themeName] ?? tokyoNight;
    }, [themeName]);

    const extensions = useMemo(() => {
      return [
        markdown(),
        EditorView.lineWrapping,
        baseEditorTheme,
      ];
    }, []);

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent | KeyboardEvent) => {
        // Link shortcut: Cmd+K / Ctrl+K
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          onLinkShortcut?.();
          return;
        }

        // AI Slash Command check on single key press
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey &&
          !(event as KeyboardEvent).isComposing
        ) {
          const view = cmRef.current?.view;
          if (view) {
            const main = view.state.selection.main;
            if (main.empty) {
              const caretPosition = main.head;
              const textBefore = view.state.doc.sliceString(0, caretPosition);
              const commandStart = getAiSlashCommandStart({
                caretPosition,
                insertedText: event.key,
                textBefore,
              });

              if (commandStart !== null) {
                event.preventDefault();
                // Replace the trigger characters (e.g., "/a") with empty string and open AI Assistant
                view.dispatch({
                  changes: { from: commandStart, to: caretPosition, insert: "" },
                  selection: { anchor: commandStart },
                });
                onSlashCommandTrigger?.(commandStart);
              }
            }
          }
        }
      },
      [onLinkShortcut, onSlashCommandTrigger],
    );

    const handleCodeMirrorChange = useCallback(
      (val: string) => {
        onChange(val);
      },
      [onChange],
    );

    return (
      <div
        className={cn(
          "relative h-full w-full overflow-hidden edgeever-markdown-source-editor",
          className,
        )}
        aria-label={ariaLabel}
      >
        <CodeMirror
          ref={cmRef}
          value={value}
          theme={activeThemeExtension}
          onChange={handleCodeMirrorChange}
          onKeyDown={handleKeyDown}
          extensions={extensions}
          readOnly={readOnly}
          editable={!readOnly}
          placeholder={placeholder}
          height="100%"
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLineGutter: false,
            highlightActiveLine: false,
            dropCursor: true,
            allowMultipleSelections: false,
            indentOnInput: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            rectangularSelection: false,
            crosshairCursor: false,
            highlightSelectionMatches: true,
            closeBracketsKeymap: true,
            searchKeymap: true,
            foldKeymap: false,
            completionKeymap: false,
            lintKeymap: false,
          }}
          className="h-full w-full"
        />
      </div>
    );
  },
);

MarkdownSourceEditor.displayName = "MarkdownSourceEditor";
