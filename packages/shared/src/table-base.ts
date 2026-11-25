import { Base64 } from "js-base64";
import {
  createDefaultTableDocument,
  parseTableDocument,
  serializeTableDocument,
  tableFallbackMarkdown,
  type TableDocument,
} from "./table";

/**
 * A Base document stores any number of tables inside one memo. Each table keeps
 * its complete v1/v2/v3 table marker in `content`, so field/record/view parsing
 * and validation always go through the existing single-table model.
 */
export const TABLE_BASE_SCHEMA_VERSION = 4 as const;
export const TABLE_BASE_MARKER_PREFIX = "edgeever-base-v1:";
export const TABLE_BASE_TABLE_LIMIT = 20;

export type TableBaseTable = {
  id: string;
  name: string;
  /** Table content is the serialized table marker markdown, not a plain table. */
  content: string;
};
export type TableBaseDocument = {
  schemaVersion: typeof TABLE_BASE_SCHEMA_VERSION;
  tables: TableBaseTable[];
  activeTableId: string;
};

const BASE64URL_CHARS = /^[A-Za-z0-9_-]+$/;
const TABLE_BASE_COMMENT = new RegExp(
  `<!--\\s*${TABLE_BASE_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s\\S]*?)\\s*-->`,
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const createTableBaseTableId = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const suffix = uuid ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `tbl_${suffix}`;
};

const defaultTableBaseName = (number: number) => `数据表 ${number}`;

/** Fallback names are stable per position and never collide with explicit ones. */
const nextDefaultTableBaseName = (index: number, used: Set<string>) => {
  let number = index + 1;
  while (used.has(defaultTableBaseName(number))) number += 1;
  return defaultTableBaseName(number);
};

const cleanTableBaseName = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeTableBaseNames = (values: unknown[]): string[] => {
  const names = values.map(cleanTableBaseName);
  const used = new Set(names.filter(Boolean));
  return names.map((name, index) => {
    if (name) return name;
    const fallback = nextDefaultTableBaseName(index, used);
    used.add(fallback);
    return fallback;
  });
};

