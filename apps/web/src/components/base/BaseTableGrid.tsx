import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronRight, Copy, Maximize2, Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  addTableRecord,
  applyTableView,
  duplicateTableRecord,
  insertTableRecord,
  groupTableRecords,
  isTableMultiSelectValue,
  removeTableRecord,
  tableAttachmentValues,
  resolveTableViewColumns,
  tableCellDisplayText,
  updateTableCell,
  type NamedTableView,
  type TableCellValue,
  type TableDocument,
  type TableField,
  type TableRecord,
} from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  attachmentItems,
  isImageAttachment,
  attachmentUploadKey,
  displayCell,
  FieldHeader,
  RecordCell,
  type AttachmentUploadState,
  type EditingCell,
} from "@/components/table/table-cells";
import { ResourceImage } from "@/components/table/ResourceImage";
import { OptionPill, optionColor, optionDotClassName } from "@/components/table/option-pill";
import type { EdgeEverRepository } from "@/lib/repository";

const ROW_HEIGHT = 32;
const ROW_OVERSCAN = 8;
const INDEX_WIDTH = 44;
const ACTION_WIDTH = 44;
const ATTACHMENT_WIDTH = 240;
const FIELD_WIDTH = 160;

type BaseTableGridProps = {
  document: TableDocument;
  view: NamedTableView;
  readOnly: boolean;
  memoId: string;
  repository: EdgeEverRepository;
  onChange: (next: TableDocument) => void;
  onExpandRecord: (recordId: string) => void;
  /** Phones hide hover-only affordances and promote them to always - visible controls. */
  compact?: boolean;
  uploads: Map<string, AttachmentUploadState>;
  onUploadState: (key: string, state: AttachmentUploadState | undefined) => void;
  onConfigureField?: (field: TableField) => void;
  /** Drag the header or use the header menu to reorder columns. */
  /** Drag the right edge of a header to resize the column. */
  onResizeColumn?: (fieldId: string, width: number) => void;
  /** Records with computed createdTime/updatedTime cells filled in, keyed by record id. */
  computedRecords?: Map<string, TableRecord> | null;
};

