import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

export const upsertMemoSearchDocumentStatement = (
  database: DatabaseAdapter,
  memoId: string,
  title: string | null,
  contentText: string,
  tags: string,
): PreparedStatementAdapter => database.prepare(
  `INSERT INTO memo_search_documents (memo_id, title, content_text, tags)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(memo_id) DO UPDATE SET
     title = excluded.title,
     content_text = excluded.content_text,
     tags = excluded.tags`,
).bind(memoId, title, contentText, tags);

export const deleteMemoSearchDocumentsStatement = (
  database: DatabaseAdapter,
  memoIds: string[],
): PreparedStatementAdapter => {
  const placeholders = memoIds.map(() => "?").join(", ");
  return database.prepare(
    `DELETE FROM memo_search_documents WHERE memo_id IN (${placeholders})`,
  ).bind(...memoIds);
};
