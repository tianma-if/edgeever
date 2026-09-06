import { common, createLowlight } from "lowlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import type { Editor } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MermaidCodeBlock } from "@/components/MermaidCodeBlock";

export const codeBlockLowlight = createLowlight(common);

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

  addNodeView() {
    return ReactNodeViewRenderer(MermaidCodeBlock);
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
