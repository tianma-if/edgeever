import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  tableAttachmentValues,
  tableCellDisplayText,
  type TableDocument,
  type TableField,
  type TableRecord,
} from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { isImageAttachment } from "@/components/table/table-cells";
import { ResourceImage } from "@/components/table/ResourceImage";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

const parseDay = (value: unknown): Date | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const primaryField = (document: TableDocument) => document.fields[0] ?? null;

const recordLabel = (document: TableDocument, record: TableRecord) => {
  const primary = primaryField(document);
  return primary ? tableCellDisplayText(primary, record.cells[primary.id] ?? null) || "" : "";
};

const secondaryFields = (document: TableDocument, exclude: string[]) =>
  document.fields.filter((field) => !exclude.includes(field.id) && field.type !== "attachment").slice(0, 3);

const coverResourceId = (document: TableDocument, record: TableRecord) => {
  for (const field of document.fields) {
    if (field.type !== "attachment") continue;
    const images = (tableAttachmentValues(record.cells[field.id] ?? null) ?? []).filter(isImageAttachment);
    if (images[0]) return images[0].resourceId;
  }
  return null;
};

type ViewProps = {
  document: TableDocument;
  records: TableRecord[];
  readOnly: boolean;
  onOpenRecord: (recordId: string) => void;
};

