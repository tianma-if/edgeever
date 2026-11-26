import { tableStatement, sqliteTextFromHex } from "./table-query-sql";
import {
  TableRecordQuery,
  type QueryLayout,
  type QuerySnapshot,
} from "./table-record-query";
import { AppError } from "./app-error";
import {
  jsonCell,
  sqlLiteral,
  sortExpression,
  type SharedFieldIndex,
} from "./shared-table-index";
import type { DatabaseAdapter } from "./storage-contract";
import type { TableDocument } from "../../../packages/shared/src/table";

/** A fresh instance per request keeps tenant context out of mutable shared state. */
export class SharedTableQuery extends TableRecordQuery {
  private readonly sql: ReturnType<typeof tableStatement>;
  constructor(
    db: DatabaseAdapter,
    readonly workspace: string,
  ) {
    super(db);
    this.sql = tableStatement(db);
  }
  protected async head(workspace: string, id: string) {
    const h = await this
      .sql`SELECT h.revision FROM ee_table_heads h JOIN memos m ON m.id=h.table_id AND m.workspace_id=h.workspace_id
   JOIN notebooks n ON n.id=m.notebook_id AND n.workspace_id=m.workspace_id
   WHERE h.workspace_id=${workspace} AND h.table_id=${id} AND m.is_deleted=0 AND n.is_deleted=0`.first<{
      revision: number;
    }>();
    if (!h) throw new AppError("not_found", "Table not found", 404);
    return h;
  }
  protected async snapshot(
    id: string,
    revision: number,
  ): Promise<QuerySnapshot | null> {
    return this
      .sql`SELECT h.row_count,h.max_position AS position_max,h.header_json,h.schema_revision,h.indexes_json
   FROM ee_table_heads h WHERE h.workspace_id=${this.workspace} AND h.table_id=${id} AND h.revision=${revision}`.first<QuerySnapshot>();
  }
  protected async layout(
    id: string,
    _header: TableDocument,
    snapshot: QuerySnapshot,
  ): Promise<QueryLayout> {
    const indexes = JSON.parse(
      String(snapshot.indexes_json),
    ) as SharedFieldIndex[];
    return {
      tableSql: "ee_table_records",
      selectSql: "hex(r.record_id) AS record_id,r.cells_json",
      recordId: (r) => sqliteTextFromHex(r.record_id),
      memoPredicate: `r.workspace_id=${sqlLiteral(this.workspace)} AND r.table_id=${sqlLiteral(id)}`,
      cell: (f) => jsonCell("r.cells_json", f.id),
      normalizedCell: (f) => jsonCell("r.normalized_json", f.id),
      cellsJson: (r) => r.cells_json,
      fieldIndexSql: (field, direction) =>
        indexes.find(
          (i) =>
            i.type !== "select" &&
            i.fieldId === field &&
            i.direction.toUpperCase() === direction,
        )?.name,
      // The grouped plan scopes its payload lookups by workspace/table and position.
      groupedSelectPages: true,
      indexedSort: (f, direction) => {
        const index = indexes.find(
          (i) =>
            i.fieldId === f.id &&
            i.type === "select" &&
            i.direction === direction &&
            JSON.stringify(i.options ?? []) === JSON.stringify(f.options ?? []),
        );
        if (!index) return;
        const n = f.options?.length ?? 0;
        return {
          sql: sortExpression(f, direction, "r.cells_json"),
          indexSql: index.name,
          encode: (v) => (v === null ? n : direction === "asc" ? v : n - 1 - v),
        };
      },
    };
  }
  protected override async validateSnapshot(
    workspace: string,
    id: string,
    revision: number,
  ) {
    if ((await this.head(workspace, id)).revision !== revision)
      throw new AppError("revision_conflict", "Refresh the changed table", 409);
  }
}