export const BaseTableGrid = ({
  document,
  view,
  readOnly,
  memoId,
  repository,
  onChange,
  onExpandRecord,
  compact = false,
  uploads,
  onUploadState,
  onConfigureField,
  onResizeColumn,
  computedRecords,
}: BaseTableGridProps) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [widthDraft, setWidthDraft] = useState<{ fieldId: string; width: number } | null>(null);
  const resizeRef = useRef<{ fieldId: string; startX: number; startWidth: number } | null>(null);
  // The drag source must be readable synchronously during dragover: React state is not committed yet.
  const draftRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const editingRef = useRef<EditingCell | null>(null);
  editingRef.current = editing;

  const records = useMemo(() => applyTableView(document, document.records, view), [document, view]);
  const groups = useMemo(() => view.groupBy ? groupTableRecords(document, records, view.groupBy, { includeEmpty: false }) : [], [document, records, view.groupBy]);
  const columns = useMemo(() => resolveTableViewColumns(document.fields, view), [document.fields, view]);
  const visibleColumns = useMemo(() => columns.filter((column) => !column.hidden), [columns]);
  const visibleFields = useMemo(() => visibleColumns
    .map((column) => document.fields.find((field) => field.id === column.fieldId))
    .filter((field): field is TableField => Boolean(field)), [document.fields, visibleColumns]);
  const widths = useMemo(() => visibleColumns.map((column) => (widthDraft?.fieldId === column.fieldId ? widthDraft.width : undefined) ?? column.width
    ?? (document.fields.find((field) => field.id === column.fieldId)?.type === "attachment" ? ATTACHMENT_WIDTH : FIELD_WIDTH)),
  [document.fields, visibleColumns, widthDraft]);
  const indicesById = useMemo(() => {
    const map = new Map<string, number>();
    document.records.forEach((record, index) => map.set(record.id, index));
    return map;
  }, [document.records]);

  type Row = { type: "group"; key: string; count: number } | { type: "record"; record: TableRecord };
  const rows = useMemo<Row[]>(() => {
    if (!view.groupBy || !groups.length) return records.map((record) => ({ type: "record" as const, record }));
    return groups.flatMap((group) => {
      const header: Row = { type: "group", key: group.key, count: group.records.length };
      if (collapsed.has(group.key)) return [header];
      return [header, ...group.records.map((record) => ({ type: "record" as const, record }))];
    });
  }, [collapsed, groups, records, view.groupBy]);

  const rowIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => { if (row.type === "record") map.set(row.record.id, index); });
    return map;
  }, [rows]);
  const editingIndex = editing ? rowIndex.get(editing.recordId) : undefined;
  const focusedIndex = focusedRecordId ? rowIndex.get(focusedRecordId) : undefined;
  const rangeExtractor = useCallback((range: Range) => {
    const indices = new Set(defaultRangeExtractor(range));
    if (editingIndex !== undefined) indices.add(editingIndex);
    if (focusedIndex !== undefined) indices.add(focusedIndex);
    return [...indices].sort((left, right) => left - right);
  }, [editingIndex, focusedIndex]);
  const keyOf = useCallback((index: number) => {
    const row = rows[index];
    return !row || row.type === "group" ? `group:${row?.key ?? index}` : row.record.id;
  }, [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: ROW_OVERSCAN,
    getItemKey: keyOf,
    rangeExtractor,
    useAnimationFrameWithResizeObserver: true,
  });
  const virtualRows = virtualizer.getVirtualItems();

  useEffect(() => {
    // Close the inline editor when the view or its column set changes underneath it.
    setEditing(null);
    editingRef.current = null;
  }, [view.id, visibleFields.length]);

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditing(null);
        editingRef.current = null;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing]);

  const change = (next: TableDocument) => onChange(next);
  const commitEditing = (value: string) => {
    const cell = editingRef.current;
    if (!cell) return;
    change(updateTableCell(document, cell.recordId, cell.fieldId, value));
    setEditing(null);
    editingRef.current = null;
  };
  const toggleGroup = (key: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const addRecord = () => change(addTableRecord(document));
  const onInsertRow = (recordId: string, offset: 1 | -1) => {
    const index = document.records.findIndex((record) => record.id === recordId);
    if (index < 0) return;
    change(insertTableRecord(document, index + (offset > 0 ? 1 : 0)));
  };
  const onDuplicateRecord = (recordId: string) => change(duplicateTableRecord(document, recordId));
  const onDeleteRecord = (recordId: string) => {
    change(removeTableRecord(document, recordId));
    if (focusedRecordId === recordId) setFocusedRecordId(null);
  };
  const removeRecord = (recordId: string) => {
    if (editingRef.current?.recordId === recordId) setEditing(null);
    change(removeTableRecord(document, recordId));
  };

  const renderRowActions = (recordId: string) => (
    <div className="flex items-center justify-end gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        aria-label={t("structuredTable.expandRecord")}
        onClick={() => onExpandRecord(recordId)}
      >
        <Maximize2 className="size-3.5" />
      </Button>
      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label={t("structuredTable.deleteRecord")}
          onClick={() => removeRecord(recordId)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );

  const renderRecordCell = (field: TableField, source: TableRecord) => {
    const record = computedRecords?.get(source.id) ?? source;
    const active = editing?.recordId === record.id && editing.fieldId === field.id;
    const key = attachmentUploadKey(record.id, field.id);
    return (
      <RecordCell
        document={document}
        field={field}
        record={record}
        recordIndex={indicesById.get(record.id) ?? 0}
        active={active}
        readOnly={readOnly}
        onEdit={(cell) => {
          setEditing(cell);
          editingRef.current = cell;
          setFocusedRecordId(record.id);
        }}
        memoId={memoId}
        repository={repository}
        onCommit={commitEditing}
        onDraft={(value) => { draftRef.current = value; }}
        onChange={change}
        onAdd={(attachment) => {
          const next = [...attachmentItems(record.cells[field.id] ?? null), attachment];
          onChange(updateTableCell(document, record.id, field.id, next));
          return true;
        }}
        onRemove={(resourceId) => {
          const next = attachmentItems(record.cells[field.id] ?? null).filter((item) => item.resourceId !== resourceId);
          onChange(updateTableCell(document, record.id, field.id, next));
        }}
        onUploaded={() => undefined}
        uploadState={field.type === "attachment" ? uploads.get(key) : undefined}
        onUploadState={(state) => onUploadState(key, state)}
      />
    );
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm" data-testid="base-grid">
          <colgroup>
            <col style={{ width: INDEX_WIDTH }} />
            {visibleFields.map((field, index) => <col key={field.id} style={{ width: widths[index] }} />)}
            <col style={{ width: ACTION_WIDTH }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-muted/60">
            <tr>
              <th scope="col" className="sticky left-0 z-20 h-9 border-b border-r border-border bg-muted/80 px-2 text-xs font-normal text-muted-foreground">
                <span className="sr-only">{t("structuredTable.rowIndex")}</span>#
              </th>
              {visibleFields.map((field, index) => {
                return (
                  <th
                    key={field.id}
                    scope="col"
                    data-testid="column-header"
                    data-field-id={field.id}
                    className="relative h-9 border-b border-r border-border px-1 text-left font-normal"
                  >
                    <FieldHeader
                      document={document}
                      field={field}
                      readOnly={readOnly}
                      onChange={change}
                      onConfigure={onConfigureField}
                    />
                    {readOnly || !onResizeColumn ? null : (
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={t("structuredTable.resizeColumn", { name: field.name })}
                        data-testid="column-resize-handle"
                        className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-sky-500/40"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          resizeRef.current = { fieldId: field.id, startX: event.clientX, startWidth: widths[index] };
                          setWidthDraft({ fieldId: field.id, width: widths[index] });
                        }}
                        onPointerMove={(event) => {
                          const active = resizeRef.current;
                          if (!active || active.fieldId !== field.id) return;
                          const next = Math.max(80, Math.min(600, active.startWidth + event.clientX - active.startX));
                          setWidthDraft({ fieldId: field.id, width: Math.round(next) });
                        }}
                        onPointerUp={(event) => {
                          const active = resizeRef.current;
                          resizeRef.current = null;
                          if (!active) return;
                          const width = Math.round(Math.max(80, Math.min(600, active.startWidth + event.clientX - active.startX)));
                          setWidthDraft(null);
                          if (width !== active.startWidth) onResizeColumn(active.fieldId, width);
                        }}
                        onPointerCancel={() => { resizeRef.current = null; setWidthDraft(null); }}
                      />
                    )}
                  </th>
                );
              })}
              <th scope="col" className="sticky right-0 z-20 h-9 border-b border-l border-border bg-muted/80 px-1">
                {!readOnly && (
                  <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t("structuredTable.addRecord")} onClick={addRecord}>
                    <Plus className="size-4" />
                  </Button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr aria-hidden="true" style={{ height: virtualRows[0]?.start ?? 0 }} />
            {virtualRows.map((item, position) => {
              const row = rows[item.index];
              if (!row) return null;
              const gap = item.start - (virtualRows[position - 1]?.end ?? 0);
              return (
                <RowPair key={item.key} gap={gap} span={visibleFields.length + 2}>
                  {row.type === "group" ? (
                    <tr data-testid="base-group-row" data-group-key={row.key}>
                      <td colSpan={visibleFields.length + 2} className="border-b border-border bg-muted/40 px-2 py-1">
                        <button
                          type="button"
                          className="flex w-full items-center gap-1 text-left text-xs font-medium text-foreground"
                          aria-expanded={!collapsed.has(row.key)}
                          onClick={() => toggleGroup(row.key)}
                        >
                          {collapsed.has(row.key) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                          {(() => {
                            const groupField = groupFieldOf(view, document);
                            return groupField ? (
                              <span className={`size-2 rounded-full ${optionDotClassName(groupField, row.key)}`} aria-hidden="true" />
                            ) : null;
                          })()}
                          <span className="truncate">{row.key || t("structuredTable.emptyGroup")}</span>
                          <span className="text-muted-foreground">{row.count}</span>
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                    <tr
                      data-testid="base-record-row"
                      data-record-id={row.record.id}
                      className="group/row hover:bg-muted/30"
                      style={{ height: ROW_HEIGHT }}
                      onFocus={() => setFocusedRecordId(row.record.id)}
                    >
                      <td className="sticky left-0 z-10 border-b border-r border-border bg-card px-0 text-center text-xs tabular-nums text-muted-foreground group-hover/row:bg-muted/30">
                        {compact ? (
                          <button
                            type="button"
                            data-testid="base-row-index"
                            aria-label={t("structuredTable.expandRecord")}
                            onClick={() => onExpandRecord(row.record.id)}
                            className="flex h-full min-h-8 w-full items-center justify-center"
                          >
                            {(indicesById.get(row.record.id) ?? 0) + 1}
                          </button>
                        ) : (
                          <span className="block px-2">{(indicesById.get(row.record.id) ?? 0) + 1}</span>
                        )}
                      </td>
                      {visibleFields.map((field) => (
                        <td
                          key={field.id}
                          className="max-w-0 border-b border-r border-border px-0 align-middle"
                          onClick={() => setFocusedRecordId(row.record.id)}
                          onDoubleClick={() => onExpandRecord(row.record.id)}
                        >
                          {renderRecordCell(field, row.record)}
                        </td>
                      ))}
                      <td className="sticky right-0 z-10 border-b border-l border-border bg-card px-1 align-middle group-hover/row:bg-muted/30">
                        <div className={compact ? "" : "opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100"}>
                          {renderRowActions(row.record.id)}
                        </div>
                      </td>
                    </tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-48">
                        <ContextMenuItem onSelect={() => onInsertRow(row.record.id, -1)}>
                          <ArrowUpToLine className="mr-2 size-3.5" />{t("structuredTable.insertRowAbove")}
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => onInsertRow(row.record.id, 1)}>
                          <ArrowDownToLine className="mr-2 size-3.5" />{t("structuredTable.insertRowBelow")}
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => onDuplicateRecord(row.record.id)}>
                          <Copy className="mr-2 size-3.5" />{t("structuredTable.duplicateRecord")}
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => onExpandRecord(row.record.id)}>
                          <Maximize2 className="mr-2 size-3.5" />{t("structuredTable.recordDetails")}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => onDeleteRecord(row.record.id)}>
                          <Trash2 className="mr-2 size-3.5" />{t("structuredTable.deleteRecord")}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  )}
                </RowPair>
              );
            })}
            <tr aria-hidden="true" style={{ height: (virtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0)) || 0 }} />
          </tbody>
        </table>
        {!readOnly && (
          <button
            type="button"
            className="flex h-9 w-full items-center gap-1.5 border-b border-border px-3 text-left text-xs text-muted-foreground hover:bg-muted/30"
            onClick={addRecord}
          >
            <Plus className="size-3.5" />
            {t("structuredTable.addRecord")}
          </button>
        )}
      </div>
      {!rows.length && !document.records.length ? (
        <p className="pointer-events-none absolute inset-x-0 top-14 text-center text-sm text-muted-foreground">{t("structuredTable.noCards")}</p>
      ) : null}
    </div>
  );
};