export const BaseCalendar = ({ document, records, onOpenRecord, dateFieldId, emptyLabel }: ViewProps & { dateFieldId: string | null; emptyLabel: string }) => {
  const { t } = useTranslation();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const field = document.fields.find((item) => item.id === dateFieldId) ?? null;
  const byDay = useMemo(() => {
    const map = new Map<string, TableRecord[]>();
    if (!field) return map;
    for (const record of records) {
      const value = record.cells[field.id];
      if (typeof value !== "string" || !value) continue;
      const list = map.get(value) ?? [];
      list.push(record);
      map.set(value, list);
    }
    return map;
  }, [field, records]);

  if (!field) {
    return <p className="p-6 text-sm text-muted-foreground" data-testid="base-calendar-empty">{emptyLabel}</p>;
  }

  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const start = new Date(firstDay.getTime() - offset * DAY_MS);
  const today = dayKey(new Date());
  const cells = Array.from({ length: 42 }, (_, index) => new Date(start.getTime() + index * DAY_MS));

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="base-calendar">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("structuredTable.calendarPrev")} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-32 text-sm font-medium">{cursor.getFullYear()} 年 {cursor.getMonth() + 1} 月</span>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("structuredTable.calendarNext")} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
          <ChevronRight className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { const now = new Date(); setCursor(new Date(now.getFullYear(), now.getMonth(), 1)); }}>
          {t("structuredTable.calendarToday")}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{field.name}</span>
      </div>
      <div className="grid grid-cols-7 border-b border-border bg-muted/30 text-xs text-muted-foreground">
        {WEEKDAY_LABELS.map((label) => <div key={label} className="px-2 py-1.5 text-center">{label}</div>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-7">
          {cells.map((day) => {
            const key = dayKey(day);
            const inMonth = day.getMonth() === cursor.getMonth();
            return (
              <div key={key} className={`min-h-24 border-b border-r border-border p-1 ${inMonth ? "bg-card" : "bg-muted/20"}`}>
                <div className={`mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs ${key === today ? "bg-sky-600 text-white" : inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                  {day.getDate()}
                </div>
                <div className="grid gap-1">
                  {(byDay.get(key) ?? []).slice(0, 3).map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      className="truncate rounded bg-sky-50 px-1.5 py-0.5 text-left text-xs text-sky-800 hover:bg-sky-100"
                      onClick={() => onOpenRecord(record.id)}
                    >
                      {recordLabel(document, record) || t("structuredTable.untitledRecord")}
                    </button>
                  ))}
                  {(byDay.get(key) ?? []).length > 3 ? <span className="px-1 text-xs text-muted-foreground">+{(byDay.get(key) ?? []).length - 3}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const BaseGallery = ({ document, records, onOpenRecord }: ViewProps) => {
  const { t } = useTranslation();
  const fields = secondaryFields(document, [primaryField(document)?.id ?? ""]);
  if (records.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground" data-testid="base-gallery-empty">{t("structuredTable.noCards")}</p>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="base-gallery">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {records.map((record) => {
          const cover = coverResourceId(document, record);
          return (
            <button
              key={record.id}
              type="button"
              className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm transition-shadow duration-150 hover:shadow-md"
              onClick={() => onOpenRecord(record.id)}
            >
              <span className="flex h-28 items-center justify-center overflow-hidden bg-muted/40">
                {cover ? <ResourceImage resourceId={cover} width={480} /> : <span className="text-xs text-muted-foreground">{t("structuredTable.noCover")}</span>}
              </span>
              <span className="grid gap-1 p-2">
                <span className="truncate text-sm font-medium">{recordLabel(document, record) || t("structuredTable.untitledRecord")}</span>
                {fields.map((field) => (
                  <span key={field.id} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="shrink-0">{field.name}</span>
                    <span className="truncate text-foreground">{tableCellDisplayText(field, record.cells[field.id] ?? null) || "—"}</span>
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const DAY_WIDTH = 24;
const NAME_WIDTH = 200;

export const BaseGantt = ({ document, records, onOpenRecord, startFieldId, endFieldId, emptyLabel }: ViewProps & { startFieldId: string | null; endFieldId: string | null; emptyLabel: string }) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startField = document.fields.find((field) => field.id === startFieldId) ?? null;
  const endField = document.fields.find((field) => field.id === endFieldId) ?? null;
  const title = document.fields[0] ?? null;

  const bars = useMemo(() => {
    if (!startField) return [];
    return records.flatMap((record) => {
      const from = parseDay(record.cells[startField.id]);
      if (!from) return [];
      const to = endField ? parseDay(record.cells[endField.id]) : null;
      const end = to && to >= from ? to : from;
      return [{ record, from, end }];
    });
  }, [endField, records, startField]);
  const scheduleById = useMemo(() => new Map(bars.map((bar) => [bar.record.id, bar] as const)), [bars]);

  if (!startField) {
    return <p className="p-6 text-sm text-muted-foreground" data-testid="base-gantt-empty">{emptyLabel}</p>;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDay = bars.reduce((min, bar) => (bar.from < min ? bar.from : min), today);
  const maxDay = bars.reduce((max, bar) => (bar.end > max ? bar.end : max), today);
  const rangeStart = new Date(minDay.getTime() - 3 * DAY_MS);
  const rangeEnd = new Date(maxDay.getTime() + 10 * DAY_MS);
  const days = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS) + 1);
  const columns = Array.from({ length: days }, (_, index) => new Date(rangeStart.getTime() + index * DAY_MS));
  const months: { label: string; span: number }[] = [];
  for (const day of columns) {
    const label = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}`;
    const last = months[months.length - 1];
    if (last?.label === label) last.span += 1;
    else months.push({ label, span: 1 });
  }
  const offsetDays = (date: Date) => Math.round((date.getTime() - rangeStart.getTime()) / DAY_MS);
  const todayOffset = offsetDays(today);
  const timelineWidth = days * DAY_WIDTH;
  const firstBarOffset = bars.reduce<number | null>((min, bar) => {
    const offset = offsetDays(bar.from);
    return min === null || offset < min ? offset : min;
  }, null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || firstBarOffset === null) return;
    node.scrollLeft = Math.max(0, firstBarOffset * DAY_WIDTH - 96);
  }, [firstBarOffset]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="base-gantt">
      <div ref={scrollRef} className="flex min-h-0 flex-1 overflow-auto">
        <div className="sticky left-0 z-10 flex shrink-0 flex-col border-r border-border bg-card" style={{ width: NAME_WIDTH }}>
          <div className="flex h-9 items-center border-b border-border px-2 text-xs text-muted-foreground">
            <span className="truncate">{title?.name ?? t("structuredTable.ganttTask")}</span>
          </div>
          {records.map((record) => {
            const scheduled = scheduleById.has(record.id);
            return (
              <button
                key={record.id}
                type="button"
                className="flex h-9 items-center gap-1 border-b border-border px-2 text-left text-sm hover:bg-muted/40"
                data-testid={scheduled ? "base-gantt-scheduled" : "base-gantt-unscheduled"}
                onClick={() => onOpenRecord(record.id)}
              >
                <span className="truncate">{recordLabel(document, record) || t("structuredTable.untitledRecord")}</span>
                {scheduled ? null : (
                  <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t("structuredTable.ganttUnscheduled")}</span>
                )}
              </button>
            );
          })}
          {records.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("structuredTable.noCards")}</p> : null}
        </div>
        <div className="relative shrink-0" style={{ width: timelineWidth }}>
          <div className="sticky top-0 z-10 bg-card">
            <div className="flex h-5 border-b border-border">
              {months.map((month) => (
                <div key={month.label} className="shrink-0 border-r border-border px-1 text-[11px] leading-5 text-muted-foreground" style={{ width: month.span * DAY_WIDTH }}>
                  {month.label}
                </div>
              ))}
            </div>
            <div className="flex h-4 border-b border-border">
              {columns.map((day) => (
                <div key={day.toISOString()} className="shrink-0 border-r border-border/60 text-center text-[10px] leading-4 text-muted-foreground" style={{ width: DAY_WIDTH }}>
                  {day.getDate()}
                </div>
              ))}
            </div>
          </div>
          {bars.length === 0 && records.length > 0 ? (
            <p className="absolute left-4 top-12 text-sm text-muted-foreground">{t("structuredTable.ganttHint")}</p>
          ) : null}
          {todayOffset >= 0 && todayOffset < days ? (
            <div className="pointer-events-none absolute bottom-0 top-9 z-0 w-px bg-sky-500" style={{ left: todayOffset * DAY_WIDTH + DAY_WIDTH / 2 }} />
          ) : null}
          {records.map((record) => {
            const bar = scheduleById.get(record.id);
            if (!bar) {
              return <div key={record.id} className="h-9 border-b border-border bg-muted/10" />;
            }
            const left = offsetDays(bar.from) * DAY_WIDTH + 4;
            const width = Math.max(DAY_WIDTH - 8, (offsetDays(bar.end) - offsetDays(bar.from) + 1) * DAY_WIDTH - 8);
            const span = Math.max(1, Math.round((bar.end.getTime() - bar.from.getTime()) / DAY_MS) + 1);
            return (
              <div key={record.id} className="relative h-9 border-b border-border">
                <button
                  type="button"
                  className="absolute top-1.5 flex h-6 items-center overflow-hidden rounded bg-sky-500/90 px-1.5 text-[11px] text-white hover:bg-sky-600"
                  style={{ left, width }}
                  aria-label={recordLabel(document, record) || t("structuredTable.untitledRecord")}
                  onClick={() => onOpenRecord(record.id)}
                >
                  {width >= 44 ? <span className="truncate">{`${span} ${t("structuredTable.ganttDays")}`}</span> : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const dateFieldCandidates = (fields: TableField[]) => fields.filter((field) => field.type === "date");