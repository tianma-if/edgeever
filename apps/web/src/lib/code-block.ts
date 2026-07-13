import { common, createLowlight } from "lowlight";

export const codeBlockLowlight = createLowlight(common);

export const CODE_BLOCK_LANGUAGES = [
  { value: "plaintext", label: "Plain text" },
  { value: "bash", label: "Bash" },
  { value: "css", label: "CSS" },
  { value: "html", label: "HTML" },
  { value: "javascript", label: "JavaScript" },
  { value: "json", label: "JSON" },
  { value: "markdown", label: "Markdown" },
  { value: "python", label: "Python" },
  { value: "sql", label: "SQL" },
  { value: "typescript", label: "TypeScript" },
] as const;

export const getCodeBlockLanguageValue = (language: unknown) => {
  if (typeof language !== "string" || !language) {
    return "plaintext";
  }

  return CODE_BLOCK_LANGUAGES.some((option) => option.value === language) ? language : "plaintext";
};
