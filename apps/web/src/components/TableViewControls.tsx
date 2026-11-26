import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp, Calendar, Columns3, Filter, GanttChart, GripVertical, Group, Images, LayoutGrid, MoreHorizontal, Pencil, Plus, SquareKanban, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  createTableId, isValidTypedTableFilter, resolveTableViewColumns, tableFilterNeedsValue,
  TABLE_GROUPABLE_FIELD_TYPES, TABLE_VIEW_COLUMN_MAX_WIDTH, TABLE_VIEW_COLUMN_MIN_WIDTH,
  TABLE_VIEW_FILTER_LIMIT, TABLE_VIEW_OPERATORS,
  type NamedTableView, type TableField, type TableViewColumn, type TableViewFilter,
  type TableViewLayout, type TableViewOperator, type TableViewSort,
} from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FIELD_ICONS } from "@/components/table/table-cells";

type Mode = "filter" | "sort" | "fields" | "group" | "new" | "copy" | "rename" | "delete";
export type TableViewDialogMode = Mode;
type FilterDraft = { id: number; rule: TableViewFilter };
type Props = {
  fields: TableField[];
  views: NamedTableView[];
  active: NamedTableView;
  readOnly: boolean;
  /** Renders only the dialogs; the compact editor draws its own single-row toolbars. */
  compact?: boolean;
  /** Lets a compact toolbar open one of the dialogs from outside. */
  openRequest?: { mode: TableViewDialogMode; nonce: number } | null;
  /** Layouts offered by the switcher; the single-table editor opts out of the newer views. */
  layouts?: TableViewLayout[];
  onSelect: (id: string) => void;
  onCommit: (views: NamedTableView[], selected: string) => Promise<boolean>;
  /** Opens the full field editor from the fields panel; omitted by editors that edit inline. */
  onEditField?: (field: TableField) => void;
  /** Numeric width input in the fields panel; bases resize columns by dragging the header edge. */
  showColumnWidth?: boolean;
  /** Bumped by the editor to reopen the fields panel after a field dialog closes. */
  fieldsPanelSignal?: number;
};

export const LAYOUT_META: Record<TableViewLayout, { icon: typeof LayoutGrid; label: string }> = {
  grid: { icon: LayoutGrid, label: "structuredTable.gridView" },
  kanban: { icon: SquareKanban, label: "structuredTable.kanbanView" },
  calendar: { icon: Calendar, label: "structuredTable.calendarView" },
  gallery: { icon: Images, label: "structuredTable.galleryView" },
  gantt: { icon: GanttChart, label: "structuredTable.ganttView" },
};

const selectClass = "h-9 min-w-0 rounded-md border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const newRule = (field: TableField, operator: TableViewOperator = TABLE_VIEW_OPERATORS[field.type][0]): TableViewFilter =>
  field.type === "checkbox" ? { fieldId: field.id, operator, value: false } : { fieldId: field.id, operator };

function IconAction({ label, children, onClick, disabled }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function FilterValue({ field, rule, onChange }: {
  field: TableField; rule: TableViewFilter; onChange: (rule: TableViewFilter) => void;
}) {
  const { t } = useTranslation();
  if (!tableFilterNeedsValue(rule.operator)) return null;
  const label = t("structuredTable.filterValue");
  const value = String(rule.value ?? "");
  const change = (next: string) => {
    if (rule.legacy) onChange({ ...rule, value: next });
    else onChange({ ...rule, value: field.type === "number" || field.type === "autoNumber" ? next === "" ? undefined : Number(next) : field.type === "checkbox" ? next === "true" : next });
  };
  if (field.type === "checkbox" && rule.operator === "eq") {
    return (
      <select className={selectClass} value={String(value === "true")} onChange={(event) => change(event.target.value)} aria-label={label}>
        <option value="false">{t("structuredTable.views.unchecked")}</option>
        <option value="true">{t("structuredTable.views.checked")}</option>
      </select>
    );
  }
  if (field.type === "multiSelect" && (rule.operator === "contains" || rule.operator === "notContains")) {
    const options = field.options ?? [];
    return (
      <select className={selectClass} value={value} onChange={(event) => change(event.target.value)} aria-label={label}>
        <option value="">{t("structuredTable.views.chooseOption")}</option>
        {value && !options.includes(value) && <option value={value}>{value}</option>}
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    );
  }
  if (field.type === "select" && (rule.operator === "eq" || rule.operator === "neq")) {
    const options = field.options ?? [];
    return (
      <select className={selectClass} value={value} onChange={(event) => change(event.target.value)} aria-label={label}>
        <option value="">{t("structuredTable.views.chooseOption")}</option>
        {value && !options.includes(value) && <option value={value}>{value}</option>}
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    );
  }
  const type = (field.type === "number" || field.type === "autoNumber") && (!rule.legacy || (rule.operator === "eq" && Number.isFinite(Number(value)))) ? "number"
    : field.type === "date" && (!rule.legacy || (rule.operator === "eq" && /^\d{4}-\d{2}-\d{2}$/.test(value))) ? "date"
    : field.type === "email" ? "email"
    : field.type === "phone" ? "tel"
    : "text";
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      <Input className="h-9 min-w-0 flex-1" aria-label={label} type={type} step={type === "number" ? "any" : undefined}
        value={value} onChange={(event) => change(event.target.value)} />
      {rule.operator === "between" && (
        <Input className="h-9 min-w-0 flex-1" aria-label={t("structuredTable.views.endDate")} type="date"
          value={rule.endValue ?? ""} onChange={(event) => onChange({ ...rule, endValue: event.target.value })} />
      )}
    </div>
  );
}

