import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronLeft,
  Columns3,
  Download,
  Filter,
  Group,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Redo2,
  RefreshCw,
  Table2,
  Trash2,
  Undo2,
  Upload,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  addTableField,
  addTableToBase,
  addTableRecord,
  appendTableRecordsFromCsv,
  applyTableView,
  computeTableBase,
  getTableViews,
  markdownToDoc,
  parseTableBaseDocument,
  removeTableFromBase,
  removeTableRecord,
  renameTableInBase,
  saveTableViews,
  setTableViewColumnWidth,
  serializeTableBaseDocument,
  setActiveTableInBase,
  tableBaseFallbackMarkdown,
  tableDocumentToCsv,
  tableBaseTableDocument,
  TABLE_BASE_TABLE_LIMIT,
  TABLE_VIEW_LAYOUTS,
  TABLE_FIELD_LIMIT,
  TABLE_RECORD_LIMIT,
  updateTableBaseTable,
  updateTableField,
  type MemoDetail,
  type MemoEditSession,
  type NamedTableView,
  type TableBaseDocument,
  type TableDocument,
  type TableViewLayout,
} from "@edgeever/shared";
import { MemoTitleInput } from "@/components/MemoTitleInput";
import { BaseCalendar, BaseGallery, BaseGantt, dateFieldCandidates } from "@/components/base/BaseViews";
import { BaseKanban, BaseRecordPanel, BaseTableGrid } from "@/components/base/BaseTableGrid";
import { BaseFieldDialog, type FieldDialogState } from "@/components/base/BaseFieldDialog";
import { LAYOUT_META, TableViewControls, type TableViewDialogMode } from "@/components/TableViewControls";
import type { AttachmentUploadState } from "@/components/table/table-cells";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createLocalEditSession } from "@/components/editor/editor-pane-helpers";
import { useCompactViewport } from "@/hooks/useCompactViewport";
import { api } from "@/lib/api";
import { EDITOR_LOCAL_SAVE_DELAY_MS } from "@/lib/app-helpers";
import { isLocalMemoId } from "@/lib/local-mirror";
import { isBrowserOffline } from "@/lib/network-status";
import type { EdgeEverRepository } from "@/lib/repository";

type BaseEditorPaneProps = {
  memo: MemoDetail;
  repository: EdgeEverRepository;
  readOnly: boolean;
  onBackToList: () => void;
  onSaved: (memo: MemoDetail) => Promise<void>;
};

type BaseDraft = { title: string; base: TableBaseDocument };

const viewSelectionKey = (memoId: string, tableId: string) => `edgeever.base-view.v1:${memoId}:${tableId}`;
const readBaseViewSelection = (memoId: string, tableId: string) => {
  try { return window.localStorage.getItem(viewSelectionKey(memoId, tableId)); } catch { return null; }
};

const serializeCache = new WeakMap<TableBaseDocument, string>();
const markdownFor = (base: TableBaseDocument) => {
  const cached = serializeCache.get(base);
  if (cached !== undefined) return cached;
  const markdown = serializeTableBaseDocument(base);
  serializeCache.set(base, markdown);
  return markdown;
};
const isSameDraft = (left: BaseDraft | null, right: BaseDraft) =>
  left?.title === right.title && (left.base === right.base || markdownFor(left.base) === markdownFor(right.base));

