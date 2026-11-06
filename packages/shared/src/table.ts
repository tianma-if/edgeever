import { Base64 } from "js-base64";
import {
  DEFAULT_TABLE_VIEW_ID, TABLE_VIEW_SCHEMA_VERSION, TABLE_VIEW_FILTER_LIMIT,
  isValidTypedTableFilter, matchesTypedTableFilter, tableViewWeek, tableFilterNeedsValue,
  type NamedTableView, type TableViewFilter, type TableViewOperator, type TableViewSort, type TypedTableFilter,
} from "./table-view";

export * from "./table-view";

export const TABLE_SCHEMA_VERSION = 1 as const;
export const TABLE_FIELD_LIMIT = 40;
export const TABLE_RECORD_LIMIT = 2000;
export const TABLE_FIELD_TYPES = ["text", "number", "checkbox", "date", "select", "url", "attachment"] as const;
export const TABLE_FILTER_OPERATORS = ["contains", "eq", "empty", "notEmpty"] as const;
export const TABLE_ATTACHMENT_LIMIT = 10;
export const TABLE_ATTACHMENT_FILTER_OPERATORS = ["empty", "notEmpty"] as const;

export type TableFieldType = (typeof TABLE_FIELD_TYPES)[number];
export type TableFilterOperator = (typeof TABLE_FILTER_OPERATORS)[number];
export type TableAttachment = {
  resourceId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
};
export type TableCellValue = string | number | boolean | null | TableAttachment[];

export type TableField = {
  id: string;
  name: string;
  type: TableFieldType;
  options?: string[];
};

export type TableRecord = {
  id: string;
  cells: Record<string, TableCellValue>;
};

export type TableFilter = {
  fieldId: string;
  operator: TableFilterOperator;
  value?: string;
};

export type TableSort = {
  fieldId: string;
  direction: "asc" | "desc";
};

export type TableView = {
  filters: TableFilter[];
  sort: TableSort | null;
};

type TableData = { fields: TableField[]; records: TableRecord[] };
export type LegacyTableDocument = TableData & { schemaVersion: typeof TABLE_SCHEMA_VERSION; view: TableView };
export type NamedViewTableDocument = TableData & { schemaVersion: typeof TABLE_VIEW_SCHEMA_VERSION; views: NamedTableView[] };
export type TableDocument = LegacyTableDocument | NamedViewTableDocument;

export type TableSeedLabels = {
  name?: string;
  status?: string;
  date?: string;
  sample?: string;
  notStarted?: string;
  inProgress?: string;
  done?: string;
};

export type TableSummaryPreview = {
  fieldCount: number;
  recordCount: number;
  fieldNames: string[];
};

const TABLE_MARKER = "edgeever-table-v1";
const TABLE_COMMENT = new RegExp(`<!--\\s*${TABLE_MARKER}:([\\s\\S]*?)\\s*-->`);
const FIELD_NAME_LIMIT = 80;
const OPTION_LIMIT = 40;
const CELL_TEXT_LIMIT = 2000;
const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const ATTACHMENT_BYTE_LIMIT = 1024 * 1024 * 1024;

const encodeBase64Url = (value: string) => Base64.encodeURI(value);
const decodeBase64Url = (value: string) => Base64.decode(value);

export const createTableId = (prefix: "fld" | "rec" | "view") => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const suffix = uuid ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${suffix}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const cleanName = (value: unknown, fallback: string) => {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (name || fallback).slice(0, FIELD_NAME_LIMIT);
};

const cleanOptions = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  const options: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const option = item.replace(/\s+/g, " ").trim().slice(0, FIELD_NAME_LIMIT);
    if (!option || options.includes(option)) continue;
    options.push(option);
    if (options.length >= OPTION_LIMIT) break;
  }
  return options;
};

const cleanAttachment = (value: unknown): TableAttachment | null => {
  if (!isRecord(value) || typeof value.resourceId !== "string" || !ATTACHMENT_ID_PATTERN.test(value.resourceId)) return null;
  const filename = cleanName(value.filename, "attachment");
  const mimeType = typeof value.mimeType === "string" ? value.mimeType.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const byteSize = typeof value.byteSize === "number" ? value.byteSize : Number(value.byteSize);
  if (!Number.isFinite(byteSize) || byteSize < 0) return null;
  return {
    resourceId: value.resourceId,
    filename,
    mimeType,
    byteSize: Math.min(Math.floor(byteSize), ATTACHMENT_BYTE_LIMIT),
  };
};

