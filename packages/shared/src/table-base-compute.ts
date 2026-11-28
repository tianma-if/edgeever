import { tableBaseTableDocument, type TableBaseDocument, type TableBaseTable } from "./table-base";
import {
  tableFieldIsComputed,
  type TableCellValue, type TableDocument, type TableRecord,
} from "./table";

export type ComputedTable = {
  table: TableBaseTable;
  document: TableDocument;
  /** Stored records with createdTime / updatedTime cells filled in. */
  records: TableRecord[];
};

export type TableBaseComputation = {
  tables: Map<string, ComputedTable>;
  errors: string[];
};

const timestampCells = (document: TableDocument, record: TableRecord): Record<string, TableCellValue> => {
  const cells: Record<string, TableCellValue> = { ...record.cells };
  for (const field of document.fields) {
    if (!tableFieldIsComputed(field.type)) continue;
    cells[field.id] = field.type === "createdTime" ? record.createdAt ?? null : record.updatedAt ?? null;
  }
  return cells;
};

/**
 * Resolves the system time cells of every table in a base.
 * Stored table content is parsed fresh and never mutated; unparseable tables are skipped with an error.
 */
export const computeTableBase = (base: TableBaseDocument): TableBaseComputation => {
  const errors: string[] = [];
  const tables = new Map<string, ComputedTable>();
  for (const table of base.tables) {
    const document = tableBaseTableDocument(table);
    if (!document) {
      errors.push(`数据表「${table.name || "未命名数据表"}」内容无法解析`);
      continue;
    }
    const records = document.records.map((record) => ({ ...record, cells: timestampCells(document, record) }));
    tables.set(table.id, { table, document, records });
  }
  return { tables, errors };
};

/** Convenience wrapper for one table. */
export const computeTableRecords = (base: TableBaseDocument, tableId: string) => {
  const computation = computeTableBase(base);
  const computed = computation.tables.get(tableId);
  if (!computed) return { records: [] as TableRecord[], errors: [...computation.errors, "数据表不存在"] };
  return { records: computed.records, errors: computation.errors };
};
