import {
  coerceTableCell,
  createTableId,
  FIELD_NAME_LIMIT,
  TABLE_RECORD_LIMIT,
  tableFieldIsComputed,
  type TableCellValue,
  type TableDocument,
  type TableField,
  type TableRecord,
} from "./table";
import { validateTableCells } from "./table-operations";

export const TABLE_CSV_IMPORT_CHARACTER_LIMIT = 10_000_000;

const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell === "") {
      quoted = true;
      continue;
    }
    if (character === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted cell");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  while (rows.length && rows.at(-1)!.every((value) => value.trim() === "")) rows.pop();
  return rows;
};

const csvCellValue = (field: TableField, text: string): TableCellValue => {
  if (field.type === "checkbox") {
    const value = text.trim().toLocaleLowerCase();
    if (["true", "1", "yes", "y", "是", "已选"].includes(value)) return true;
    if (["", "false", "0", "no", "n", "否", "未选"].includes(value)) return false;
    throw new Error(`${field.name}: invalid checkbox value`);
  }
  if (field.type === "number") {
    if (!text.trim()) return null;
    const value = Number(text.trim());
    if (!Number.isFinite(value)) throw new Error(`${field.name}: invalid number`);
    return value;
  }
  if (field.type === "select" || field.type === "multiSelect") {
    const tokens = field.type === "select" ? (text.trim() ? [text.trim()] : []) : text.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
    const unknown = tokens.find((token) => !(field.options ?? []).includes(token.slice(0, FIELD_NAME_LIMIT)));
    if (unknown) throw new Error(`${field.name}: unknown option "${unknown}"`);
  }
  return coerceTableCell(field, text);
};

export type TableCsvImportResult = {
  document: TableDocument;
  imported: number;
  skippedColumns: string[];
};

/** Append rows by matching CSV headers to field names; read-only and attachment columns are ignored. */
export const appendTableRecordsFromCsv = async (
  document: TableDocument,
  text: string,
): Promise<TableCsvImportResult> => {
  if (!text.trim()) throw new Error("CSV is empty");
  if (text.length > TABLE_CSV_IMPORT_CHARACTER_LIMIT) throw new Error("CSV is too large");
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one record");
  const [headers, ...dataRows] = rows;
  if (!headers) throw new Error("CSV is empty");
  if (document.records.length + dataRows.length > TABLE_RECORD_LIMIT) {
    throw new Error(`CSV exceeds the ${TABLE_RECORD_LIMIT}-record table limit`);
  }
  const fieldNames = new Map<string, TableField>();
  for (const field of document.fields) {
    const name = field.name.trim();
    if (fieldNames.has(name)) throw new Error(`Duplicate table field name: ${name}`);
    fieldNames.set(name, field);
  }
  const mapped: Array<{ index: number; field: TableField }> = [];
  const seenFields = new Set<string>();
  const skippedColumns: string[] = [];
  headers.forEach((header, index) => {
    const name = header.trim();
    if (!name) return;
    const field = fieldNames.get(name);
    if (!field) throw new Error(`Unknown CSV column: ${name}`);
    // Read-only columns (attachments, auto numbers, computed fields) are never written from CSV.
    if (field.type === "attachment" || field.type === "autoNumber" || tableFieldIsComputed(field.type)) {
      skippedColumns.push(name);
      return;
    }
    if (seenFields.has(field.id)) throw new Error(`Duplicate CSV column: ${name}`);
    seenFields.add(field.id);
    mapped.push({ index, field });
  });
  if (!mapped.length) throw new Error("CSV has no editable table columns");
  const records: TableRecord[] = [];
  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
    const row = dataRows[rowIndex]!;
    if (row.length > headers.length) throw new Error(`CSV row ${rowIndex + 2} has too many cells`);
    const cells: Record<string, TableCellValue> = {};
    for (const field of document.fields) {
      if (field.type !== "autoNumber" && !tableFieldIsComputed(field.type)) cells[field.id] = coerceTableCell(field, null);
    }
    for (const { index, field } of mapped) {
      try {
        cells[field.id] = csvCellValue(field, row[index] ?? "");
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid value";
        throw new Error(`CSV row ${rowIndex + 2}: ${message}`);
      }
    }
    try {
      await validateTableCells(async () => null, document, cells, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid value";
      throw new Error(`CSV row ${rowIndex + 2}: ${message}`);
    }
    records.push({ id: createTableId("rec"), cells });
  }
  return { document: { ...document, records: [...document.records, ...records] }, imported: records.length, skippedColumns };
};