export const tableAttachmentUrl = (resourceId: string) =>
  `/api/v1/resources/${encodeURIComponent(resourceId)}/blob`;

export const coerceTableCell = (field: TableField, value: unknown): TableCellValue => {
  if (field.type === "attachment") {
    const items = Array.isArray(value) ? value : [];
    const attachments: TableAttachment[] = [];
    for (const item of items) {
      const attachment = cleanAttachment(item);
      if (!attachment || attachments.some((current) => current.resourceId === attachment.resourceId)) continue;
      attachments.push(attachment);
      if (attachments.length >= TABLE_ATTACHMENT_LIMIT) break;
    }
    return attachments;
  }
  if (field.type === "checkbox") {
    return value === true || value === "true" || value === 1 || value === "1";
  }
  if (field.type === "number") {
    if (value === null || value === undefined || value === "") return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cleanAttachment(item)?.filename ?? "").filter(Boolean).join(", ").slice(0, CELL_TEXT_LIMIT);
  }
  if (value === null || value === undefined) return "";
  return String(value).slice(0, CELL_TEXT_LIMIT);
};

const emptyCell = (field: TableField): TableCellValue => coerceTableCell(field, field.type === "checkbox" ? false : null);

export const listTableAttachmentResourceIds = (document: TableDocument | null | undefined) => {
  const ids = new Set<string>();
  if (!document) return ids;
  for (const record of document.records) {
    for (const field of document.fields) {
      if (field.type !== "attachment") continue;
      const value = record.cells[field.id];
      if (!Array.isArray(value)) continue;
      for (const attachment of value) ids.add(attachment.resourceId);
    }
  }
  return ids;
};

const parseField = (value: unknown): TableField | null => {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || value.id.length > 80) return null;
  if (!TABLE_FIELD_TYPES.includes(value.type as TableFieldType)) return null;
  const type = value.type as TableFieldType;
  const field: TableField = { id: value.id, name: cleanName(value.name, "字段"), type };
  if (type === "select") field.options = cleanOptions(value.options);
  return field;
};

const parseView = (value: unknown, fieldIds: Set<string>): TableView => {
  if (!isRecord(value)) return { filters: [], sort: null };
  const filters: TableFilter[] = [];
  if (Array.isArray(value.filters)) {
    for (const item of value.filters) {
      if (!isRecord(item) || typeof item.fieldId !== "string" || !fieldIds.has(item.fieldId)) continue;
      if (!TABLE_FILTER_OPERATORS.includes(item.operator as TableFilterOperator)) continue;
      const filter: TableFilter = { fieldId: item.fieldId, operator: item.operator as TableFilterOperator };
      if (typeof item.value === "string") filter.value = item.value.slice(0, CELL_TEXT_LIMIT);
      filters.push(filter);
      if (filters.length >= TABLE_VIEW_FILTER_LIMIT) break;
    }
  }
  const sort = isRecord(value.sort)
    && typeof value.sort.fieldId === "string"
    && fieldIds.has(value.sort.fieldId)
    && (value.sort.direction === "asc" || value.sort.direction === "desc")
    ? { fieldId: value.sort.fieldId, direction: value.sort.direction as "asc" | "desc" }
    : null;
  return { filters, sort };
};