const RowPair = ({ gap, span, children }: { gap: number; span: number; children: ReactNode }) => (
  <>
    {gap > 0 ? <tr aria-hidden="true"><td colSpan={span} style={{ height: gap }} /></tr> : null}
    {children}
  </>
);

const groupFieldOf = (view: NamedTableView, document: TableDocument) =>
  view.groupBy ? document.fields.find((field) => field.id === view.groupBy?.fieldId) : undefined;

const kanbanCoverResourceId = (document: TableDocument, record: TableRecord) => {
  for (const field of document.fields) {
    if (field.type !== "attachment") continue;
    const image = (tableAttachmentValues(record.cells[field.id] ?? null) ?? []).find(isImageAttachment);
    if (image) return image.resourceId;
  }
  return null;
};

const shortDate = (text: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return text;
  const currentYear = String(new Date().getFullYear());
  return match[1] === currentYear ? `${Number(match[2])}月${Number(match[3])}日` : `${Number(match[2])}月${Number(match[3])}日`;
};

type BaseKanbanProps = {
  document: TableDocument;
  view: NamedTableView;
  readOnly: boolean;
  onOpenRecord: (recordId: string) => void;
  onChange: (next: TableDocument) => void;
  /** Phones open the record from anywhere on the card instead of from a hover icon. */
  compact?: boolean;
};

