import { insertMarkdownSnippet } from "./editor-external-link";

/**
 * Insert generated block content at the captured text-editor caret without
 * merging it into the surrounding Markdown line.
 */
export const insertAiDraftAtTextCursor = (
  source: string,
  draft: string,
  position: number,
): { next: string; caret: number } => {
  const normalizedDraft = draft.trim();
  const safePosition = Math.max(0, Math.min(position, source.length));
  const before = source.slice(0, safePosition);
  const after = source.slice(safePosition);
  const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
  const suffix = after && !after.startsWith("\n") ? "\n\n" : "";

  return insertMarkdownSnippet(
    source,
    `${prefix}${normalizedDraft}${suffix}`,
    safePosition,
    safePosition,
  );
};
