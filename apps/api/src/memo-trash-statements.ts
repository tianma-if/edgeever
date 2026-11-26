import type { DatabaseAdapter } from "./storage-contract";

// Resolve the same live targets for each statement. Mark the memos deleted
// last so selectors based on is_deleted also work inside a larger batch.
export const softDeleteMemoStatements = (
  db: DatabaseAdapter,
  workspaceId: string,
  now: string,
  memoIdsSql: string,
  memoIdsBindings: string[],
) => [
  db.prepare(
    `DELETE FROM memo_shares INDEXED BY sqlite_autoindex_memo_shares_2
     WHERE memo_id IN (${memoIdsSql}) AND workspace_id = ?`
  )
    .bind(...memoIdsBindings, workspaceId),
  db.prepare(
    `UPDATE resources SET is_deleted = 1, deleted_at = ?, updated_at = ?
     WHERE memo_id IN (${memoIdsSql}) AND is_deleted = 0`
  ).bind(now, now, ...memoIdsBindings),
  db.prepare(`DELETE FROM memo_search_documents WHERE memo_id IN (${memoIdsSql})`)
    .bind(...memoIdsBindings),
  db.prepare(
    `UPDATE memos INDEXED BY sqlite_autoindex_memos_1 SET is_deleted = 1, deleted_at = ?, updated_at = ?
     WHERE id IN (${memoIdsSql}) AND workspace_id = ? AND is_deleted = 0`
  ).bind(now, now, ...memoIdsBindings, workspaceId),
];
