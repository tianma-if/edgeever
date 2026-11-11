import type { ImportFormat } from "./types";

// Notion adds a page ID to exported paths. Keep the original path as the
// identity/link target; remove the suffix only from user-visible names.
export const markdownExportName = (format: ImportFormat, name: string) =>
  format === "notion" ? name.replace(/ [a-f0-9]{32}$/i, "") || name : name;

export const markdownExportTitle = (format: ImportFormat, markdown: string, fallback: string) => {
  if (format !== "notion" && format !== "siyuan") return fallback;
  // Only the opening heading is a document title, not a heading inside a code
  // block or an arbitrary later section. Front matter is handled separately.
  return /^\s*# ([^\r\n]+)(?:\r?\n|$)/.exec(markdown)?.[1]?.trim()
    || markdownExportName(format, fallback);
};
