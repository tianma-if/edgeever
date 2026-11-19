import type { TableCellValue, TableField, TableFilter, TableSort } from "./table";

export const DEFAULT_TABLE_VIEW_ID = "default";
export const TABLE_VIEW_SCHEMA_VERSION = 2 as const;
export const TABLE_VIEW_FILTER_LIMIT = 8;

const TEXT_OPERATORS = ["contains", "notContains", "eq", "neq", "empty", "notEmpty"] as const;
const COMPARISON_OPERATORS = ["eq", "neq", "lt", "lte", "gt", "gte"] as const;
const EMPTY_OPERATORS = ["empty", "notEmpty"] as const;

export const TABLE_VIEW_OPERATORS = {
  text: TEXT_OPERATORS,
  url: TEXT_OPERATORS,
  number: [...COMPARISON_OPERATORS, ...EMPTY_OPERATORS],
  date: ["eq", "lt", "gt", "between", "thisWeek", ...EMPTY_OPERATORS],
  select: ["eq", "neq", ...EMPTY_OPERATORS],
  checkbox: ["eq"],
  attachment: EMPTY_OPERATORS,
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
export type NamedTableView = {
  id: string;
  /** Empty only for the inherited, localized default view. */
  name: string;
  match: "all" | "any";
  filters: TableViewFilter[];
  sorts: TableViewSort[];
};

export const tableFilterNeedsValue = (operator: TableViewOperator) =>
  operator !== "empty" && operator !== "notEmpty" && operator !== "thisWeek";

const isCalendarDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export const isValidTypedTableFilter = (field: TableField, filter: TypedTableFilter) => {
  if (!(TABLE_VIEW_OPERATORS[field.type] as readonly string[]).includes(filter.operator)) return false;
  if (!tableFilterNeedsValue(filter.operator)) return true;
  if (field.type === "checkbox") return typeof filter.value === "boolean";
  if (field.type === "number") return typeof filter.value === "number" && Number.isFinite(filter.value);
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
