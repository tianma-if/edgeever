import type { CompanionToolCall, CompanionToolEffect, CompanionTodo, CompanionQuestion } from "@edgeever/shared";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asMemo = (value: unknown): { id?: string; title?: string | null; revision?: number; notebookId?: string } | null => {
  const record = asRecord(value);
  return record && typeof record.id === "string" ? record as { id: string; title?: string | null; revision?: number; notebookId?: string } : null;
};

const effect = (kind: CompanionToolEffect["kind"], memo?: { id?: string; title?: string | null; revision?: number; notebookId?: string } | null, extra?: Partial<CompanionToolEffect>): CompanionToolEffect => ({
  kind,
  ...(memo?.id ? { memoId: memo.id } : {}),
  ...(memo?.notebookId ? { notebookId: memo.notebookId } : {}),
  ...(typeof memo?.title === "string" && memo.title ? { title: memo.title.slice(0, 160) } : {}),
  ...(typeof memo?.revision === "number" ? { revision: memo.revision } : {}),
  ...extra,
});

const ids = (value: unknown) => Array.isArray(value) ? value.map(String).slice(0, 8) : [];

export function describeCompanionTool(
  name: string,
  args: Record<string, unknown>,
  result: unknown,
  previous?: Map<string, { revision: number; title?: string }>,
): CompanionToolEffect[] {
  const record = asRecord(result);
  if (record?.status === "awaiting_user_confirmation") return [];
  const memo = asMemo(record?.memo) ?? asMemo(result);
  const prior = (id: string) => previous?.get(id);
  if (name === "search_memos" || name === "list_memos") {
    const memos = Array.isArray(record?.memos) ? record.memos : [];
    return memos.slice(0, 5).map(item => effect("listed", asMemo(item)));
  }
  if (name === "get_memo" || name === "get_diagram" || name === "get_table_records") {
    return [effect("read", memo ?? { id: String(args.memoId ?? record?.memoId ?? record?.id ?? "") })];
  }
  if (name === "create_memo" || name === "create_table_memo" || name === "create_diagram_memo" || name === "create_infographic_memo" || name === "use_note_template") {
    return [effect("created", memo)];
  }
  if (name === "update_memo" || name === "update_diagram" || name === "restore_memo_revision") {
    const id = memo?.id ?? String(args.memoId ?? "");
    const before = prior(id);
    return [effect("updated", memo ?? { id, title: before?.title }, { previousRevision: before?.revision })];
  }
  if (name === "add_table_record") {
    const id = String(record?.memoId ?? args.memoId ?? "");
    return [effect("updated", { id, revision: typeof record?.revision === "number" ? record.revision : undefined },
      { previousRevision: prior(id)?.revision })];
  }
  if (name === "merge_memos") {
    const created = effect("merged", memo);
    const sources = ids(args.memoIds).filter(id => id !== memo?.id).map(id => effect("trashed", { id, title: prior(id)?.title }));
    return [created, ...sources].slice(0, 6);
  }
  if (name === "trash_memos") return ids(args.memoIds).map(id => effect("trashed", { id, title: prior(id)?.title }));
  if (name === "restore_memos") return ids(args.memoIds).map(id => effect("restored", { id, title: prior(id)?.title }));
  if (name === "move_memos") {
    return ids(args.memoIds).map(id => effect("moved", { id, title: prior(id)?.title, notebookId: String(args.notebookId ?? "") }));
  }
  if (name === "add_tags_to_memos" || name === "remove_tags_from_memos") {
    return ids(args.memoIds).map(id => effect("tagged", { id, title: prior(id)?.title }));
  }
  if (memo) return [effect("other", memo)];
  return [];
}

export const parseJsonArray = <T>(value: string | null | undefined, fallback: T[] = []): T[] => {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
};

export const parseJsonObject = <T extends object>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : fallback;
  } catch {
    return fallback;
  }
};

export const compactCompanionTools = (tools: CompanionToolCall[]) => tools.slice(-24);
export const compactCompanionTodos = (todos: CompanionTodo[]) => todos.slice(0, 12);
export const compactCompanionQuestions = (questions: CompanionQuestion[]) => questions.slice(0, 3);
