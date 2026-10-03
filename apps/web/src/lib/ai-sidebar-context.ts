import { conversationLanguage, translationTargetInstruction, type CompanionTurnInput } from "@edgeever/shared";

export type SidebarNoteContext = {
  memoId?: string;
  notebookId?: string;
  notebookTitle?: string;
  noteTitle?: string;
  selectionMarkdown?: string;
  contentMarkdown?: string;
};

export const sidebarCompanionFocus = (context: SidebarNoteContext, includeCurrentNote: boolean): CompanionTurnInput["focus"] => {
  const selection = context.selectionMarkdown?.trim().slice(0, 2000) ?? "";
  const next: NonNullable<CompanionTurnInput["focus"]> = {};
  // The open note's identity lets the agent resolve "this note" without
  // attaching its body to every unrelated request.
  if (context.memoId) {
    next.memoId = context.memoId;
    if (context.noteTitle?.trim()) next.title = context.noteTitle.trim();
  }
  if (includeCurrentNote) {
    if (context.notebookId) next.notebookId = context.notebookId;
    if (context.notebookTitle) next.notebookTitle = context.notebookTitle;
    const content = context.contentMarkdown?.trim() ?? "";
    if (content) {
      next.contentMarkdown = content.slice(0, 4000);
      if (content.length > 4000) next.contentTruncated = true;
    }
  }
  if (selection) next.selectionMarkdown = selection;
  return Object.keys(next).length ? next : undefined;
};

export const sidebarLocalContextText = (
  context: SidebarNoteContext, includeCurrentNote: boolean,
  conversation: { message: string; recentUserMessages: readonly string[]; fallbackLocale: CompanionTurnInput["locale"] },
): string => {
  const selection = context.selectionMarkdown?.trim().slice(0, 2000);
  const content = includeCurrentNote ? context.contentMarkdown?.trim().slice(0, 2000) : "";
  return [
    translationTargetInstruction(conversationLanguage(conversation.message, conversation.recentUserMessages, conversation.fallbackLocale)),
    context.memoId ? `Open EdgeEver note for this turn. When the user refers to this note, use its ID with the connected EdgeEver MCP get_memo tool to read the full content if available:\nID: ${context.memoId}\nTitle (data): ${context.noteTitle?.trim() || "(untitled)"}` : "",
    selection ? `Selected text from the current note (data):\n${selection}` : "",
    content ? `Current note body (data):\n${content}` : "",
  ].filter(Boolean).join("\n\n");
};