export const BaseEditorPane = ({ memo, repository, readOnly, onBackToList, onSaved }: BaseEditorPaneProps) => {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseTableBaseDocument(memo.contentMarkdown), [memo.contentMarkdown]);
  const [title, setTitle] = useState(memo.title ?? "");
  const [base, setBase] = useState<TableBaseDocument | null>(parsed);
  const [selectedViewByTable, setSelectedViewByTable] = useState<Record<string, string | null>>({});
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [renamingTableId, setRenamingTableId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [editSessionReady, setEditSessionReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Map<string, AttachmentUploadState>>(() => new Map());
  const [fieldDialog, setFieldDialog] = useState<FieldDialogState | null>(null);
  const compact = useCompactViewport();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [dialogRequest, setDialogRequest] = useState<{ mode: TableViewDialogMode; nonce: number } | null>(null);
  /** Set when the field dialog was opened from the fields panel, so closing it lands back there. */
  const [fieldsPanelSignal, setFieldsPanelSignal] = useState(0);
  const returnToFieldsRef = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [viewDateFieldId, setViewDateFieldId] = useState<string | null>(null);
  const [ganttEndFieldId, setGanttEndFieldId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const memoRef = useRef(memo);
  const titleRef = useRef(title);
  const baseRef = useRef(base);
  const editSessionRef = useRef<MemoEditSession | null>(null);
  const savingRef = useRef(false);
  const refreshingRef = useRef(false);
  const savedDraftRef = useRef<BaseDraft | null>(parsed ? { title: memo.title ?? "", base: parsed } : null);
  const saveRef = useRef<() => void>(() => undefined);
  const historyRef = useRef<{ past: TableBaseDocument[]; future: TableBaseDocument[] }>({ past: [], future: [] });
  titleRef.current = title;
  baseRef.current = base;

  useEffect(() => {
    // Keep the visible Base in sync after AI/server edits; a live local edit keeps its revision.
    if (!parsed || dirty || saving || memo.revision < memoRef.current.revision) return;
    const next: BaseDraft = { title: memo.title ?? "", base: parsed };
    memoRef.current = memo;
    if (isSameDraft(savedDraftRef.current, next)) return;
    setTitle(next.title);
    titleRef.current = next.title;
    setBase(parsed);
    baseRef.current = parsed;
    savedDraftRef.current = next;
    setSaveError(null);
    setSaveFailed(false);
  }, [dirty, memo, parsed, saving]);

  useEffect(() => {
    editSessionRef.current = null;
    setEditSessionReady(false);
    setSaveError(null);
    setSaveFailed(false);
    if (readOnly || !parsed) return;
    if (isLocalMemoId(memo.id) || isBrowserOffline() || window.edgeeverDesktop?.isAvailable) {
      editSessionRef.current = createLocalEditSession(memo);
      setEditSessionReady(true);
      return;
    }
    let cancelled = false;
    void api.createMemoEditSession(memo.id).then(({ editSession }) => {
      if (!cancelled) {
        editSessionRef.current = editSession;
        setEditSessionReady(true);
      }
    }).catch(() => {
      if (!cancelled) setSaveError(t("structuredTable.editSessionError"));
    });
    return () => { cancelled = true; };
  }, [memo.id, memo.contentHash, memo.revision, parsed, readOnly, t]);

  const changeBase = useCallback((next: TableBaseDocument) => {
    const previous = baseRef.current;
    if (previous && previous !== next) {
      const history = historyRef.current;
      history.past = [...history.past.slice(-49), previous];
      history.future = [];
      setHistoryVersion((version) => version + 1);
    }
    setBase(next);
    baseRef.current = next;
    setDirty(next !== savedDraftRef.current?.base || titleRef.current !== savedDraftRef.current?.title);
    setSaveFailed(false);
  }, []);

  const jumpHistory = useCallback((direction: "undo" | "redo") => {
    const history = historyRef.current;
    const source = direction === "undo" ? history.past : history.future;
    const target = source[source.length - 1];
    if (!target) return;
    if (direction === "undo") {
      history.past = history.past.slice(0, -1);
      const current = baseRef.current;
      history.future = current ? [...history.future, current] : history.future;
    } else {
      history.future = history.future.slice(0, -1);
      const current = baseRef.current;
      history.past = current ? [...history.past, current] : history.past;
    }
    setHistoryVersion((version) => version + 1);
    baseRef.current = target;
    setBase(target);
    setDirty(target !== savedDraftRef.current?.base || titleRef.current !== savedDraftRef.current?.title);
    setSaveFailed(false);
  }, []);

  useEffect(() => {
    if (readOnly) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (key === "z" || key === "y") {
        const redo = key === "y" || event.shiftKey;
        event.preventDefault();
        jumpHistory(redo ? "redo" : "undo");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jumpHistory, readOnly]);

  const save = async () => {
    const currentMemo = memoRef.current;
    const currentBase = baseRef.current;
    const editSession = editSessionRef.current;
    if (!currentBase || !editSession || readOnly || savingRef.current) return false;
    const next: BaseDraft = { title: titleRef.current, base: currentBase };
    if (isSameDraft(savedDraftRef.current, next)) {
      setDirty(false);
      return true;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setSaveFailed(false);
    try {
      const markdown = markdownFor(currentBase);
      const result = await repository.updateMemo(currentMemo, {
        expectedRevision: currentMemo.revision,
        expectedContentHash: currentMemo.contentHash,
        editSessionId: editSession.id,
        title: next.title,
        contentJson: markdownToDoc(tableBaseFallbackMarkdown(currentBase)),
        contentMarkdown: markdown,
        tags: currentMemo.tags,
      });
      memoRef.current = result.memo;
      savedDraftRef.current = next;
      const hasNewChanges = titleRef.current !== next.title || baseRef.current !== next.base;
      setDirty(hasNewChanges);
      if (!hasNewChanges) await onSaved(result.memo);
      return true;
    } catch (error) {
      setSaveFailed(true);
      setSaveError(error instanceof Error ? error.message : t("structuredTable.saveError"));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  saveRef.current = () => { void save(); };

  useEffect(() => {
    if (readOnly || !dirty || saving || !editSessionReady || saveFailed) return;
    const timer = window.setTimeout(() => saveRef.current(), EDITOR_LOCAL_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, editSessionReady, readOnly, saveFailed, saving]);

  const tables = base?.tables ?? [];
  const activeTable = tables.find((table) => table.id === base?.activeTableId) ?? tables[0];
  const document = useMemo(() => (activeTable ? tableBaseTableDocument(activeTable) : null), [activeTable]);
  const views = useMemo(() => (document ? getTableViews(document) : []), [document]);
  const computation = useMemo(() => (base ? computeTableBase(base) : null), [base]);
  const computedRecords = useMemo(() => {
    if (!computation || !activeTable) return null;
    const table = computation.tables.get(activeTable.id);
    if (!table) return null;
    return new Map(table.records.map((record) => [record.id, record]));
  }, [activeTable, computation]);
  const computeErrors = computation?.errors ?? [];
  const selectedViewId = activeTable ? (selectedViewByTable[activeTable.id] ?? readBaseViewSelection(memo.id, activeTable.id)) : null;
  const activeView = views.find((view) => view.id === selectedViewId) ?? views[0];

  const selectView = (id: string) => {
    if (!activeTable) return;
    setSelectedViewByTable((current) => ({ ...current, [activeTable.id]: id }));
    try { window.localStorage.setItem(viewSelectionKey(memo.id, activeTable.id), id); } catch { /* device preference only */ }
  };
  const changeDocument = (next: TableDocument) => {
    if (!base || !activeTable) return;
    changeBase(updateTableBaseTable(base, activeTable.id, next));
  };
  const commitActiveView = (nextView: NamedTableView) => {
    if (!document || readOnly) return;
    const nextViews = views.map((item) => (item.id === nextView.id ? nextView : item));
    void commitViews(nextViews, nextView.id);
  };
  const commitViews = async (nextViews: NamedTableView[], selected: string) => {
    if (!document || !activeTable || readOnly) return false;
    const next = saveTableViews(document, nextViews);
    changeDocument(next);
    selectView(selected);
    return true;
  };
  const requestDialog = (mode: TableViewDialogMode) => {
    setToolsOpen(false);
    setDialogRequest((current) => ({ mode, nonce: (current?.nonce ?? 0) + 1 }));
  };
  const switchLayout = (layout: TableViewLayout) => {
    if (!document || !activeView || readOnly) return;
    let groupBy = activeView.groupBy;
    if (layout === "kanban") {
      const grouped = document.fields.find((field) => field.id === groupBy?.fieldId);
      if (grouped?.type !== "select") {
        const fallback = document.fields.find((field) => field.type === "select");
        if (!fallback) {
          requestDialog("group");
          return;
        }
        groupBy = { fieldId: fallback.id, direction: "asc" };
      }
    }
    setToolsOpen(false);
    commitActiveView({ ...activeView, layout, groupBy });
  };

  const selectTable = (tableId: string) => {
    if (!base) return;
    setExpandedRecordId(null);
    changeBase(setActiveTableInBase(base, tableId));
  };
  const createTable = () => {
    if (!base) return;
    try {
      const next = addTableToBase(base);
      const created = next.tables[next.tables.length - 1];
      changeBase(created ? setActiveTableInBase(next, created.id) : next);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("structuredTable.saveError"));
    }
  };
  const commitTableRename = () => {
    if (!base || !renamingTableId) return;
    const name = renameDraft.trim();
    setRenamingTableId(null);
    if (!name) return;
    try {
      changeBase(renameTableInBase(base, renamingTableId, name));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("structuredTable.saveError"));
    }
  };
  const deleteTable = (tableId: string) => {
    if (!base) return;
    try {
      const next = removeTableFromBase(base, tableId);
      setExpandedRecordId(null);
      changeBase(next);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("structuredTable.saveError"));
    }
  };

  const refreshBase = async () => {
    if (refreshingRef.current || saving || dirty || isLocalMemoId(memo.id)) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setSaveError(null);
    try {
      const latest = (await api.getMemo(memo.id)).memo;
      if (latest.revision < memoRef.current.revision) return;
      const next = parseTableBaseDocument(latest.contentMarkdown);
      if (!next) {
        setSaveError(t("structuredTable.unreadable"));
        return;
      }
      const nextTitle = latest.title ?? "";
      setTitle(nextTitle);
      titleRef.current = nextTitle;
      setBase(next);
      baseRef.current = next;
      savedDraftRef.current = { title: nextTitle, base: next };
      setDirty(false);
      setSaveFailed(false);
      memoRef.current = latest;
      await onSaved(latest).catch(() => undefined);
    } catch (error) {
      setSaveError(error instanceof Error && error.message ? error.message : t("structuredTable.refreshError"));
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };

  const exportCsv = () => {
    if (!document) return;
    const blob = new Blob([tableDocumentToCsv(document)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    const fileName = (title.trim() || t("structuredTable.name")).replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
    link.href = url;
    link.download = `${fileName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importCsvFile = async (file: File | null) => {
    if (!file || readOnly || importing || !document) return;
    const current = document;
    setImporting(true);
    setImportNotice(null);
    setSaveError(null);
    try {
      const result = await appendTableRecordsFromCsv(current, await file.text());
      changeDocument(result.document);
      setImportNotice(t("structuredTable.csvImported", { count: result.imported }));
    } catch (error) {
      setSaveError(`${t("structuredTable.csvImportError")}: ${error instanceof Error ? error.message : ""}`.trim());
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  if (!base || !activeTable || !document || !activeView) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBackToList}>
            <ChevronLeft className="h-4 w-4" />
            {t("structuredTable.back")}
          </Button>
        </div>
        <p className="p-6 text-sm text-muted-foreground">{t("structuredTable.unreadable")}</p>
      </div>
    );
  }

  const saveLabel = saveError ? saveError : saving ? t("structuredTable.saving") : dirty ? t("structuredTable.unsaved") : editSessionReady ? t("structuredTable.saved") : "";
  const fieldLimitReached = document.fields.length >= TABLE_FIELD_LIMIT;
  const recordLimitReached = document.records.length >= TABLE_RECORD_LIMIT;
  const canAddTable = tables.length < TABLE_BASE_TABLE_LIMIT;
  const dateFields = dateFieldCandidates(document.fields);
  const calendarFieldId = dateFields.some((field) => field.id === viewDateFieldId) ? viewDateFieldId : (dateFields[0]?.id ?? null);
  const ganttEndId = dateFields.some((field) => field.id === ganttEndFieldId)
    ? ganttEndFieldId
    : (dateFields[1]?.id ?? dateFields[0]?.id ?? null);
  const visibleRecords = activeView ? applyTableView(document, document.records, activeView) : document.records;

  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-clip bg-card">
      <aside
        className={`hidden shrink-0 flex-col border-r border-border bg-muted/20 md:flex ${sidebarCollapsed ? "w-10 items-center" : "w-52"}`}
        aria-label={t("structuredTable.tables")}
      >
        {sidebarCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-2 size-7"
                aria-label={t("structuredTable.expandSidebar")}
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("structuredTable.expandSidebar")}</TooltipContent>
          </Tooltip>
        ) : (
        <>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">{t("structuredTable.tables")}</span>
          <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={readOnly || !canAddTable}
                  aria-label={t("structuredTable.newTable")}
                  onClick={createTable}
                >
                  <Plus className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{canAddTable ? t("structuredTable.newTable") : t("structuredTable.tableLimit")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t("structuredTable.collapseSidebar")}
                onClick={() => setSidebarCollapsed(true)}
              >
                <PanelLeftClose className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("structuredTable.collapseSidebar")}</TooltipContent>
          </Tooltip>
          </div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <ul className="grid gap-0.5">
            {tables.map((table) => {
              const active = table.id === activeTable.id;
              if (renamingTableId === table.id) {
                return (
                  <li key={table.id}>
                    <Input
                      autoFocus
                      value={renameDraft}
                      aria-label={t("structuredTable.renameTable")}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={commitTableRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") { event.preventDefault(); commitTableRename(); }
                        if (event.key === "Escape") setRenamingTableId(null);
                      }}
                    />
                  </li>
                );
              }
              return (
                <li key={table.id} className="group/table flex items-center gap-1">
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    data-testid="base-table-item"
                    data-table-id={table.id}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${active ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/70"}`}
                    onClick={() => selectTable(table.id)}
                  >
                    <Table2 className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{table.name}</span>
                  </button>
                  {!readOnly ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0 opacity-0 transition-opacity group-hover/table:opacity-100 focus-visible:opacity-100"
                          aria-label={t("structuredTable.tableActions", { name: table.name })}
                        >
                          <MoreHorizontal className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          onSelect={() => {
                            setRenamingTableId(table.id);
                            setRenameDraft(table.name);
                          }}
                        >
                          {t("structuredTable.renameTable")}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={tables.length <= 1} onSelect={() => deleteTable(table.id)}>
                          <Trash2 className="size-4" />
                          {t("structuredTable.deleteTable")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </nav>
        </>
        )}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {compact ? (
          <div className="border-b border-border" data-history={historyVersion}>
            <div className="flex min-w-0 items-center gap-0.5 px-1.5 py-1">
              <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("structuredTable.back")} onClick={onBackToList}>
                <ChevronLeft className="size-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <MemoTitleInput
                  ariaLabel={t("structuredTable.title")}
                  placeholder={t("structuredTable.title")}
                  readOnly={readOnly}
                  value={title}
                  onValueChange={(value) => {
                    setTitle(value);
                    titleRef.current = value;
                    setDirty(value !== savedDraftRef.current?.title || baseRef.current !== savedDraftRef.current?.base);
                  }}
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("structuredTable.more")} data-testid="base-more-menu">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem disabled={readOnly || fieldLimitReached} onSelect={() => setFieldDialog({ mode: "add" })}>
                    <Columns3 className="size-3.5" aria-hidden="true" />{t("structuredTable.addField")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={readOnly || recordLimitReached} onSelect={() => changeDocument(addTableRecord(document))}>
                    <Plus className="size-3.5" aria-hidden="true" />{t("structuredTable.addRecord")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={exportCsv}>
                    <Download className="size-3.5" aria-hidden="true" />{t("structuredTable.exportCsv")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={readOnly || importing || recordLimitReached} onSelect={() => importInputRef.current?.click()}>
                    <Upload className="size-3.5" aria-hidden="true" />{t("structuredTable.importCsv")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={refreshing || saving || dirty || isLocalMemoId(memo.id)} onSelect={() => { void refreshBase(); }}>
                    <RefreshCw className="size-3.5" aria-hidden="true" />{t("structuredTable.refresh")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={readOnly || historyRef.current.past.length === 0} onSelect={() => jumpHistory("undo")}>
                    <Undo2 className="size-3.5" aria-hidden="true" />{t("structuredTable.undo")}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={readOnly || historyRef.current.future.length === 0} onSelect={() => jumpHistory("redo")}>
                    <Redo2 className="size-3.5" aria-hidden="true" />{t("structuredTable.redo")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex min-w-0 items-center gap-1 px-1.5 pb-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-8 min-w-0 gap-1 px-2" aria-label={t("structuredTable.tables")} data-testid="base-table-picker">
                    <Table2 className="size-4 shrink-0" aria-hidden="true" />
                    <span className="max-w-20 truncate text-xs">{activeTable.name}</span>
                    <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {tables.map((table) => (
                    <DropdownMenuItem key={table.id} data-testid="base-table-picker-item" data-table-id={table.id} onSelect={() => selectTable(table.id)}>
                      <span className="truncate">{table.name}</span>
                      {table.id === activeTable.id ? <Check className="ml-auto size-3.5" aria-hidden="true" /> : null}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem disabled={readOnly || !canAddTable} onSelect={() => { createTable(); }}>
                    <Plus className="size-3.5" aria-hidden="true" />{t("structuredTable.newTable")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="h-8 min-w-0 gap-1 px-2" aria-label={t("structuredTable.views.label")} data-testid="base-view-picker">
                    <span className="max-w-24 truncate text-xs">{activeView.name || t("structuredTable.views.default")}</span>
                    <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {views.map((view) => {
                    const Icon = LAYOUT_META[view.layout ?? "grid"].icon;
                    return (
                      <DropdownMenuItem key={view.id} data-testid="base-view-picker-item" onSelect={() => selectView(view.id)}>
                        <Icon className="size-3.5" aria-hidden="true" />
                        <span className="truncate">{view.name || t("structuredTable.views.default")}</span>
                        {view.id === activeView.id ? <Check className="ml-auto size-3.5" aria-hidden="true" /> : null}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  {readOnly ? null : (
                    <>
                      <DropdownMenuItem onSelect={() => requestDialog("new")}>{t("structuredTable.views.new")}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => requestDialog("rename")}>{t("structuredTable.views.rename")}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => requestDialog("copy")}>{t("structuredTable.views.copy")}</DropdownMenuItem>
                      <DropdownMenuItem disabled={views.length <= 1} onSelect={() => requestDialog("delete")}>{t("structuredTable.views.delete")}</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-muted-foreground" data-testid="base-compact-status">
                {saveLabel ?? t("structuredTable.recordCount", { count: document.records.length })}
              </span>
              <Button
                type="button"
                variant={activeView.filters.length ? "soft" : "ghost"}
                size="icon"
                className="size-8 shrink-0"
                aria-label={t("structuredTable.filter")}
                data-testid="base-compact-filter"
                onClick={() => requestDialog("filter")}
              >
                <Filter className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label={t("structuredTable.tools")}
                data-testid="base-compact-tools"
                onClick={() => setToolsOpen(true)}
              >
                <Wrench className="size-4" />
              </Button>
            </div>
          </div>
        ) : (
        <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-1.5" data-history={historyVersion}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="md:hidden" aria-label={t("structuredTable.back")} onClick={onBackToList}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("structuredTable.back")}</TooltipContent>
          </Tooltip>
          <Table2 className="h-4 w-4 text-foreground" aria-hidden="true" />
          <div className="w-40 min-w-0 shrink truncate">
            <MemoTitleInput
              ariaLabel={t("structuredTable.title")}
              placeholder={t("structuredTable.title")}
              readOnly={readOnly}
              value={title}
              onValueChange={(value) => {
                setTitle(value);
                titleRef.current = value;
                setDirty(value !== savedDraftRef.current?.title || baseRef.current !== savedDraftRef.current?.base);
              }}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 md:hidden"
                aria-label={t("structuredTable.tables")}
                data-testid="base-table-picker"
              >
                <Table2 className="size-4" aria-hidden="true" />
                <span className="max-w-24 truncate text-xs">{activeTable.name}</span>
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {tables.map((table) => (
                <DropdownMenuItem
                  key={table.id}
                  data-testid="base-table-picker-item"
                  data-table-id={table.id}
                  onSelect={() => selectTable(table.id)}
                >
                  <span className="truncate">{table.name}</span>
                  {table.id === activeTable.id ? <Check className="ml-auto size-3.5" aria-hidden="true" /> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                disabled={readOnly || !canAddTable}
                onSelect={() => { createTable(); }}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                {t("structuredTable.newTable")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{t("structuredTable.recordCount", { count: document.records.length })}</span>
          {saveLabel ? <span className={saveError ? "shrink-0 whitespace-nowrap text-xs text-rose-600" : "shrink-0 whitespace-nowrap text-xs text-muted-foreground"}>{saveLabel}</span> : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={refreshing || saving || dirty || isLocalMemoId(memo.id)}
                  aria-label={t("structuredTable.refresh")}
                  onClick={() => { void refreshBase(); }}
                >
                  <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("structuredTable.refreshTooltip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={t("structuredTable.exportCsv")} onClick={exportCsv}>
                <Download className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("structuredTable.exportCsv")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={readOnly || importing || recordLimitReached}
                  aria-label={t("structuredTable.importCsv")}
                  onClick={() => importInputRef.current?.click()}
                >
                  <Upload className={importing ? "size-4 animate-pulse" : "size-4"} />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("structuredTable.importCsv")}</TooltipContent>
          </Tooltip>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label={t("structuredTable.importCsv")}
            onChange={(event) => { void importCsvFile(event.target.files?.[0] ?? null); }}
          />
          {importNotice ? <span role="status" className="text-xs text-emerald-700">{importNotice}</span> : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={readOnly || historyRef.current.past.length === 0}
                  aria-label={t("structuredTable.undo")}
                  onClick={() => jumpHistory("undo")}
                >
                  <Undo2 className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("structuredTable.undo")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={readOnly || historyRef.current.future.length === 0}
                  aria-label={t("structuredTable.redo")}
                  onClick={() => jumpHistory("redo")}
                >
                  <Redo2 className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("structuredTable.redo")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-2"
                  disabled={readOnly || fieldLimitReached}
                  aria-label={t("structuredTable.addField")}
                  onClick={() => setFieldDialog({ mode: "add" })}
                >
                  <Plus className="size-4" />
                  <span className="hidden lg:inline">{t("structuredTable.addField")}</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{fieldLimitReached ? t("structuredTable.fieldLimit") : t("structuredTable.addField")}</TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="solid"
            size="sm"
            disabled={readOnly || recordLimitReached}
            aria-label={t("structuredTable.addRecord")}
            onClick={() => changeDocument(addTableRecord(document))}
          >
            <Plus className="h-4 w-4" />
            {t("structuredTable.addRecord")}
          </Button>
        </div>
        )}
        <TableViewControls
          fields={document.fields}
          views={views}
          active={activeView}
          readOnly={readOnly}
          compact={compact}
          openRequest={dialogRequest}
          layouts={[...TABLE_VIEW_LAYOUTS]}
          onSelect={selectView}
          onCommit={commitViews}
          onEditField={(field) => {
            returnToFieldsRef.current = true;
            setFieldDialog({ mode: "edit", field });
          }}
          fieldsPanelSignal={fieldsPanelSignal}
          showColumnWidth={false}
        />
        {computeErrors.length ? (
          <div role="status" className="border-b border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800">
            <span className="font-medium">{t("structuredTable.tableErrors")}</span>
            <span className="ml-1 truncate">{computeErrors.slice(0, 3).join(" ")}</span>
          </div>
        ) : null}
        {activeView.layout === "calendar" || activeView.layout === "gantt" ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1 text-xs text-muted-foreground">
            <label className="flex items-center gap-1">
              <span>{t("structuredTable.calendarDateField")}</span>
              <select
                className="h-7 rounded border border-border bg-card px-1 text-xs text-foreground"
                aria-label={t("structuredTable.calendarDateField")}
                value={calendarFieldId ?? ""}
                onChange={(event) => setViewDateFieldId(event.target.value || null)}
              >
                <option value="">—</option>
                {dateFields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
              </select>
            </label>
            {activeView.layout === "gantt" ? (
              <label className="flex items-center gap-1">
                <span>{t("structuredTable.ganttEndField")}</span>
                <select
                  className="h-7 rounded border border-border bg-card px-1 text-xs text-foreground"
                  aria-label={t("structuredTable.ganttEndField")}
                  value={ganttEndId ?? ""}
                  onChange={(event) => setGanttEndFieldId(event.target.value || null)}
                >
                  <option value="">—</option>
                  {dateFields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="relative flex min-h-0 min-w-0 flex-1">
          {activeView.layout === "kanban" ? (
            <BaseKanban
              compact={compact}
              document={document}
              view={activeView}
              readOnly={readOnly}
              onOpenRecord={setExpandedRecordId}
              onChange={changeDocument}
            />
          ) : activeView.layout === "calendar" ? (
            <BaseCalendar
              document={document}
              records={visibleRecords}
              readOnly={readOnly}
              onOpenRecord={setExpandedRecordId}
              dateFieldId={calendarFieldId}
              emptyLabel={t("structuredTable.calendarNeedsDate")}
            />
          ) : activeView.layout === "gallery" ? (
            <BaseGallery
              document={document}
              records={visibleRecords}
              readOnly={readOnly}
              onOpenRecord={setExpandedRecordId}
            />
          ) : activeView.layout === "gantt" ? (
            <BaseGantt
              document={document}
              records={visibleRecords}
              readOnly={readOnly}
              onOpenRecord={setExpandedRecordId}
              startFieldId={calendarFieldId}
              endFieldId={ganttEndId}
              emptyLabel={t("structuredTable.ganttNeedsDate")}
            />
          ) : (
            <BaseTableGrid
              compact={compact}
              document={document}
              onConfigureField={(field) => setFieldDialog({ mode: "edit", field })}
              onResizeColumn={(fieldId, width) => {
                if (!document || !activeView) return;
                commitActiveView(setTableViewColumnWidth(document.fields, activeView, fieldId, width));
              }}
              view={activeView}
              readOnly={readOnly}
              memoId={memo.id}
              repository={repository}
              onChange={changeDocument}
              onExpandRecord={setExpandedRecordId}
              computedRecords={computedRecords}
              uploads={uploads}
              onUploadState={(key, state) => setUploads((current) => {
                const next = new Map(current);
                if (state === undefined) next.delete(key);
                else next.set(key, state);
                return next;
              })}
            />
          )}
          {expandedRecordId ? (
            <BaseRecordPanel
              overlay={compact}
              document={document}
              record={expandedRecordId ? computedRecords?.get(expandedRecordId) ?? document.records.find((item) => item.id === expandedRecordId) ?? null : null}
              recordId={expandedRecordId}
              readOnly={readOnly}
              onClose={() => setExpandedRecordId(null)}
              onChange={changeDocument}
              onDelete={() => {
                changeDocument(removeTableRecord(document, expandedRecordId));
                setExpandedRecordId(null);
              }}
            />
          ) : null}
        </div>
      </div>
      <Drawer open={toolsOpen} onOpenChange={setToolsOpen}>
        <DrawerContent data-testid="base-tools-sheet">
          <DrawerTitle className="px-4 pb-1 pt-1 text-sm font-medium">{t("structuredTable.tools")}</DrawerTitle>
          <div className="grid grid-cols-5 gap-1 px-3 pb-2">
            {TABLE_VIEW_LAYOUTS.map((layout) => {
              const meta = LAYOUT_META[layout];
              const Icon = meta.icon;
              const selected = layout === "grid" ? !activeView.layout || activeView.layout === "grid" : activeView.layout === layout;
              return (
                <button
                  key={layout}
                  type="button"
                  data-testid={`base-tools-layout-${layout}`}
                  aria-pressed={selected}
                  onClick={() => switchLayout(layout)}
                  className={`flex flex-col items-center gap-1 rounded-md px-1 py-2 text-[11px] ${selected ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span className="truncate">{t(meta.label)}</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-4 gap-1 border-t border-border px-3 pb-6 pt-2">
            {([
              { mode: "fields" as const, label: t("structuredTable.fields"), icon: Columns3 },
              { mode: "filter" as const, label: t("structuredTable.filter"), icon: Filter },
              { mode: "group" as const, label: t("structuredTable.group"), icon: Group },
              { mode: "sort" as const, label: t("structuredTable.sort"), icon: ArrowDownUp },
            ]).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.mode}
                  type="button"
                  data-testid={`base-tools-${item.mode}`}
                  onClick={() => requestDialog(item.mode)}
                  className="flex flex-col items-center gap-1 rounded-md px-1 py-2 text-[11px] text-muted-foreground"
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
      <BaseFieldDialog
        open={fieldDialog !== null}
        state={fieldDialog}
        document={document}
        onOpenChange={(open) => {
          if (open) return;
          setFieldDialog(null);
          if (returnToFieldsRef.current) {
            returnToFieldsRef.current = false;
            setFieldsPanelSignal((count) => count + 1);
          }
        }}
        onSubmit={(field) => {
          if (fieldDialog?.mode === "edit") changeDocument(updateTableField(document, fieldDialog.field.id, {
            name: field.name, type: field.type, options: field.options, optionColors: field.optionColors,
          }));
          else changeDocument(addTableField(document, field));
        }}
      />
    </div>
  );
};

export default BaseEditorPane;