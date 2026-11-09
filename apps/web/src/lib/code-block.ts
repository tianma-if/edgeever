import { createCodeBlockLowlight } from "./code-block-highlighting";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import type { Editor } from "@tiptap/core";
import type { ResolvedPos } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MermaidCodeBlock } from "@/components/MermaidCodeBlock";
import { NoteProperties } from "@/components/editor/NoteProperties";
import { FRONT_MATTER_LANGUAGE } from "@edgeever/shared";
import { createElement } from "react";

export const codeBlockLowlight = createCodeBlockLowlight();

const getCodeLineAtCursor = (cursor: ResolvedPos) => {
  if (cursor.parent.type.name !== "codeBlock") return null;

  const source = cursor.parent.textContent;
  const offset = cursor.parentOffset;
  const start = offset === 0 ? 0 : source.lastIndexOf("\n", offset - 1) + 1;
  const end = source.indexOf("\n", offset);
  return source.slice(start, end === -1 ? source.length : end).replace(/\r$/, "");
};

const getCopyableCodeLine = (view: EditorView) => {
  if (!view.editable || !view.hasFocus() || !(view.state.selection instanceof TextSelection)) return null;

  // Native Copy can run before ProseMirror has observed a click that moved the caret.
  const selection = view.dom.ownerDocument.getSelection();
  const anchor = selection?.anchorNode;
  if (!selection?.isCollapsed || !anchor || !view.dom.contains(anchor)) return null;

  return getCodeLineAtCursor(view.state.doc.resolve(view.posAtDOM(anchor, selection.anchorOffset)));
};

export const selectCurrentCodeBlockContent = (editor: Editor) => {
  const { $from, $to, from, to } = editor.state.selection;
  if ($from.parent !== $to.parent || $from.parent.type.name !== "codeBlock") {
    return false;
  }

  const blockFrom = $from.start();
  const blockTo = $from.end();
  if (from === blockFrom && to === blockTo) {
    return false;
  }

  return editor.commands.setTextSelection({ from: blockFrom, to: blockTo });
};

export const EdgeEverCodeBlock = CodeBlockLowlight.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      "Mod-a": () => selectCurrentCodeBlockContent(this.editor),
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        props: {
          handleDOMEvents: {
            beforecopy: (view, event) => {
              // Chromium can disable native Copy when there is no selection.
              if (!getCopyableCodeLine(view)) return false;
              event.preventDefault();
              return true;
            },
            copy: (view, event) => {
              const line = getCopyableCodeLine(view);
              if (!line || !event.clipboardData) return false;

              event.clipboardData.setData("text/plain", line);
              event.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer((props) => createElement(
      props.node.attrs.language === FRONT_MATTER_LANGUAGE ? NoteProperties : MermaidCodeBlock, props,
    ));
  },
});

export const CODE_BLOCK_LANGUAGES = [
  { value: "plaintext", label: "Plain text" },
  { value: "bash", label: "Bash" },
  { value: "c", label: "C" },
  { value: "csharp", label: "C#" },
  { value: "cpp", label: "C++" },
  { value: "css", label: "CSS" },
  { value: "go", label: "Go" },
  { value: "html", label: "HTML" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "json", label: "JSON" },
  { value: "kotlin", label: "Kotlin" },
  { value: "markdown", label: "Markdown" },
  { value: "mermaid", label: "Mermaid" },
  { value: "php", label: "PHP" },
  { value: "python", label: "Python" },
  { value: "ruby", label: "Ruby" },
  { value: "rust", label: "Rust" },
  { value: "sql", label: "SQL" },
  { value: "swift", label: "Swift" },
  { value: "typescript", label: "TypeScript" },
  { value: "yaml", label: "YAML" },
] as const;

export const getCodeBlockLanguageValue = (language: unknown) => {
  if (typeof language !== "string" || !language) {
    return "plaintext";
  }

  return CODE_BLOCK_LANGUAGES.some((option) => option.value === language) ? language : "plaintext";
};