const parseNamedTableViews = (value: unknown, fields: TableField[]): NamedTableView[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const byId = new Map(fields.map((field) => [field.id, field]));
  const fieldIds = new Set(byId.keys());
  const viewIds = new Set<string>();
  const views: NamedTableView[] = [];
  for (const view of value) {
    if (!isRecord(view) || typeof view.id !== "string" || !view.id || viewIds.has(view.id)
      || typeof view.name !== "string" || (!view.name.trim() && view.id !== DEFAULT_TABLE_VIEW_ID)
      || (view.match !== "all" && view.match !== "any") || !Array.isArray(view.filters)
      || view.filters.length > TABLE_VIEW_FILTER_LIMIT || !Array.isArray(view.sorts)) return null;
    viewIds.add(view.id);
    const filters: TableViewFilter[] = [];
    for (const rule of view.filters) {
      if (!isRecord(rule) || typeof rule.fieldId !== "string" || typeof rule.operator !== "string") return null;
      const field = byId.get(rule.fieldId);
      if (!field) return null;
      if (rule.legacy === true) {
        const [filter] = parseView({ filters: [rule] }, fieldIds).filters;
        if (!filter) return null;
        filters.push({ ...filter, legacy: true });
      } else {
        const operator = rule.operator as TableViewOperator;
        const value = typeof rule.value === "string" ? rule.value.slice(0, CELL_TEXT_LIMIT)
          : typeof rule.value === "number" || typeof rule.value === "boolean" ? rule.value : undefined;
        const filter: TypedTableFilter = { fieldId: field.id, operator,
          ...(tableFilterNeedsValue(operator) && value !== undefined ? { value } : {}),
          ...(operator === "between" && typeof rule.endValue === "string" ? { endValue: rule.endValue } : {}),
        };
        if (!isValidTypedTableFilter(field, filter)) return null;
        filters.push(filter);
      }
    }
    const sorts: TableViewSort[] = [];
    const seenSorts = new Set<string>();
    for (const rule of view.sorts) {
      if (!isRecord(rule) || typeof rule.fieldId !== "string" || !byId.has(rule.fieldId)
        || seenSorts.has(rule.fieldId) || (rule.direction !== "asc" && rule.direction !== "desc")) return null;
      seenSorts.add(rule.fieldId);
      sorts.push({ fieldId: rule.fieldId, direction: rule.direction, ...(rule.legacy === true ? { legacy: true } : {}) });
    }
    views.push({ id: view.id, name: view.name.trim(), match: view.match, filters, sorts });
  }
  return views;
};

export const getTableViews = (document: TableDocument): NamedTableView[] => document.schemaVersion === TABLE_VIEW_SCHEMA_VERSION
  ? document.views
  : [{
    id: DEFAULT_TABLE_VIEW_ID,
    name: "",
    match: "all",
    filters: document.view.filters.map((filter) => ({ ...filter, legacy: true })),
    sorts: document.view.sort ? [{ ...document.view.sort, legacy: true }] : [],
  }];

const legacyViewProjection = (view: NamedTableView, fields: TableField[]): TableView | null => {
  if (view.match !== "all" || view.sorts.length > 1) return null;
  const filters: TableFilter[] = [];
  for (const { fieldId, operator, value } of view.filters) {
    if (operator !== "contains" && operator !== "eq" && operator !== "empty" && operator !== "notEmpty") return null;
    filters.push({ fieldId, operator, ...(value === undefined ? {} : { value: String(value) }) });
  }
  const [sort] = view.sorts;
  if (sort && !sort.legacy && fields.find((field) => field.id === sort.fieldId)?.type === "select") return null;
  return { filters, sort: sort ? { fieldId: sort.fieldId, direction: sort.direction } : null };
};

/** Record consumers using the v1 API see source rows and only a representable default view. */
export const projectLegacyTableDocument = (document: TableDocument): LegacyTableDocument => {
  if (document.schemaVersion === TABLE_SCHEMA_VERSION) return document;
  return {
    schemaVersion: TABLE_SCHEMA_VERSION, fields: document.fields, records: document.records,
    view: legacyViewProjection(document.views[0]!, document.fields) ?? { filters: [], sort: null },
  };
};

export const saveTableViews = (document: TableDocument, views: NamedTableView[]): TableDocument => {
  const validated = parseNamedTableViews(views, document.fields);
  if (!validated) throw new Error("Invalid table views");
  const first = validated[0]!;
  if (document.schemaVersion === TABLE_SCHEMA_VERSION && validated.length === 1 && first.id === DEFAULT_TABLE_VIEW_ID && !first.name) {
    const view = legacyViewProjection(first, document.fields);
    if (view) return { ...document, view };
  }
  return { schemaVersion: TABLE_VIEW_SCHEMA_VERSION, fields: document.fields, records: document.records, views: validated };
};