const normalizeTableBaseIds = (values: unknown[]): string[] => {
  const used = new Set<string>();
  return values.map((value) => {
    const candidate = typeof value === "string" ? value.trim() : "";
    if (candidate && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    let id = createTableBaseTableId();
    while (used.has(id)) id = createTableBaseTableId();
    used.add(id);
    return id;
  });
};

const decodeTableBaseMarker = (markdown: string | null | undefined): string | null => {
  const raw = markdown?.match(TABLE_BASE_COMMENT)?.[1];
  if (!raw) return null;
  let encoded = raw;
  if (!BASE64URL_CHARS.test(raw)) {
    encoded = raw.replace(/\s+/g, "");
    if (!BASE64URL_CHARS.test(encoded)) return null;
  }
  try {
    return Base64.decode(encoded);
  } catch {
    return null;
  }
};

export const hasTableBaseDocumentMarker = (markdown: string | null | undefined): boolean =>
  Boolean(markdown?.match(TABLE_BASE_COMMENT));

export const createTableBaseDocument = (options: {
  name?: string;
  tables?: Array<{ id?: string; name: string; document: TableDocument }>;
} = {}): TableBaseDocument => {
  const seeds = (options.tables ?? []).slice(0, TABLE_BASE_TABLE_LIMIT);
  if (!seeds.length) {
    const id = createTableBaseTableId();
    return {
      schemaVersion: TABLE_BASE_SCHEMA_VERSION,
      tables: [{
        id,
        name: cleanTableBaseName(options.name) || defaultTableBaseName(1),
        content: serializeTableDocument(createDefaultTableDocument()),
      }],
      activeTableId: id,
    };
  }
  const ids = normalizeTableBaseIds(seeds.map((seed) => seed.id));
  const names = normalizeTableBaseNames(seeds.map((seed) => seed.name));
  const tables = seeds.map((seed, index) => ({
    id: ids[index]!,
    name: names[index]!,
    content: serializeTableDocument(seed.document),
  }));
  return {
    schemaVersion: TABLE_BASE_SCHEMA_VERSION,
    tables,
    activeTableId: tables[0]!.id,
  };
};

export const tableBaseTableDocument = (table: TableBaseTable): TableDocument | null =>
  parseTableDocument(table.content);

export const tableBaseFallbackMarkdown = (base: TableBaseDocument): string =>
  base.tables.map((table) => {
    const document = tableBaseTableDocument(table);
    const name = table.name.replace(/\s+/g, " ").trim() || "未命名数据表";
    return `## ${name}\n\n${document ? tableFallbackMarkdown(document) : "> 该数据表暂时无法解析"}`;
  }).join("\n\n");

export const serializeTableBaseDocument = (base: TableBaseDocument): string =>
  `<!-- ${TABLE_BASE_MARKER_PREFIX}${Base64.encodeURI(JSON.stringify(base))} -->\n\n${tableBaseFallbackMarkdown(base)}`;

export const parseTableBaseDocument = (markdown: string | null | undefined): TableBaseDocument | null => {
  const json = decodeTableBaseMarker(markdown);
  if (json === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.schemaVersion !== TABLE_BASE_SCHEMA_VERSION || !Array.isArray(value.tables)) return null;
  const entries = value.tables.slice(0, TABLE_BASE_TABLE_LIMIT).filter(isRecord);
  if (!entries.length) return null;
  const ids = normalizeTableBaseIds(entries.map((entry) => entry.id));
  const names = normalizeTableBaseNames(entries.map((entry) => entry.name));
  const tables: TableBaseTable[] = entries.map((entry, index) => ({
    id: ids[index]!,
    name: names[index]!,
    content: typeof entry.content === "string" ? entry.content : "",
  }));
  const requestedActive = typeof value.activeTableId === "string" ? value.activeTableId.trim() : "";
  const activeTableId = tables.some((table) => table.id === requestedActive) ? requestedActive : tables[0]!.id;
  return {
    schemaVersion: TABLE_BASE_SCHEMA_VERSION,
    tables,
    activeTableId,
  };
};

/** Appends an empty table without changing the active selection. */
export const addTableToBase = (base: TableBaseDocument, name?: string): TableBaseDocument => {
  if (base.tables.length >= TABLE_BASE_TABLE_LIMIT) throw new Error("table base table limit reached");
  const usedIds = new Set(base.tables.map((table) => table.id));
  const usedNames = new Set(base.tables.map((table) => table.name));
  let id = createTableBaseTableId();
  while (usedIds.has(id)) id = createTableBaseTableId();
  const table: TableBaseTable = {
    id,
    name: cleanTableBaseName(name) || nextDefaultTableBaseName(base.tables.length, usedNames),
    content: serializeTableDocument(createDefaultTableDocument()),
  };
  return {
    ...base,
    tables: [...base.tables, table],
    activeTableId: base.tables.length ? base.activeTableId : table.id,
  };
};

/** Renames an existing table. An unknown table id or blank name is a no-op. */
export const renameTableInBase = (base: TableBaseDocument, tableId: string, name: string): TableBaseDocument => {
  const index = base.tables.findIndex((table) => table.id === tableId);
  if (index < 0) return base;
  const nextName = cleanTableBaseName(name);
  if (!nextName) return base;
  if (base.tables.some((table) => table.id !== tableId && table.name === nextName)) {
    throw new Error("duplicate table name");
  }
  if (base.tables[index]!.name === nextName) return base;
  const tables = base.tables.map((table, current) => (current === index ? { ...table, name: nextName } : table));
  return { ...base, tables };
};

/** Removes a table; removing the active table activates the first remaining one. */
export const removeTableFromBase = (base: TableBaseDocument, tableId: string): TableBaseDocument => {
  const index = base.tables.findIndex((table) => table.id === tableId);
  if (index < 0) return base;
  if (base.tables.length <= 1) throw new Error("cannot remove the last table");
  const tables = base.tables.filter((_, current) => current !== index);
  const activeTableId = tables.some((table) => table.id === base.activeTableId) ? base.activeTableId : tables[0]!.id;
  return { ...base, tables, activeTableId };
};

/** Serializes a table document back into the table's stored marker content. */
export const updateTableBaseTable = (
  base: TableBaseDocument,
  tableId: string,
  document: TableDocument,
): TableBaseDocument => {
  const index = base.tables.findIndex((table) => table.id === tableId);
  if (index < 0) return base;
  const content = serializeTableDocument(document);
  const tables = base.tables.map((table, current) => (current === index ? { ...table, content } : table));
  return { ...base, tables };
};

/** Switches the active table. An unknown table id is a no-op. */
export const setActiveTableInBase = (base: TableBaseDocument, tableId: string): TableBaseDocument =>
  base.tables.some((table) => table.id === tableId) ? { ...base, activeTableId: tableId } : base;