import { BACKUP_TABLE_ROW_BATCH, type BackupTableChangesPage, type BackupTablePage, type BackupTableRow, type TableDocument } from "@edgeever/shared";
import { AppError } from "./app-error";
import type { DatabaseAdapter } from "./storage-contract";
import { sqliteTextFromHex } from "./table-query-sql";

type StoredRow = { id: string; position: number; cells_json: string };
const backupRow = (row: StoredRow): BackupTableRow => ({
  id: sqliteTextFromHex(row.id), position: row.position, cells: JSON.parse(row.cells_json),
});

export async function readBackupTableChanges(
  db: DatabaseAdapter, workspaceId: string, memoId: string, revisionId: string, after: string,
): Promise<BackupTableChangesPage> {
  const cursor = /^(\d+)\.((?:[0-9A-F]{2})*)$/.exec(after || "0.");
  if (!cursor || !Number.isSafeInteger(Number(cursor[1]))) throw new AppError("bad_request", "Invalid backup history cursor", 400);
  const batch = 256;
  // Concatenation decodes the ID as SQLite text. CAST here prevents seeking on both index columns.
  const { results } = await db.prepare(`SELECT v.revision, hex(v.record_id) AS id, v.position, v.deleted
    FROM ee_table_versions v WHERE v.workspace_id = ?1 AND v.table_id = ?2
      AND (v.revision, v.record_id) > (?3, unhex(?4) || '')
      AND v.revision <= (SELECT r.shared_table_revision FROM memo_revisions r JOIN memos m ON m.id = r.memo_id
        WHERE r.id = ?5 AND m.id = ?2 AND m.workspace_id = ?1 AND m.is_deleted = 0)
    ORDER BY v.revision, v.record_id LIMIT ?6`)
    .bind(workspaceId, memoId, Number(cursor[1]), cursor[2], revisionId, batch + 1)
    .all<{ revision: number; id: string; position: number; deleted: number }>();
  const page = results.slice(0, batch);
  const last = page.at(-1);
  return {
    changes: page.map(row => ({ ...row, id: sqliteTextFromHex(row.id), deleted: row.deleted === 1 })),
    nextCursor: results.length > batch && last ? `${last.revision}.${last.id}` : null,
  };
}

export async function readBackupTablePage(
  db: DatabaseAdapter, workspaceId: string, memoId: string, revisionId: string | undefined, after: string, versions?: string,
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
    ).bind(workspaceId, memoId, position, BACKUP_TABLE_ROW_BATCH + 1).all<StoredRow>()).results;
    rows = page.slice(0, BACKUP_TABLE_ROW_BATCH).map(backupRow);
    nextCursor = page.length > BACKUP_TABLE_ROW_BATCH ? String(rows.at(-1)!.position) : null;
  } else if (versions !== undefined) {
    let keys: unknown;
    try { keys = JSON.parse(versions); } catch { /* Invalid batches are rejected below. */ }
    if (!Array.isArray(keys) || keys.length > BACKUP_TABLE_ROW_BATCH || keys.some(key =>
      !Array.isArray(key) || key.length !== 2 || !key.every(n => Number.isSafeInteger(n) && n > 0))) {
      throw new AppError("bad_request", "Invalid backup row versions", 400);
    }
    // Each live position identifies one row within a commit. Reject versions superseded at the requested snapshot.
    const page = await db.prepare(`SELECT hex(v.record_id) AS id, v.position, v.cells_json
      FROM json_each(?3) k CROSS JOIN ee_table_versions v
      WHERE v.workspace_id = ?1 AND v.table_id = ?2
        AND v.position = json_extract(k.value, '$[1]') AND v.revision = json_extract(k.value, '$[0]')
        AND v.deleted = 0 AND v.revision <= ?4 AND NOT EXISTS (
          SELECT 1 FROM ee_table_versions newer WHERE newer.workspace_id = ?1 AND newer.table_id = ?2
            AND newer.record_id = v.record_id AND newer.revision > v.revision AND newer.revision <= ?4)
      ORDER BY k.key`).bind(workspaceId, memoId, versions, header.revision)
      .all<StoredRow>();
    rows = page.results.map(backupRow);
    nextCursor = null;
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
    rows = delivered.filter((row) => row.deleted === 0).map(backupRow);
    nextCursor = page.length > BACKUP_TABLE_ROW_BATCH ? delivered.at(-1)!.id : null;
  }
  return { header: { ...JSON.parse(header.header_json) as TableDocument, cellEncoding: "nullable-v1" }, rowCount: header.row_count, rows, nextCursor };
}