export const parseTableDocument = (markdown: string | null | undefined): TableDocument | null => {
  const encoded = markdown?.match(TABLE_COMMENT)?.[1]?.replace(/\s+/g, "");
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const value = JSON.parse(decodeBase64Url(encoded)) as Record<string, unknown>;
    if ((value.schemaVersion !== TABLE_SCHEMA_VERSION && value.schemaVersion !== TABLE_VIEW_SCHEMA_VERSION)
      || !Array.isArray(value.fields) || value.fields.length < 1) return null;
    const fields: TableField[] = [];
    for (const item of value.fields) {
      const field = parseField(item);
      if (!field || fields.some((current) => current.id === field.id)) return null;
      fields.push(field);
    }
    if (!Array.isArray(value.records)) return null;
    const fieldIds = new Set(fields.map((field) => field.id));
    const records: TableRecord[] = [];
    const recordIds = new Set<string>();
    for (const item of value.records) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id || item.id.length > 80 || recordIds.has(item.id)) return null;
      recordIds.add(item.id);
      const rawCells = isRecord(item.cells) ? item.cells : {};
      const cells: Record<string, TableCellValue> = {};
      for (const field of fields) cells[field.id] = coerceTableCell(field, rawCells[field.id]);
      records.push({ id: item.id, cells });
    }
    if (value.schemaVersion === TABLE_SCHEMA_VERSION) {
      return { schemaVersion: TABLE_SCHEMA_VERSION, fields, records, view: parseView(value.view, fieldIds) };
    }
    const views = parseNamedTableViews(value.views, fields);
    return views ? { schemaVersion: TABLE_VIEW_SCHEMA_VERSION, fields, records, views } : null;
  } catch {
    return null;
  }
};

export const hasTableDocumentMarker = (markdown: string | null | undefined) =>
  Boolean(markdown?.match(TABLE_COMMENT));

export const stripTableDocumentMarker = (markdown: string | null | undefined) =>
  (markdown ?? "").replace(TABLE_COMMENT, "").trimEnd();

const markdownLabel = (value: string) => value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

const attachmentNames = (value: TableCellValue) =>
  Array.isArray(value) ? value.map((item) => item.filename).filter(Boolean) : [];

const markdownCell = (field: TableField, value: TableCellValue) => {
  if (field.type === "attachment" && Array.isArray(value)) {
    return value.map((item) => `[${markdownLabel(item.filename)}](${tableAttachmentUrl(item.resourceId)})`).join(" ");
  }
  if (value === null || value === undefined || value === "") return "";
  const text = field.type === "checkbox" ? (value === true ? "true" : "false") : String(value);
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
};

