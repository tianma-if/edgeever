import type { TableCellValue, TableField, TableFilter, TableSort } from "./table";

export const DEFAULT_TABLE_VIEW_ID = "default";
export const TABLE_VIEW_SCHEMA_VERSION = 2 as const;
export const TABLE_LAYOUT_SCHEMA_VERSION = 3 as const;
export const TABLE_CURRENT_SCHEMA_VERSION = TABLE_LAYOUT_SCHEMA_VERSION;
export const TABLE_VIEW_FILTER_LIMIT = 8;
export const TABLE_VIEW_COLUMN_MIN_WIDTH = 80;
export const TABLE_VIEW_COLUMN_MAX_WIDTH = 600;

const TEXT_OPERATORS = ["contains", "notContains", "eq", "neq", "empty", "notEmpty"] as const;
const COMPARISON_OPERATORS = ["eq", "neq", "lt", "lte", "gt", "gte"] as const;
const EMPTY_OPERATORS = ["empty", "notEmpty"] as const;

export const TABLE_VIEW_OPERATORS = {
  text: TEXT_OPERATORS,
  url: TEXT_OPERATORS,
  phone: TEXT_OPERATORS,
  email: TEXT_OPERATORS,
  number: [...COMPARISON_OPERATORS, ...EMPTY_OPERATORS],
  autoNumber: [...COMPARISON_OPERATORS, ...EMPTY_OPERATORS],
  date: ["eq", "lt", "gt", "between", "thisWeek", ...EMPTY_OPERATORS],
  select: ["eq", "neq", ...EMPTY_OPERATORS],
  multiSelect: ["contains", "notContains", ...EMPTY_OPERATORS],
  checkbox: ["eq"],
  attachment: EMPTY_OPERATORS,
  // Computed cells are read-only projections; only emptiness can be filtered for now.
  createdTime: EMPTY_OPERATORS,
  updatedTime: EMPTY_OPERATORS,
  progress: [...COMPARISON_OPERATORS, ...EMPTY_OPERATORS],
  rating: [...COMPARISON_OPERATORS, ...EMPTY_OPERATORS],
  currency: [...COMPARISON_OPERATORS, ...EMPTY_OPERATORS],
  percent: [...COMPARISON_OPERATORS, ...EMPTY_OPERATORS],
} as const;

export type TableViewOperator = (typeof TABLE_VIEW_OPERATORS)[keyof typeof TABLE_VIEW_OPERATORS][number];
export type TypedTableFilter = {
  fieldId: string;
  operator: TableViewOperator;
  value?: string | number | boolean;
  endValue?: string;
  legacy?: never;
};
export type TableViewFilter = TypedTableFilter | (TableFilter & { legacy: true });
export type TableViewSort = TableSort & { legacy?: true };
export type TableViewColumn = {
  fieldId: string;
  hidden?: boolean;
  width?: number;
};
export type TableViewGroup = {
  fieldId: string;
  direction: "asc" | "desc";
};
/** Additive list of view layouts; TABLE_LAYOUT_SCHEMA_VERSION stays 3 because older clients keep parsing the same documents. */
export const TABLE_VIEW_LAYOUTS = ["grid", "kanban", "calendar", "gallery", "gantt"] as const;
export type TableViewLayout = (typeof TABLE_VIEW_LAYOUTS)[number];
export type NamedTableView = {
  id: string;
  /** Empty only for the inherited, localized default view. */
  name: string;
  match: "all" | "any";
  filters: TableViewFilter[];
  sorts: TableViewSort[];
  /** Optional in v2; persisted in v3 to prevent older clients from dropping it. */
  columns?: TableViewColumn[];
  groupBy?: TableViewGroup;
  layout?: TableViewLayout;
};

export const TABLE_GROUPABLE_FIELD_TYPES = ["select", "checkbox", "date"] as const;

/** Numeric field types accept numeric filter values; kept local to avoid a runtime import cycle with table.ts. */
const NUMERIC_FILTER_FIELD_TYPES = ["number", "autoNumber", "progress", "rating", "currency", "percent"] as const;

export const tableFilterNeedsValue = (operator: TableViewOperator) =>
  operator !== "empty" && operator !== "notEmpty" && operator !== "thisWeek";

const isCalendarDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export const isValidTypedTableFilter = (field: TableField, filter: TypedTableFilter) => {
  if (!(TABLE_VIEW_OPERATORS[field.type] as readonly string[]).includes(filter.operator)) return false;
  if (!tableFilterNeedsValue(filter.operator)) return true;
  if (field.type === "checkbox") return typeof filter.value === "boolean";
  if ((NUMERIC_FILTER_FIELD_TYPES as readonly string[]).includes(field.type)) {
    return typeof filter.value === "number" && Number.isFinite(filter.value);
  }
  if (field.type === "date") {
    if (!isCalendarDate(filter.value)) return false;
    return filter.operator !== "between" || (isCalendarDate(filter.endValue) && filter.endValue >= filter.value);
  }
  return typeof filter.value === "string" && filter.value.trim().length > 0;
};

const localDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const tableViewWeek = (now: Date) => {
  const start = new Date(now);
  start.setDate(now.getDate() - (now.getDay() + 6) % 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return [localDayKey(start), localDayKey(end)] as const;
};

export const matchesTypedTableFilter = (
  field: TableField, value: TableCellValue, filter: TypedTableFilter, week: readonly [string, string] | undefined,
) => {
  const empty = value === null || value === "" || (Array.isArray(value) && value.length === 0);
  const expected = filter.value;
  if (field.type === "date" && !isCalendarDate(value) && filter.operator !== "empty" && filter.operator !== "notEmpty") return false;
  if (field.type === "multiSelect" && (filter.operator === "contains" || filter.operator === "notContains")) {
    const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const contains = typeof expected === "string" && selected.includes(expected);
    return filter.operator === "contains" ? contains : !contains;
  }
  switch (filter.operator) {
    case "empty": return empty;
    case "notEmpty": return !empty;
    case "eq": return value === expected;
    case "neq": return value !== expected;
    case "contains":
    case "notContains": {
      const contains = String(value ?? "").toLocaleLowerCase().includes(String(expected).trim().toLocaleLowerCase());
      return filter.operator === "contains" ? contains : !contains;
    }
    case "thisWeek": return Boolean(week && typeof value === "string" && value >= week[0] && value <= week[1]);
    case "between": return typeof value === "string" && typeof expected === "string"
      && value >= expected && value <= (filter.endValue ?? "");
    default: {
      if (empty) return false;
      if (typeof value === "number" && typeof expected === "number"
        || typeof value === "string" && typeof expected === "string") {
        if (filter.operator === "lt") return value < expected;
        if (filter.operator === "lte") return value <= expected;
        if (filter.operator === "gt") return value > expected;
        if (filter.operator === "gte") return value >= expected;
      }
      return false;
    }
  }
};

export const tableViewHasEnhancedLayout = (view: NamedTableView) =>
  Boolean(view.columns?.length || view.groupBy || (view.layout && view.layout !== "grid"));

/** Store a clamped column width; value is rounded and bounded by the view column limits. */
export const setTableViewColumnWidth = (fields: TableField[], view: NamedTableView, fieldId: string, width: number): NamedTableView => {
  if (!Number.isFinite(width)) return view;
  const columns = resolveTableViewColumns(fields, view);
  const index = columns.findIndex((column) => column.fieldId === fieldId);
  if (index < 0) return view;
  const clamped = Math.round(Math.min(TABLE_VIEW_COLUMN_MAX_WIDTH, Math.max(TABLE_VIEW_COLUMN_MIN_WIDTH, width)));
  if (columns[index].width === clamped) return view;
  const next = columns.slice();
  next[index] = { ...next[index], width: clamped };
  return { ...view, columns: next };
};

/** Resolves persisted column preferences without hiding fields added after the view was saved. */
export const resolveTableViewColumns = (fields: TableField[], view: NamedTableView): TableViewColumn[] => {
  if (!view.columns) return fields.map((field) => ({ fieldId: field.id }));
  const byId = new Map(fields.map((field) => [field.id, field]));
  const columns = view.columns.filter((column) => byId.has(column.fieldId));
  const seen = new Set(columns.map((column) => column.fieldId));
  for (const field of fields) {
    if (!seen.has(field.id)) columns.push({ fieldId: field.id });
  }
  return columns;
};