export const BaseKanban = ({ document, view, readOnly, onOpenRecord, onChange, compact = false }: BaseKanbanProps) => {
  const { t } = useTranslation();
  const groupField = view.groupBy ? document.fields.find((field) => field.id === view.groupBy?.fieldId) : undefined;
  const records = useMemo(() => applyTableView(document, document.records, view), [document, view]);
  const groups = useMemo(() => view.groupBy && groupField?.type === "select"
    ? groupTableRecords(document, records, view.groupBy, { includeEmpty: true })
    : [], [document, groupField?.type, records, view.groupBy]);
  const primary = document.fields[0];
  const secondary = document.fields
    .filter((field) => field.id !== primary?.id && field.id !== view.groupBy?.fieldId && field.type !== "attachment")
    .slice(0, 3);

  if (!groupField || groupField.type !== "select") {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground" data-testid="base-kanban">
        {t("structuredTable.kanbanNeedSelect")}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden p-3" data-testid="base-kanban">
      {groups.map((group) => (
        <section key={group.key} className="flex min-h-0 w-64 shrink-0 flex-col rounded-lg bg-muted/40">
          <header className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-foreground">
            <span
              className={`size-2 rounded-full ${groupField ? optionDotClassName(groupField, group.key) : "bg-slate-400"}`}
              data-option-color={groupField ? optionColor(groupField, group.key) : "gray"}
              aria-hidden="true"
            />
            <span className="truncate">{group.key || t("structuredTable.emptyGroup")}</span>
            <span className="text-muted-foreground">{group.records.length}</span>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
            {group.records.map((record) => {
              const cover = kanbanCoverResourceId(document, record);
              return (
                <article
                  key={record.id}
                  className="overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow duration-150 hover:shadow-md"
                  style={{ contain: "paint" }}
                  onClick={compact ? () => onOpenRecord(record.id) : undefined}
                >
                  {cover ? (
                    <button type="button" className="block h-24 w-full overflow-hidden bg-muted/40" onClick={() => onOpenRecord(record.id)} aria-label={t("structuredTable.recordDetails")}>
                      <ResourceImage resourceId={cover} width={480} />
                    </button>
                  ) : null}
                  <div className="p-2">
                    <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => onOpenRecord(record.id)}>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {primary ? displayCell(primary, record.cells[primary.id] ?? null, document.records.indexOf(record)) || t("structuredTable.untitledRecord") : t("structuredTable.untitledRecord")}
                      </span>
                      <Maximize2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {secondary.map((field) => {
                        const value = record.cells[field.id] ?? null;
                        if (field.type === "select" && typeof value === "string" && value) {
                          return <OptionPill key={field.id} field={field} option={value} className="px-1.5 py-0.5 text-[11px]" />;
                        }
                        if (field.type === "multiSelect" && isTableMultiSelectValue(value) && value.length > 0) {
                          return value.slice(0, 2).map((option) => <OptionPill key={`${field.id}-${option}`} field={field} option={option} className="px-1.5 py-0.5 text-[11px]" />);
                        }
                        const text = field.type === "checkbox"
                          ? (value === true ? t("structuredTable.checked") : "")
                          : tableCellDisplayText(field, value);
                        if (!text) return null;
                        return (
                          <span key={field.id} className="inline-flex max-w-full items-center gap-1 truncate rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground" title={`${field.name}: ${text}`}>
                            <span className="text-muted-foreground/70">{field.name}</span>
                            <span className="truncate text-foreground">{field.type === "date" ? shortDate(text) : text}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </article>
              );
            })}
            {!readOnly && (
              <button
                type="button"
                className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-card"
                onClick={() => {
                  const created = addTableRecord(document);
                  const record = created.records[created.records.length - 1];
                  if (!record || !groupField) { onChange(created); return; }
                  onChange(updateTableCell(created, record.id, groupField.id, group.key || null));
                }}
              >
                <Plus className="size-3.5" />
                {t("structuredTable.addRecord")}
              </button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
};

export const BaseRecordPanel = ({
  document,
  record: computedRecord,
  recordId,
  readOnly,
  onClose,
  onChange,
  onDelete,
  overlay = false,
}: {
  document: TableDocument;
  record?: TableRecord | null;
  recordId: string;
  readOnly: boolean;
  onClose: () => void;
  onChange: (next: TableDocument) => void;
  onDelete: () => void;
  /** On phones the panel covers the grid instead of sitting beside it. */
  overlay?: boolean;
}) => {
  const { t } = useTranslation();
  const stored = document.records.find((item) => item.id === recordId);
  if (!stored) return null;
  const record = computedRecord ?? stored;
  const index = document.records.indexOf(stored);
  const primary = document.fields[0];
  const commit = (field: TableField, value: TableCellValue) => {
    if (readOnly) return;
    onChange(updateTableCell(document, stored.id, field.id, value));
  };
  return (
    <aside
      className={overlay
        ? "absolute inset-0 z-30 flex w-full flex-col overflow-y-auto border-l border-border bg-card md:static md:z-auto md:w-[360px] md:overflow-visible"
        : "flex w-[360px] shrink-0 flex-col border-l border-border bg-card"}
      data-testid="base-record-panel"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {primary ? displayCell(primary, record.cells[primary.id] ?? null, index) || t("structuredTable.recordDetails") : t("structuredTable.recordDetails")}
        </h2>
        <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={t("structuredTable.closePanel")} onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <dl className="grid gap-3">
          {document.fields.map((field) => {
            const value = record.cells[field.id] ?? null;
            if (field.type === "autoNumber" || field.type === "createdTime" || field.type === "updatedTime") {
              const text = tableCellDisplayText(field, value, index);
              return (
                <div key={field.id} className="grid gap-1 text-sm" data-testid={`panel-computed-${field.type}`}>
                  <dt className="text-xs text-muted-foreground">{field.name}</dt>
                  <dd className="truncate text-slate-600">{text || "—"}</dd>
                </div>
              );
            }
            if (field.type === "attachment") {
              return (
                <div key={field.id} className="grid gap-1 text-sm">
                  <dt className="text-xs text-muted-foreground">{field.name}</dt>
                  <dd>{attachmentItems(value).map((item) => item.filename).join(", ") || "—"}</dd>
                </div>
              );
            }
            if (field.type === "checkbox") {
              return (
                <div key={field.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={value === true} disabled={readOnly} aria-label={field.name} onCheckedChange={(checked) => commit(field, checked === true)} />
                  <span className="text-xs text-muted-foreground">{field.name}</span>
                </div>
              );
            }
            if (field.type === "select") {
              const picked = typeof value === "string" ? value : "";
              return (
                <div key={field.id} className="grid gap-1 text-sm">
                  <span className="text-xs text-muted-foreground">{field.name}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex min-h-8 w-full items-center gap-1 rounded-md border border-transparent px-1 py-0.5 text-left hover:border-border hover:bg-muted/40"
                        aria-label={field.name}
                        disabled={readOnly}
                      >
                        {picked
                          ? <OptionPill field={field} option={picked} />
                          : <span className="text-xs text-muted-foreground">{t("structuredTable.selectPlaceholder")}</span>}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                      {(field.options ?? []).map((option) => (
                        <DropdownMenuItem key={option} onSelect={() => commit(field, option)} className="gap-2">
                          <span className={`size-2 rounded-full ${optionDotClassName(field, option)}`} aria-hidden="true" />
                          <span className="truncate">{option}</span>
                        </DropdownMenuItem>
                      ))}
                      {picked ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => commit(field, null)}>{t("structuredTable.clearValue")}</DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            }
            if (field.type === "multiSelect") {
              const selected = isTableMultiSelectValue(value) ? value : [];
              return (
                <fieldset key={field.id} className="grid gap-1 text-sm">
                  <legend className="text-xs text-muted-foreground">{field.name}</legend>
                  <div className="flex flex-wrap gap-2">
                    {(field.options ?? []).map((option) => (
                      <label key={option} className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={selected.includes(option)} disabled={readOnly} aria-label={`${field.name} ${option}`}
                          onCheckedChange={(checked) => commit(field, checked === true ? [...selected, option] : selected.filter((item) => item !== option))} />
                        <OptionPill field={field} option={option} />
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            }
            const inputType = field.type === "number" ? "number" : field.type === "date" ? "date"
              : field.type === "url" ? "url" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text";
            return (
              <label key={field.id} className="grid gap-1 text-sm">
                <span className="text-xs text-muted-foreground">{field.name}</span>
                <Input
                  type={inputType}
                  aria-label={field.name}
                  disabled={readOnly}
                  defaultValue={typeof value === "string" || typeof value === "number" ? String(value) : ""}
                  onBlur={(event) => commit(field, event.target.value)}
                />
              </label>
            );
          })}
        </dl>
      </div>
      {!readOnly && (
        <footer className="border-t border-border p-2">
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start text-destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
            {t("structuredTable.deleteRecord")}
          </Button>
        </footer>
      )}
    </aside>
  );
};