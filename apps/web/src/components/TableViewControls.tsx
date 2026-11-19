import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp, Filter, MoreHorizontal, Plus, Table2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  createTableId, isValidTypedTableFilter, tableFilterNeedsValue, TABLE_VIEW_FILTER_LIMIT, TABLE_VIEW_OPERATORS,
  type NamedTableView, type TableField, type TableViewFilter, type TableViewOperator, type TableViewSort,
} from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Mode = "filter" | "sort" | "new" | "copy" | "rename" | "delete";
type FilterDraft = { id: number; rule: TableViewFilter };
type Props = {
  fields: TableField[];
  views: NamedTableView[];
  active: NamedTableView;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onCommit: (views: NamedTableView[], selected: string) => Promise<boolean>;
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
    else onChange({ ...rule, value: field.type === "number" ? next === "" ? undefined : Number(next) : field.type === "checkbox" ? next === "true" : next });
  };
  if (field.type === "checkbox" && rule.operator === "eq") {
    return (
      <select className={selectClass} value={String(value === "true")} onChange={(event) => change(event.target.value)} aria-label={label}>
        <option value="false">{t("structuredTable.views.unchecked")}</option>
        <option value="true">{t("structuredTable.views.checked")}</option>
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
  const type = field.type === "number" && (!rule.legacy || (rule.operator === "eq" && Number.isFinite(Number(value)))) ? "number"
    : field.type === "date" && (!rule.legacy || (rule.operator === "eq" && /^\d{4}-\d{2}-\d{2}$/.test(value))) ? "date" : "text";
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

function ViewDialog({ mode, fields, views, active, readOnly, onCommit, close, focusOpener }: Props & {
  mode: Mode; close: () => void; focusOpener: () => void;
}) {
  const { t } = useTranslation();
  const label = (view: NamedTableView) => view.name || t("structuredTable.views.default");
  const [name, setName] = useState(() => mode === "copy" ? t("structuredTable.views.copyName", { name: label(active) }) : mode === "rename" ? label(active) : "");
  const [match, setMatch] = useState(active.match);
  const nextId = useRef(active.filters.length);
  const [filters, setFilters] = useState<FilterDraft[]>(() => active.filters.map((rule, id) => ({ id, rule })));
  const [sorts, setSorts] = useState(active.sorts);
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
    : mode === "sort" ? sorts.every((rule) => byId.has(rule.fieldId)) : views.length > 1;

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
          : mode === "sort" ? { sorts } : { name }),
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
  const unusedSortField = fields.find((field) => !sorts.some((sort) => sort.fieldId === field.id));
  const title = mode === "filter" || mode === "sort" ? t(`structuredTable.${mode}`) : t(`structuredTable.views.${mode}`);
  return (
    <DialogContent className="w-[calc(100%-1.5rem)] max-w-2xl p-4 sm:p-6" showCloseButton={false}
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
  const opener = useRef<HTMLButtonElement | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const open = (next: Mode, button: HTMLButtonElement | null) => {
    opener.current = button;
    setMode(next);
  };
  return (
    <Dialog open={mode !== null} onOpenChange={(open) => { if (!open) setMode(null); }}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="group" aria-label={t("structuredTable.views.label")}>
            {views.map((view) => (
              <button type="button" key={view.id} aria-pressed={view.id === active.id} onClick={() => onSelect(view.id)}
                className="flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:border-foreground aria-pressed:font-medium aria-pressed:text-foreground">
                <Table2 aria-hidden="true" className="size-3.5" />
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
        <div className="flex shrink-0 items-center gap-1 py-1">
          {(["filter", "sort"] as const).map((item) => {
            const count = item === "filter" ? active.filters.length : active.sorts.length;
            const Icon = item === "filter" ? Filter : ArrowDownUp;
            return (
              <Button key={item} type="button" size="sm" variant={count ? "soft" : "ghost"}
                onClick={(event) => open(item, event.currentTarget)}>
                <Icon className="size-3.5" /> {t(`structuredTable.${item}`)}
                {count > 0 && <span className="tabular-nums">{count}</span>}
              </Button>
            );
          })}
        </div>
      </div>
      {mode && <ViewDialog key={`${active.id}:${mode}`} {...props} mode={mode} close={() => setMode(null)} focusOpener={() => opener.current?.focus()} />}
    </Dialog>
  );
}