function ViewDialog({ mode, fields, views, active, readOnly, onCommit, close, focusOpener, onEditField, showColumnWidth = true }: Props & {
  mode: Mode; close: () => void; focusOpener: () => void;
}) {
  const { t } = useTranslation();
  const label = (view: NamedTableView) => view.name || t("structuredTable.views.default");
  const [name, setName] = useState(() => mode === "copy" ? t("structuredTable.views.copyName", { name: label(active) }) : mode === "rename" ? label(active) : "");
  const [match, setMatch] = useState(active.match);
  const nextId = useRef(active.filters.length);
  const [filters, setFilters] = useState<FilterDraft[]>(() => active.filters.map((rule, id) => ({ id, rule })));
  const [sorts, setSorts] = useState(active.sorts);
  const [columns, setColumns] = useState<TableViewColumn[]>(() => resolveTableViewColumns(fields, active));
  const [groupFieldId, setGroupFieldId] = useState(active.groupBy?.fieldId ?? "");
  const [groupDirection, setGroupDirection] = useState(active.groupBy?.direction ?? "asc");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const descriptionId = useId();
  const byId = new Map(fields.map((field) => [field.id, field]));
  const named = mode === "new" || mode === "copy" || mode === "rename";
  const valid = named ? Boolean(name.trim()) : mode === "filter"
    ? filters.every(({ rule }) => {
      const field = byId.get(rule.fieldId);
      return field && (rule.legacy || isValidTypedTableFilter(field, rule));
    })
    : mode === "sort" ? sorts.every((rule) => byId.has(rule.fieldId))
    : mode === "fields" ? columns.length === fields.length && !columns[0]?.hidden && columns.every((column) => byId.has(column.fieldId))
    : mode === "group" ? !groupFieldId || Boolean(byId.has(groupFieldId) && TABLE_GROUPABLE_FIELD_TYPES.includes(byId.get(groupFieldId)!.type as (typeof TABLE_GROUPABLE_FIELD_TYPES)[number]))
    : views.length > 1;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy || readOnly) return;
    let selected = active.id;
    let next: NamedTableView[];
    if (mode === "new" || mode === "copy") {
      selected = createTableId("view");
      next = [...views, mode === "copy" ? { ...active, id: selected, name }
        : { id: selected, name, match: "all", filters: [], sorts: [] }];
    } else if (mode === "delete") {
      next = views.filter((view) => view.id !== active.id);
      selected = next[Math.max(0, views.findIndex((view) => view.id === active.id) - 1)]!.id;
    } else {
      next = views.map((view) => view.id !== active.id ? view : {
        ...view, ...(mode === "filter" ? { match, filters: filters.map(({ rule }) => rule) }
          : mode === "sort" ? { sorts }
          : mode === "fields" ? { columns }
          : mode === "group" ? {
            groupBy: groupFieldId ? { fieldId: groupFieldId, direction: groupDirection } : undefined,
            layout: groupFieldId ? view.layout : view.layout === "kanban" ? "grid" : view.layout,
          }
          : { name }),
      });
    }
    setBusy(true);
    setError("");
    try {
      if (await onCommit(next, selected)) close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("structuredTable.saveError"));
    } finally {
      setBusy(false);
    }
  };

  const changeFilter = (id: number, rule: TableViewFilter) => setFilters((items) => items.map((item) => item.id === id ? { id, rule } : item));
  const setSort = (index: number, rule: TableViewSort) => setSorts((items) => items.map((item, position) => position === index ? rule : item));
  const moveSort = (index: number, delta: number) => setSorts((items) => {
    const next = [...items];
    const target = index + delta;
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);
  const draggingColumnRef = useRef<string | null>(null);
  const dropColumnRef = useRef<string | null>(null);
  const fieldListRef = useRef<HTMLDivElement | null>(null);
  const columnsRef = useRef<TableViewColumn[]>(columns);
  columnsRef.current = columns;
  const columnRowIndex = (clientY: number) => {
    const rows = fieldListRef.current?.querySelectorAll<HTMLElement>('[data-testid="field-panel-row"]');
    if (!rows?.length) return -1;
    for (let index = 0; index < rows.length; index += 1) {
      const bounds = rows[index].getBoundingClientRect();
      if (clientY < bounds.top + bounds.height / 2) return index;
    }
    return rows.length - 1;
  };
  const reorderColumns = (sourceId: string, targetId: string) => setColumns((items) => {
    if (sourceId === targetId) return items;
    const from = items.findIndex((column) => column.fieldId === sourceId);
    if (from < 1) return items;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    const target = next.findIndex((column) => column.fieldId === targetId);
    if (target < 0) return items;
    // The first field stays the index column, so a drop on it lands right after it.
    next.splice(Math.max(1, target), 0, moved);
    return next;
  });
  const startColumnDrag = (event: React.PointerEvent<HTMLElement>, fieldId: string, field: TableField) => {
    if (readOnly) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [data-no-drag]")) return;
    event.preventDefault();
    draggingColumnRef.current = fieldId;
    dropColumnRef.current = null;
    setDraggingColumn(fieldId);
    setDropColumn(null);
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const onMove = (moveEvent: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
        moved = true;
      }
      const index = columnRowIndex(moveEvent.clientY);
      const target = columnsRef.current[Math.max(1, index)];
      if (!target || target.fieldId === draggingColumnRef.current) return;
      dropColumnRef.current = target.fieldId;
      setDropColumn(target.fieldId);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      const source = draggingColumnRef.current;
      const target = dropColumnRef.current;
      draggingColumnRef.current = null;
      dropColumnRef.current = null;
      setDraggingColumn(null);
      setDropColumn(null);
      if (!moved) {
        // The row press swallowed the native click, so a tap opens the field editor here.
        if (onEditField) {
          close();
          onEditField(field);
        }
        return;
      }
      if (source && target && source !== target) reorderColumns(source, target);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  const updateColumn = (fieldId: string, patch: Partial<TableViewColumn>) => setColumns((items) =>
    items.map((column) => column.fieldId === fieldId ? { ...column, ...patch } : column));
  const groupableFields = fields.filter((field) => TABLE_GROUPABLE_FIELD_TYPES.includes(field.type as (typeof TABLE_GROUPABLE_FIELD_TYPES)[number]));
  const unusedSortField = fields.find((field) => !sorts.some((sort) => sort.fieldId === field.id));
  const title = mode === "filter" || mode === "sort" || mode === "fields" || mode === "group"
    ? t(`structuredTable.${mode}`) : t(`structuredTable.views.${mode}`);
  return (
    <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto p-4 sm:p-6" showCloseButton={false}
      aria-describedby={mode === "delete" ? descriptionId : undefined}
      onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
      onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
      onCloseAutoFocus={(event) => { event.preventDefault(); focusOpener(); }}>
      <form className="grid gap-4" onSubmit={(event) => { void submit(event); }}>
        <DialogTitle>{title}</DialogTitle>
        {named && (
          <label className="grid gap-2 text-sm">
            {t("structuredTable.views.name")}
            <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        )}
        {mode === "delete" && <DialogDescription id={descriptionId}>{t("structuredTable.views.deleteConfirm", { name: label(active) })}</DialogDescription>}
        {mode === "filter" && (
          <fieldset className="grid min-w-0 gap-2" disabled={readOnly}>
            {filters.length > 0 && (
              <select className={`${selectClass} w-fit`} aria-label={t("structuredTable.views.match")}
                value={match} onChange={(event) => setMatch(event.target.value === "any" ? "any" : "all")}>
                <option value="all">{t("structuredTable.views.all")}</option>
                <option value="any">{t("structuredTable.views.any")}</option>
              </select>
            )}
            <div className="grid max-h-[45vh] min-w-0 gap-2 overflow-y-auto pr-1">
              {filters.map(({ id, rule }) => {
                const field = byId.get(rule.fieldId);
                if (!field) return null;
                const available: readonly TableViewOperator[] = TABLE_VIEW_OPERATORS[field.type];
                const operators = available.includes(rule.operator) ? available : [...available, rule.operator];
                return (
                  <div key={id} className="grid min-w-0 grid-cols-[1fr_1fr_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.7fr)_auto]">
                    <select className={selectClass} aria-label={t("structuredTable.fieldName")} value={field.id}
                      onChange={(event) => changeFilter(id, newRule(byId.get(event.target.value)!))}>
                      {fields.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                    <select className={selectClass} aria-label={t("structuredTable.views.operator")} value={rule.operator}
                      onChange={(event) => changeFilter(id, newRule(field, event.target.value as TableViewOperator))}>
                      {operators.map((operator) => {
                        const label = field.type === "date" && operator === "lt" ? "before" : field.type === "date" && operator === "gt" ? "after" : operator;
                        return <option key={operator} value={operator}>{t(`structuredTable.operators.${label}`)}</option>;
                      })}
                    </select>
                    <div className="col-span-3 col-start-1 row-start-2 empty:hidden sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:empty:block">
                      <FilterValue field={field} rule={rule} onChange={(next) => changeFilter(id, next)} />
                    </div>
                    <div className="col-start-3 row-start-1 sm:col-start-4">
                      <IconAction label={t("structuredTable.views.removeRule")} onClick={() => setFilters((items) => items.filter((item) => item.id !== id))}><X className="size-4" /></IconAction>
                    </div>
                  </div>
                );
              })}
            </div>
            <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={filters.length >= TABLE_VIEW_FILTER_LIMIT || !fields.length}
              onClick={() => { const id = nextId.current++; setFilters((items) => [...items, { id, rule: newRule(fields[0]!) }]); }}>
              <Plus className="size-4" /> {t("structuredTable.addFilter")}
            </Button>
          </fieldset>
        )}
        {mode === "sort" && (
          <fieldset className="grid min-w-0 gap-2" disabled={readOnly}>
            <div className="grid max-h-[45vh] gap-2 overflow-y-auto pr-1">
              {sorts.map((rule, index) => {
                const optionOrder = byId.get(rule.fieldId)?.type === "select" && !rule.legacy;
                return (
                  <div key={rule.fieldId} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                    <select className={selectClass} aria-label={t("structuredTable.fieldName")} value={rule.fieldId}
                      onChange={(event) => setSort(index, { fieldId: event.target.value, direction: rule.direction })}>
                      {fields.filter((field) => field.id === rule.fieldId || !sorts.some((sort) => sort.fieldId === field.id))
                        .map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
                    </select>
                    <select className={selectClass} aria-label={t("structuredTable.views.direction")} value={rule.direction}
                      onChange={(event) => setSort(index, { ...rule, direction: event.target.value === "desc" ? "desc" : "asc" })}>
                      <option value="asc">{t(optionOrder ? "structuredTable.views.optionOrder" : "structuredTable.ascending")}</option>
                      <option value="desc">{t(optionOrder ? "structuredTable.views.reverseOptionOrder" : "structuredTable.descending")}</option>
                    </select>
                    <div className="flex">
                      <IconAction label={t("structuredTable.views.moveUp")} disabled={index === 0} onClick={() => moveSort(index, -1)}><ArrowUp className="size-4" /></IconAction>
                      <IconAction label={t("structuredTable.views.moveDown")} disabled={index === sorts.length - 1} onClick={() => moveSort(index, 1)}><ArrowDown className="size-4" /></IconAction>
                      <IconAction label={t("structuredTable.views.removeRule")} onClick={() => setSorts((items) => items.filter((item) => item.fieldId !== rule.fieldId))}><X className="size-4" /></IconAction>
                    </div>
                  </div>
                );
              })}
            </div>
            <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={!unusedSortField}
              onClick={() => { if (unusedSortField) setSorts((items) => [...items, { fieldId: unusedSortField.id, direction: "asc" }]); }}>
              <Plus className="size-4" /> {t("structuredTable.views.addSort")}
            </Button>
          </fieldset>
        )}
        {mode === "fields" && (
          <fieldset className="grid min-w-0 gap-2" disabled={readOnly}>
            <p className="text-xs text-muted-foreground">{t("structuredTable.fieldsHint")}</p>
            <div ref={fieldListRef} data-testid="field-panel-list" className="grid max-h-[55vh] min-w-0 gap-1 overflow-y-auto pr-1">
              {columns.map((column, index) => {
                const field = byId.get(column.fieldId);
                if (!field) return null;
                const primary = index === 0;
                const Icon = FIELD_ICONS[field.type];
                const dropping = dropColumn === column.fieldId;
                return (
                  <div
                    key={column.fieldId}
                    data-testid="field-panel-row"
                    data-field-id={column.fieldId}
                    onPointerDown={(event) => startColumnDrag(event, column.fieldId, field)}
                    className={`group/field flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${dropping ? "border-sky-400 bg-sky-50/60" : "border-border hover:bg-muted/40"} ${draggingColumn === column.fieldId ? "opacity-50" : ""} ${primary ? "" : "cursor-grab active:cursor-grabbing"}`}
                  >
                    <span
                      aria-hidden="true"
                      data-testid="field-panel-grip"
                      className={`flex size-4 shrink-0 items-center justify-center transition-opacity ${primary ? "text-muted-foreground/20" : "text-muted-foreground/60 opacity-0 group-hover/field:opacity-100"}`}
                    >
                      <GripVertical className="size-3.5" />
                    </span>
                    <input
                      type="checkbox"
                      checked={!column.hidden}
                      disabled={primary}
                      aria-label={field.name}
                      onChange={(event) => updateColumn(column.fieldId, { hidden: !event.target.checked })}
                      className="size-4 accent-slate-900"
                    />
                    {onEditField ? (
                      <>
                        <button
                          type="button"
                          onClick={() => { close(); onEditField?.(field); }}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate">{field.name}</span>
                        </button>
                        <button
                          type="button"
                          data-testid="field-panel-edit"
                          data-no-drag="true"
                          onClick={() => { close(); onEditField?.(field); }}
                          aria-label={t("structuredTable.editField", { name: field.name })}
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/field:opacity-100"
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <span className="flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5 text-sm">
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate">{field.name}</span>
                      </span>
                    )}
                    {showColumnWidth ? (
                      <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Input
                          type="number"
                          min={TABLE_VIEW_COLUMN_MIN_WIDTH}
                          max={TABLE_VIEW_COLUMN_MAX_WIDTH}
                          value={column.width ?? (field.type === "attachment" ? 240 : 160)}
                          onChange={(event) => updateColumn(column.fieldId, { width: Number(event.target.value) })}
                          className="h-8 w-20"
                          aria-label={`${field.name} ${t("structuredTable.fieldWidth")}`}
                        />
                        <span>px</span>
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}
        {mode === "group" && (
          <fieldset className="grid min-w-0 gap-4" disabled={readOnly}>
            <label className="grid gap-2 text-sm">
              {t("structuredTable.groupBy")}
              <select className={selectClass} value={groupFieldId} onChange={(event) => setGroupFieldId(event.target.value)}>
                <option value="">{t("structuredTable.noGroup")}</option>
                {groupableFields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              {t("structuredTable.views.direction")}
              <select className={selectClass} value={groupDirection} onChange={(event) => setGroupDirection(event.target.value === "desc" ? "desc" : "asc")} disabled={!groupFieldId}>
                <option value="asc">{t("structuredTable.ascending")}</option>
                <option value="desc">{t("structuredTable.descending")}</option>
              </select>
            </label>
          </fieldset>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={close}>{t("structuredTable.views.cancel")}</Button>
          {!readOnly && <Button type="submit" variant={mode === "delete" ? "danger" : "solid"} disabled={!valid || busy}>
            {t(mode === "delete" ? "structuredTable.views.delete" : "structuredTable.views.apply")}
          </Button>}
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function TableViewControls(props: Props) {
  const { t } = useTranslation();
  const { views, active, readOnly, onSelect } = props;
  const [mode, setMode] = useState<Mode | null>(null);
  const fieldsPanelSignal = props.fieldsPanelSignal ?? 0;
  useEffect(() => {
    if (fieldsPanelSignal > 0) setMode("fields");
  }, [fieldsPanelSignal]);
  const openRequest = props.openRequest ?? null;
  const openRequestNonce = openRequest?.nonce ?? 0;
  useEffect(() => {
    if (openRequest) setMode(openRequest.mode);
    // The nonce is the trigger: the same mode requested twice still reopens the dialog.
  }, [openRequestNonce]);
  const opener = useRef<HTMLButtonElement | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const open = (next: Mode, button: HTMLButtonElement | null) => {
    opener.current = button;
    setMode(next);
  };
  const hiddenColumns = resolveTableViewColumns(props.fields, active).filter((column) => column.hidden).length;
  const commitLayout = async (layout: TableViewLayout) => {
    if (readOnly) return;
    let groupBy = active.groupBy;
    if (layout === "kanban") {
      const current = props.fields.find((field) => field.id === groupBy?.fieldId);
      if (current?.type !== "select") {
        const fallback = props.fields.find((field) => field.type === "select");
        if (!fallback) {
          open("group", menuButton.current);
          return;
        }
        groupBy = { fieldId: fallback.id, direction: "asc" };
      }
    }
    await props.onCommit(views.map((view) => view.id === active.id ? { ...view, layout, groupBy } : view), active.id);
  };
  return (
    <Dialog open={mode !== null} onOpenChange={(open) => { if (!open) setMode(null); }}>
      {props.compact ? null : (
      <div className="min-w-0 border-b border-border">
      <div className="flex min-w-0 items-center gap-1 px-3">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="group" aria-label={t("structuredTable.views.label")}>
            {views.map((view) => (
              <button type="button" key={view.id} aria-pressed={view.id === active.id} onClick={() => onSelect(view.id)}
                className="flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:border-foreground aria-pressed:font-medium aria-pressed:text-foreground">
                {(() => {
                  const Icon = LAYOUT_META[view.layout ?? "grid"].icon;
                  return <Icon aria-hidden="true" className="size-3.5" />;
                })()}
                <span className="max-w-44 truncate">{view.name || t("structuredTable.views.default")}</span>
              </button>
            ))}
          </div>
          {!readOnly && (
            <>
              <Button type="button" variant="ghost" size="icon" aria-label={t("structuredTable.views.new")}
                onClick={(event) => open("new", event.currentTarget)}>
                <Plus className="size-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button ref={menuButton} type="button" variant="ghost" size="icon" aria-label={t("structuredTable.views.actions")}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => open("rename", menuButton.current)}>{t("structuredTable.views.rename")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => open("copy", menuButton.current)}>{t("structuredTable.views.copy")}</DropdownMenuItem>
                  <DropdownMenuItem disabled={views.length <= 1} onSelect={() => open("delete", menuButton.current)}>{t("structuredTable.views.delete")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
      </div>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-3 py-1">
          {!readOnly && (
            <div className="mr-1 flex shrink-0 rounded-lg border border-border p-0.5" role="group" aria-label={t("structuredTable.views.label")}>
              {(props.layouts ?? (["grid", "kanban"] as TableViewLayout[])).map((layout) => {
                const meta = LAYOUT_META[layout];
                const Icon = meta.icon;
                const selected = layout === "grid" ? active.layout === "grid" || !active.layout : active.layout === layout;
                return (
                  <Tooltip key={layout}>
                    <TooltipTrigger asChild>
                      <Button type="button" size="icon-sm" variant={selected ? "soft" : "ghost"} aria-label={t(meta.label)} aria-pressed={selected} onClick={() => { void commitLayout(layout); }}>
                        <Icon className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t(meta.label)}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}
          <Button type="button" size="sm" variant={hiddenColumns ? "soft" : "ghost"} className="shrink-0" onClick={(event) => open("fields", event.currentTarget)}>
            <Columns3 className="size-3.5" /> {t("structuredTable.fields")}
            {hiddenColumns > 0 && <span className="tabular-nums">{hiddenColumns}</span>}
          </Button>
          {(["filter", "group", "sort"] as const).map((item) => {
            const count = item === "filter" ? active.filters.length : item === "sort" ? active.sorts.length : 0;
            const Icon = item === "filter" ? Filter : item === "group" ? Group : ArrowDownUp;
            const on = item === "group" ? Boolean(active.groupBy) : count > 0;
            return (
              <Button key={item} type="button" size="sm" variant={on ? "soft" : "ghost"} className="shrink-0"
                onClick={(event) => open(item, event.currentTarget)}>
                <Icon className="size-3.5" /> {t(`structuredTable.${item}`)}
                {count > 0 && <span className="tabular-nums">{count}</span>}
              </Button>
            );
          })}
        </div>
      </div>
      )}
      {mode && <ViewDialog key={`${active.id}:${mode}`} {...props} mode={mode} close={() => setMode(null)} focusOpener={() => opener.current?.focus()} />}
    </Dialog>
  );
}
