import type { ImportFormat } from "./types";

// Notion adds a page ID to exported paths. Keep the original path as the
// identity/link target; remove the suffix only from user-visible names.
export const markdownExportName = (format: ImportFormat, name: string, csv = false) => {
  if (format !== "notion") return name;
  const id = csv ? / [a-f0-9]{32}(?=_all$|$)/i : / [a-f0-9]{32}$/i;
  return name.replace(id, "") || name;
};

export const markdownExportTitle = (format: ImportFormat, markdown: string, fallback: string) => {
  if (format !== "notion" && format !== "siyuan") return fallback;
  // Only the opening heading is a document title, not a heading inside a code
  // block or an arbitrary later section. Front matter is handled separately.
  const heading = /^(?:[ \t]*\r?\n)* {0,3}#(?=[ \t])([^\r\n]+)/.exec(markdown)?.[1];
  return heading?.replace(/[ \t]+#+[ \t]*$/, "").trim() || markdownExportName(format, fallback);
};
