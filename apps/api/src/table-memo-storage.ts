import {
  buildTableDocumentMarkdown,
  docToText,
  emptyDoc,
  markdownToDoc,
  serializeTableDocument,
  type TableDocument,
} from "@edgeever/shared";
import { AppError } from "./app-error";
import { SharedTableStore } from "./shared-table-store";
import type { DatabaseAdapter } from "./storage-contract";
import { sqliteTextFromHex } from "./table-query-sql";

export type SharedMemoReference = {
  shared_table_revision?: number | null;
  content_markdown: string;
  content_json: string;
  content_text: string;
};

export const readActiveTableStorage = (
  db: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
) =>
  db
    .prepare(
      `SELECT a.run_id, h.revision
   FROM ee_table_activation a
   LEFT JOIN ee_table_heads h ON h.workspace_id = ? AND h.table_id = ? AND h.migration_run_id = a.run_id
   WHERE a.id = 1`,
    )
    .bind(workspaceId, memoId)
    .first<{ run_id: string; revision: number | null }>();

const project = <T extends SharedMemoReference>(
  row: T,
  table: TableDocument,
): T => {
  const { markdown, fallback } = buildTableDocumentMarkdown(table);
  const contentJson = markdownToDoc(fallback);
  return {
    ...row,
    content_markdown: markdown,
    content_json: JSON.stringify(contentJson),
    content_text: docToText(contentJson),
  };
};

export const hydrateSharedMemo = async <T extends SharedMemoReference>(
  db: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
  row: T,
  history = false,
): Promise<T> => {
  if (row.shared_table_revision == null) return row;
  const table = await new SharedTableStore(db).memoSnapshot(
    workspaceId,
    memoId,
    row.shared_table_revision,
    history,
  );
  return project(row, table);
};

export const readSharedMemoMarkdown = async (
  db: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
  revision: number,
) =>
  serializeTableDocument(
    await new SharedTableStore(db).memoSnapshot(
      workspaceId,
      memoId,
      revision,
      false,
    ),
  );

export const compactSharedMemo = (table: TableDocument) => ({
  content_markdown: serializeTableDocument({ ...table, records: [] }),
  content_json: JSON.stringify(emptyDoc()),
  content_text: table.fields.map((field) => field.name).join(" "),
});

type StoredProjectionRow = {
  table_id: string;
  revision: number;
  position: number;
  header_json: string | null;
  row_count: number | null;
  record_hex: string | null;
  cells_json: string | null;
};

// Compatibility list, sync and backup requests share a read per group of memo
// references. Each selected table is read once, independent of other tables.
export const hydrateSharedMemoRows = async <
  T extends SharedMemoReference & { id: string; memo_id?: string },
>(
  db: DatabaseAdapter,
  workspaceId: string,
  rows: T[],
  history = false,
): Promise<T[]> => {
  const referenced = rows.filter((row) => row.shared_table_revision != null);
  if (!referenced.length) return rows;
  const keyOf = (id: string, revision: number | null | undefined) =>
    JSON.stringify([id, revision]);
  const keys = [
    ...new Set(
      referenced.map((row) =>
        keyOf(row.memo_id ?? row.id, row.shared_table_revision),
      ),
    ),
  ];
  const projections = new Map<
    string,
    { table: TableDocument; count: number }
  >();
  const metadata = history ? "ee_table_commits" : "ee_table_heads";
  // Seek distinct record IDs through the version primary key, then resolve
  // exactly one version for each snapshot. Scanning all versions for every
  // snapshot makes exporting a frequently edited row quadratic in history.
  const recordIds = history ? `, tables AS (SELECT DISTINCT workspace_id, table_id FROM snapshots),
    record_ids(workspace_id, table_id, record_id) AS MATERIALIZED (
      SELECT t.workspace_id, t.table_id, (
        SELECT MIN(v.record_id) FROM ee_table_versions v WHERE v.workspace_id = t.workspace_id AND v.table_id = t.table_id
      ) FROM tables t
      UNION ALL
      SELECT ids.workspace_id, ids.table_id, (
        SELECT MIN(v.record_id) FROM ee_table_versions v
        WHERE v.workspace_id = ids.workspace_id AND v.table_id = ids.table_id AND v.record_id > ids.record_id
      ) FROM record_ids ids WHERE ids.record_id IS NOT NULL
    )` : "";
  const snapshotRecords = history
    ? `snapshots s JOIN record_ids ids ON ids.workspace_id = s.workspace_id AND ids.table_id = s.table_id
       JOIN ee_table_versions r ON r.workspace_id = s.workspace_id AND r.table_id = s.table_id AND r.record_id = ids.record_id
        AND r.revision = (SELECT MAX(v.revision) FROM ee_table_versions v
          WHERE v.workspace_id = ids.workspace_id AND v.table_id = ids.table_id AND v.record_id = ids.record_id AND v.revision <= s.revision)
       WHERE r.deleted = 0`
    : `snapshots s JOIN ee_table_records r ON r.workspace_id = s.workspace_id AND r.table_id = s.table_id`;
  for (let offset = 0; offset < keys.length; offset += 10) {
    const group = keys.slice(offset, offset + 10).map((key) => JSON.parse(key));
    const { results } = await db
      .prepare(
        `WITH RECURSIVE snapshots AS MATERIALIZED (
         SELECT h.workspace_id, h.table_id, h.revision, h.header_json, h.row_count
         FROM json_each(?) wanted CROSS JOIN ${metadata} h
         ON h.workspace_id = ? AND h.table_id = json_extract(wanted.value, '$[0]')
          AND h.revision = json_extract(wanted.value, '$[1]')
       )${recordIds}
       SELECT table_id, revision, 0 AS position, header_json, row_count, NULL AS record_hex, NULL AS cells_json FROM snapshots
       UNION ALL
       SELECT s.table_id, s.revision, r.position, NULL, NULL, hex(r.record_id), r.cells_json
       FROM ${snapshotRecords}
       ORDER BY table_id, revision, position`,
      )
      .bind(JSON.stringify(group), workspaceId)
      .all<StoredProjectionRow>();
    for (const row of results) {
      const key = keyOf(row.table_id, row.revision);
      if (row.header_json !== null) {
        const table: TableDocument = {
          ...JSON.parse(row.header_json),
          cellEncoding: "nullable-v1",
          records: [],
        };
        projections.set(key, { table, count: row.row_count! });
      } else {
        projections
          .get(key)!
          .table.records.push({
            id: sqliteTextFromHex(row.record_hex!),
            cells: JSON.parse(row.cells_json!),
          });
      }
    }
  }
  return Promise.all(
    rows.map(async (row) => {
      if (row.shared_table_revision == null) return row;
      const id = row.memo_id ?? row.id;
      const found = projections.get(keyOf(id, row.shared_table_revision));
      if (!found) return hydrateSharedMemo(db, workspaceId, id, row, true);
      if (found.table.records.length !== found.count)
        throw new AppError(
          "table_history_incomplete",
          "Table snapshot record count does not match its revision",
          409,
        );
      return project(row, found.table);
    }),
  );
};