export const tableFallbackMarkdown = (document: TableDocument) => {
  const header = document.fields.map((field) => markdownCell({ ...field, type: "text" }, field.name) || "字段");
  const divider = header.map(() => "---");
  const rows = document.records.map((record) => document.fields.map((field) => markdownCell(field, record.cells[field.id] ?? null)));
  return [header, divider, ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n");
};

export const serializeTableDocument = (document: TableDocument) =>
  `${tableFallbackMarkdown(document)}\n\n<!-- ${TABLE_MARKER}:${encodeBase64Url(JSON.stringify(document))} -->`;

export const createDefaultTableDocument = (labels: TableSeedLabels = {}): LegacyTableDocument => {
  const nameId = "fld_name";
  const statusId = "fld_status";
  const dateId = "fld_date";
  const notStarted = labels.notStarted ?? "未开始";
  const inProgress = labels.inProgress ?? "进行中";
  const done = labels.done ?? "完成";
  return {
    schemaVersion: TABLE_SCHEMA_VERSION,
    fields: [
      { id: nameId, name: labels.name ?? "名称", type: "text" },
      { id: statusId, name: labels.status ?? "状态", type: "select", options: [notStarted, inProgress, done] },
      { id: dateId, name: labels.date ?? "日期", type: "date" },
    ],
    records: [{
      id: "rec_sample",
      cells: {
        [nameId]: labels.sample ?? "示例记录",
        [statusId]: notStarted,
        [dateId]: "",
      },
    }],
    view: { filters: [], sort: null },
  };
};

const csvCell = (value: TableCellValue) => {
  const text = Array.isArray(value)
    ? attachmentNames(value).join("; ")
    : value === null || value === undefined ? "" : value === true ? "true" : value === false ? "false" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
};

export const tableDocumentToCsv = (document: TableDocument, records: TableRecord[] = document.records) => {
  const lines = [
    document.fields.map((field) => csvCell(field.name)),
    ...records.map((record) => document.fields.map((field) => csvCell(record.cells[field.id] ?? null))),
  ];
  return `\uFEFF${lines.map((line) => line.join(",")).join("\n")}`;
};

const cellSortText = (field: TableField, value: TableCellValue) => {
  if (field.type === "attachment") {
    const names = attachmentNames(value);
    return names.length ? `${String(names.length).padStart(4, "0")} ${names.join(" ")}` : null;
  }
  if (value === null || value === undefined || value === "") return null;
  if (field.type === "number") return typeof value === "number" ? value : null;
  if (field.type === "checkbox") return value === true ? 1 : 0;
  return String(value);
};

const matchesFilter = (field: TableField, value: TableCellValue, filter: TableFilter) => {
  if (field.type === "attachment") {
    const names = attachmentNames(value);
    const empty = names.length === 0;
    if (filter.operator === "empty") return empty;
    if (filter.operator === "notEmpty") return !empty;
    const expected = (filter.value ?? "").trim().toLocaleLowerCase();
    if (filter.operator === "eq") return names.some((name) => name.toLocaleLowerCase() === expected);
    return names.some((name) => name.toLocaleLowerCase().includes(expected));
  }
  const empty = field.type === "checkbox" ? value !== true : value === null || value === "";
  if (filter.operator === "empty") return empty;
  if (filter.operator === "notEmpty") return !empty;
  if (filter.operator === "eq") {
    if (field.type === "number") {
      const expected = Number(filter.value);
      return Number.isFinite(expected) && value === expected;
    }
    if (field.type === "checkbox") return (filter.value === "true") === (value === true);
    return String(value ?? "") === (filter.value ?? "");
  }
  return String(value ?? "").toLocaleLowerCase().includes((filter.value ?? "").trim().toLocaleLowerCase());
};

export const applyTableView = (
  document: TableDocument, records = document.records, view = getTableViews(document)[0]!, now = new Date(),
) => {
  const fields = new Map(document.fields.map((field) => [field.id, field]));
  const week = view.filters.some((filter) => filter.operator === "thisWeek") ? tableViewWeek(now) : undefined;
  const filtered = records.filter((record) => {
    const matches = (filter: TableViewFilter) => {
      const field = fields.get(filter.fieldId);
      if (!field) return filter.legacy === true;
      const value = record.cells[filter.fieldId] ?? null;
      return filter.legacy ? matchesFilter(field, value, filter) : matchesTypedTableFilter(field, value, filter, week);
    };
    return view.filters.length === 0 || (view.match === "all" ? view.filters.every(matches) : view.filters.some(matches));
  });
  const sorts = view.sorts.flatMap((rule) => {
    const field = fields.get(rule.fieldId);
    if (!field) return [];
    const options = !rule.legacy && field.type === "select"
      ? new Map((field.options ?? []).map((option, index) => [option, index]))
      : undefined;
    return [{ field, direction: rule.direction === "desc" ? -1 : 1, options }];
  });
  if (!sorts.length) return filtered;
  return filtered.sort((left, right) => {
    for (const { field, direction, options } of sorts) {
      const key = (value: TableCellValue) => options
        ? typeof value === "string" ? options.get(value) ?? null : null
        : cellSortText(field, value);
      const a = key(left.cells[field.id] ?? null);
      const b = key(right.cells[field.id] ?? null);
      if (a === null && b === null) continue;
      if (a === null) return 1;
      if (b === null) return -1;
      const compare = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
      if (compare) return compare * direction;
    }
    return 0;
  });
};

export const addTableField = (document: TableDocument, field: TableField): TableDocument => {
  if (document.fields.length >= TABLE_FIELD_LIMIT || document.fields.some((item) => item.id === field.id)) return document;
  const nextField = field.type === "select" ? { ...field, options: field.options ?? [] } : { ...field, options: undefined };
  return {
    ...document,
    fields: [...document.fields, nextField],
    records: document.records.map((record) => ({ ...record, cells: { ...record.cells, [nextField.id]: emptyCell(nextField) } })),
  };
};

export const updateTableField = (document: TableDocument, fieldId: string, patch: Partial<Pick<TableField, "name" | "type" | "options">>): TableDocument => {
  const current = document.fields.find((field) => field.id === fieldId);
  if (!current) return document;
  const next: TableField = {
    ...current,
    name: patch.name === undefined ? current.name : cleanName(patch.name, current.name),
    type: patch.type ?? current.type,
  };
  if (next.type === "select") next.options = cleanOptions(patch.options ?? current.options ?? []);
  const updated = document.schemaVersion === TABLE_VIEW_SCHEMA_VERSION && next.type !== current.type
    ? { ...document, views: document.views.map((view) => ({
      ...view,
      filters: view.filters.filter((rule) => rule.fieldId !== fieldId || rule.legacy || isValidTypedTableFilter(next, rule)),
    })) }
    : document;
  return {
    ...updated,
    fields: document.fields.map((field) => field.id === fieldId ? next : field),
    records: document.records.map((record) => ({
      ...record,
      cells: { ...record.cells, [fieldId]: coerceTableCell(next, record.cells[fieldId]) },
    })),
  };
};

export const removeTableField = (document: TableDocument, fieldId: string): TableDocument => {
  if (document.fields.length <= 1 || !document.fields.some((field) => field.id === fieldId)) return document;
  const fields = document.fields.filter((field) => field.id !== fieldId);
  const fieldIds = new Set(fields.map((field) => field.id));
  const records = document.records.map((record) => ({
    ...record,
    cells: Object.fromEntries(Object.entries(record.cells).filter(([id]) => fieldIds.has(id))),
  }));
  if (document.schemaVersion === TABLE_VIEW_SCHEMA_VERSION) return {
    ...document, fields, records,
    views: document.views.map((view) => ({
      ...view,
      filters: view.filters.filter((filter) => filter.fieldId !== fieldId),
      sorts: view.sorts.filter((sort) => sort.fieldId !== fieldId),
    })),
  };
  return {
    ...document, fields, records,
    view: {
      filters: document.view.filters.filter((filter) => filter.fieldId !== fieldId),
      sort: document.view.sort?.fieldId === fieldId ? null : document.view.sort,
    },
  };
};

export const addTableRecord = (document: TableDocument, id = createTableId("rec")): TableDocument => {
  if (document.records.length >= TABLE_RECORD_LIMIT || document.records.some((record) => record.id === id)) return document;
  const cells: Record<string, TableCellValue> = {};
  for (const field of document.fields) cells[field.id] = emptyCell(field);
  return { ...document, records: [...document.records, { id, cells }] };
};

export const updateTableCell = (document: TableDocument, recordId: string, fieldId: string, value: unknown): TableDocument => {
  const field = document.fields.find((item) => item.id === fieldId);
  if (!field) return document;
  return {
    ...document,
    records: document.records.map((record) => record.id === recordId
      ? { ...record, cells: { ...record.cells, [fieldId]: coerceTableCell(field, value) } }
      : record),
  };
};

export const removeTableRecord = (document: TableDocument, recordId: string): TableDocument => ({
  ...document,
  records: document.records.filter((record) => record.id !== recordId),
});

export const replaceTableView = (document: LegacyTableDocument, view: TableView): LegacyTableDocument => ({
  ...document,
  view: parseView(view, new Set(document.fields.map((field) => field.id))),
});

export const getTableSummary = (markdown: string | null | undefined): {
  structuredTable: boolean;
  tablePreview?: TableSummaryPreview;
} => {
  const document = parseTableDocument(markdown);
  if (!document) return { structuredTable: false };
  return {
    structuredTable: true,
    tablePreview: {
      fieldCount: document.fields.length,
      recordCount: document.records.length,
      fieldNames: document.fields.map((field) => field.name).filter(Boolean).slice(0, 4),
    },
  };
};
