import { BACKUP_TABLE_ROW_BATCH, type BackupTablePage, type BackupTableRow, type TableDocument } from "@edgeever/shared";
import { AppError } from "./app-error";
import type { DatabaseAdapter } from "./storage-contract";
import { sqliteTextFromHex } from "./table-query-sql";

export async function readBackupTablePage(
  db: DatabaseAdapter, workspaceId: string, memoId: string, revisionId: string | undefined, after: string,
): Promise<BackupTablePage | null> {
  const header = await db.prepare(revisionId === undefined
    ? `SELECT h.revision, h.header_json, h.row_count FROM memos m
       JOIN memo_contents_for_read c ON c.memo_id = m.id
       JOIN ee_table_heads h ON h.workspace_id = m.workspace_id AND h.table_id = m.id AND h.revision = c.shared_table_revision
       WHERE m.workspace_id = ? AND m.id = ? AND m.is_deleted = 0`
    : `SELECT h.revision, h.header_json, h.row_count FROM memos m
       JOIN memo_revisions r ON r.memo_id = m.id
       JOIN ee_table_commits h ON h.workspace_id = m.workspace_id AND h.table_id = m.id AND h.revision = r.shared_table_revision
       WHERE m.workspace_id = ? AND m.id = ? AND m.is_deleted = 0 AND r.id = ?`,
  ).bind(workspaceId, memoId, ...(revisionId === undefined ? [] : [revisionId])).first<{
    revision: number; header_json: string; row_count: number;
  }>();
  if (!header) return null;
  let rows: BackupTableRow[];
  let nextCursor: string | null;
  if (revisionId === undefined) {
    const position = after === "" ? 0 : Number(after);
    if (!/^\d*$/.test(after) || !Number.isSafeInteger(position)) throw new AppError("bad_request", "Invalid backup record cursor", 400);
    const page = (await db.prepare(`SELECT hex(record_id) AS id, position, cells_json FROM ee_table_records
      WHERE workspace_id = ? AND table_id = ? AND position > ? ORDER BY position LIMIT ?`,
    ).bind(workspaceId, memoId, position, BACKUP_TABLE_ROW_BATCH + 1).all<{ id: string; position: number; cells_json: string }>()).results;
    rows = page.slice(0, BACKUP_TABLE_ROW_BATCH).map((row) => ({ id: sqliteTextFromHex(row.id), position: row.position, cells: JSON.parse(row.cells_json) }));
    nextCursor = page.length > BACKUP_TABLE_ROW_BATCH ? String(rows.at(-1)!.position) : null;
  } else {
    // Seek distinct IDs in the primary key even if an ID has many past versions.
    // Determine the cursor from enumerated IDs, including subsequent tombstones.
    if (!/^(?:[0-9A-F]{2})*$/.test(after)) throw new AppError("bad_request", "Invalid backup record cursor", 400);
    const page = (await db.prepare(`WITH RECURSIVE ids(record_id, step) AS (
      SELECT (SELECT MIN(record_id) FROM ee_table_versions WHERE workspace_id = ?1 AND table_id = ?2 AND record_id > CAST(unhex(?3) AS TEXT)), 1
      UNION ALL
      SELECT (SELECT MIN(v.record_id) FROM ee_table_versions v WHERE v.workspace_id = ?1 AND v.table_id = ?2 AND v.record_id > ids.record_id), step + 1
      FROM ids WHERE record_id IS NOT NULL AND step < ?4
    )
    SELECT hex(ids.record_id) AS id, r.position, r.cells_json, r.deleted FROM ids
    LEFT JOIN ee_table_versions r ON r.workspace_id = ?1 AND r.table_id = ?2 AND r.record_id = ids.record_id
      AND r.revision = (SELECT MAX(v.revision) FROM ee_table_versions v WHERE v.workspace_id = ?1 AND v.table_id = ?2
        AND v.record_id = ids.record_id AND v.revision <= ?5)
    WHERE ids.record_id IS NOT NULL ORDER BY ids.step`,
    ).bind(workspaceId, memoId, after, BACKUP_TABLE_ROW_BATCH + 1, header.revision).all<{
      id: string; position: number; cells_json: string; deleted: number | null;
    }>()).results;
    const delivered = page.slice(0, BACKUP_TABLE_ROW_BATCH);
    rows = delivered.filter((row) => row.deleted === 0).map((row) => ({ id: sqliteTextFromHex(row.id), position: row.position, cells: JSON.parse(row.cells_json) }));
    nextCursor = page.length > BACKUP_TABLE_ROW_BATCH ? delivered.at(-1)!.id : null;
  }
  return { header: { ...JSON.parse(header.header_json) as TableDocument, cellEncoding: "nullable-v1" }, rowCount: header.row_count, rows, nextCursor };
}
