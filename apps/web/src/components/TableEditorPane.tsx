import { AI_ASSISTANT_LAUNCHER_POSITION } from "@/lib/ai-assistant-launcher";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { ChevronLeft, Download, Form, Maximize2, Plus, RefreshCw, Sparkles, Table2, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  addTableField,
  addTableRecord,
  applyTableView,
  appendTableRecordsFromCsv,
  buildTableDocumentMarkdown,
  createTableId,
  markdownToDoc,
  parseTableDocument,
  removeTableRecord,
  getTableViews,
  groupTableRecords,
  resolveTableViewColumns,
  saveTableViews,
  listTableAttachmentResourceIds,
  TABLE_ATTACHMENT_LIMIT,
  TABLE_FIELD_LIMIT,
   TABLE_RECORD_LIMIT,
  tableDocumentToCsv,
  updateTableCell,
  type MemoDetail,
  type Notebook,
  type TableDocument,
  type TableField,
  type NamedTableView,
  type TableRecord,
} from "@edgeever/shared";
import { AiSidebar, readAiSidebarOpen, writeAiSidebarOpen } from "@/components/ai-sidebar/AiSidebar";
import { AiSidebarErrorBoundary } from "@/components/ai-sidebar/AiSidebarErrorBoundary";
import { IconTooltip } from "@/components/editor/EditorPaneChrome";
import { MemoTitleInput } from "@/components/MemoTitleInput";
import { TableFormDialog } from "@/components/dialogs/TableFormDialog";
import { RecordDetailDialog } from "@/components/table/RecordDetailDialog";
import {
  attachmentItems,
  attachmentUploadKey,
  displayCell,
  FieldHeader,
  RecordCell,
  type AttachmentUploadState,
  type EditingCell,
} from "@/components/table/table-cells";
import { TableViewControls } from "@/components/TableViewControls";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, getConfiguredDesktopApiBaseUrl } from "@/lib/api";
import { acknowledgeTableUploads } from "@/lib/table-upload-lifecycle";
import { EDITOR_LOCAL_SAVE_DELAY_MS, formatShortcutBinding, getNotebookMoveOptions, type ShortcutSettings } from "@/lib/app-helpers";
import { createLocalEditSession } from "@/components/editor/editor-pane-helpers";
import { isLocalMemoId } from "@/lib/local-mirror";
import { isBrowserOffline } from "@/lib/network-status";
import { flushPendingMemoUpdate } from "@/lib/sync-queue";
import type { EdgeEverRepository } from "@/lib/repository";
import type { MemoEditSession } from "@edgeever/shared";

type TableEditorPaneProps = {
  memo: MemoDetail;
  notebooks: Notebook[];
  repository: EdgeEverRepository;
  readOnly: boolean;
  onBackToList: () => void;
  onSaved: (memo: MemoDetail) => Promise<void>;
  aiAssistantOpenToken: number;
  shortcutSettings: ShortcutSettings;
  companionAvailable: boolean;
  beforeCompanionApply?: () => Promise<void>;
  onCompanionNotesChanged?: () => Promise<void>;
  onOpenCompanionNote?: (id: string, notebookId: string) => void;
};

type TableDraft = { title: string; document: TableDocument };

const markdownCache = new WeakMap<TableDocument, ReturnType<typeof buildTableDocumentMarkdown>>();
const markdownFor = (document: TableDocument) => {
  const cached = markdownCache.get(document);
  if (cached) return cached;
  const rendered = buildTableDocumentMarkdown(document);
  markdownCache.set(document, rendered);
  return rendered;
};
const isSameDraft = (left: TableDraft | null, right: TableDraft) =>
  left?.title === right.title && (left.document === right.document
    || markdownFor(left.document).markdown === markdownFor(right.document).markdown);

const TABLE_ROW_ESTIMATE = 41;
const TABLE_ROW_OVERSCAN = 6;
const TABLE_FIELD_WIDTH = 160;
const TABLE_ATTACHMENT_WIDTH = 240;
const TABLE_ACTION_WIDTH = 48;

const VirtualRowGap = ({ height, columns }: { height: number; columns: number }) =>
  height > 0 ? <tr aria-hidden="true"><td colSpan={columns} style={{ height }} /></tr> : null;

const viewSelectionKey = (id: string) => `edgeever.table-view.v1:${id}`;
const readTableViewSelection = (id: string) => {
  try { return window.localStorage.getItem(viewSelectionKey(id)); } catch { return null; }
};

export const TableEditorPane = ({
  memo,
  notebooks,
  repository,
  readOnly,
  onBackToList,
  onSaved,
  aiAssistantOpenToken,
  shortcutSettings,
  companionAvailable,
  beforeCompanionApply,
  onCompanionNotesChanged,
  onOpenCompanionNote,
}: TableEditorPaneProps) => {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseTableDocument(memo.contentMarkdown), [memo.contentMarkdown]);
  const [title, setTitle] = useState(memo.title ?? "");
  const [document, setDocument] = useState<TableDocument | null>(parsed);
  const [selectedViewId, setSelectedViewId] = useState(() => readTableViewSelection(memo.id));
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const draftRef = useRef("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [aiAssistantOpen, setAiAssistantOpenState] = useState(readAiSidebarOpen);
  const setAiSidebarOpen = useCallback((open: boolean) => {
    setAiAssistantOpenState(open);
    writeAiSidebarOpen(open);
  }, []);
  const handledAiAssistantOpenTokenRef = useRef(aiAssistantOpenToken);
  const notebookOptions = useMemo(() => getNotebookMoveOptions(notebooks), [notebooks]);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const formQuery = useQuery({
    queryKey: ["table-form", memo.id],
    queryFn: () => api.getTableForm(memo.id),
    enabled: !isLocalMemoId(memo.id),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const formAccepting = formQuery.data?.form?.enabled === true;
  const [editSessionReady, setEditSessionReady] = useState(false);
  const memoRef = useRef(memo);
  const titleRef = useRef(title);
  const documentRef = useRef(document);
  const editingRef = useRef(editing);
  const editSessionRef = useRef<MemoEditSession | null>(null);
  const pendingUploadIdsRef = useRef(new Set<string>());
  const [attachmentUploads, setAttachmentUploads] = useState<Map<string, AttachmentUploadState>>(() => new Map());
  const savingRef = useRef(false);
  const savedDraftRef = useRef<TableDraft | null>(parsed ? { title: memo.title ?? "", document: parsed } : null);
  const saveRef = useRef<() => void>(() => undefined);
  titleRef.current = title;
  documentRef.current = document;
  editingRef.current = editing;

  useEffect(() => {
    // Keep the displayed table and its save base in sync after AI/server edits.
    // An active local edit must retain its original revision for conflict checks.
    if (!parsed || dirty || saving || editing || memo.revision < memoRef.current.revision) return;
    const next = { title: memo.title ?? "", document: parsed };
    memoRef.current = memo;
    if (isSameDraft(savedDraftRef.current, next)) return;
    setTitle(next.title);
    titleRef.current = next.title;
    setDocument(parsed);
    documentRef.current = parsed;
    savedDraftRef.current = next;
    setSaveError(null);
    setSaveFailed(false);
  }, [dirty, editing, memo, parsed, saving]);

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

  useEffect(() => {
    if (handledAiAssistantOpenTokenRef.current === aiAssistantOpenToken) return;
    handledAiAssistantOpenTokenRef.current = aiAssistantOpenToken;
    if (readOnly || formOpen) return;
    setAiSidebarOpen(true);
    if (dirty) saveRef.current();
  }, [aiAssistantOpenToken, dirty, formOpen, readOnly, setAiSidebarOpen]);

  const changeDocument = (next: TableDocument) => {
    setDocument(next);
    documentRef.current = next;
    setDirty(next !== savedDraftRef.current?.document || titleRef.current !== savedDraftRef.current?.title);
    setSaveFailed(false);
  };

  const commitEditing = (value: string) => {
    const current = documentRef.current;
    const cell = editingRef.current;
    if (!current || !cell) return;
    changeDocument(updateTableCell(current, cell.recordId, cell.fieldId, value));
    setEditing(null);
    editingRef.current = null;
  };

  const acknowledgeUploads = (saved: TableDocument) => {
    const pending = pendingUploadIdsRef.current;
    if (!pending.size) return;
    const savedIds = listTableAttachmentResourceIds(saved);
    const current = documentRef.current;
    const currentIds = current && current !== saved ? listTableAttachmentResourceIds(current) : savedIds;
    for (const id of acknowledgeTableUploads(pending, savedIds, currentIds)) {
      void repository.deleteResource(id).catch(() => undefined);
    }
  };

  const save = async () => {
    const currentMemo = memoRef.current;
    const currentDocument = documentRef.current;
    const editSession = editSessionRef.current;
    if (!currentDocument || !editSession || readOnly || savingRef.current) return false;
    if (editingRef.current) commitEditing(draftRef.current);
    const nextDocument = documentRef.current;
    if (!nextDocument) return false;
    const next = { title: titleRef.current, document: nextDocument };
    if (isSameDraft(savedDraftRef.current, next)) {
      acknowledgeUploads(nextDocument);
      setDirty(false);
      return true;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setSaveFailed(false);
    try {
      const { fallback, markdown } = markdownFor(nextDocument);
      const result = await repository.updateMemo(currentMemo, {
        expectedRevision: currentMemo.revision,
        expectedContentHash: currentMemo.contentHash,
        editSessionId: editSession.id,
        title: next.title,
        contentJson: markdownToDoc(fallback),
        contentMarkdown: markdown,
        tags: currentMemo.tags,
      });
      memoRef.current = result.memo;
      savedDraftRef.current = next;
      acknowledgeUploads(nextDocument);
      const hasNewChanges = titleRef.current !== next.title || documentRef.current !== next.document;
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
    if (readOnly || !dirty || saving || !editSessionReady || saveFailed || editing) return;
    const timer = window.setTimeout(() => saveRef.current(), EDITOR_LOCAL_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, editSessionReady, editing, readOnly, saveFailed, saving]);

  const views = useMemo(() => document ? getTableViews(document) : [], [document]);
  const activeView = views.find((view) => view.id === selectedViewId) ?? views[0];
  const [weekRevision, refreshWeek] = useState(0);
  const relativeWeek = activeView?.filters.some((filter) => filter.operator === "thisWeek") ?? false;
  useEffect(() => {
    if (!relativeWeek) return;
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - (now.getDay() + 6) % 7));
    const timer = window.setTimeout(() => refreshWeek((value) => value + 1), next.getTime() - now.getTime());
    return () => window.clearTimeout(timer);
  }, [weekRevision, relativeWeek]);
  const visibleRecords = useMemo(() => document && activeView
    ? applyTableView(document, document.records, activeView) : [], [activeView, document, weekRevision]);
  const recordGroups = useMemo(() => document && activeView?.groupBy
    ? groupTableRecords(document, visibleRecords, activeView.groupBy, { includeEmpty: activeView.layout === "kanban" })
    : [], [activeView, document, visibleRecords]);
  const gridRows = useMemo(() => activeView?.groupBy && activeView.layout !== "kanban"
    ? recordGroups.flatMap((group) => [
      { type: "group" as const, key: group.key, count: group.records.length },
      ...group.records.map((record) => ({ type: "record" as const, record })),
    ])
    : visibleRecords.map((record) => ({ type: "record" as const, record })), [activeView, recordGroups, visibleRecords]);
  const selectView = (id: string) => {
    setSelectedViewId(id);
    try { window.localStorage.setItem(viewSelectionKey(memo.id), id); } catch { /* device preference only */ }
  };
  const commitViews = async (nextViews: NamedTableView[], selected: string) => {
    const current = documentRef.current;
    if (!current || readOnly) return false;
    const next = saveTableViews(current, nextViews);
    if (current.schemaVersion !== next.schemaVersion
      && (!window.edgeeverDesktop?.isAvailable || getConfiguredDesktopApiBaseUrl())) {
      const health = await api.getInstanceHealth().catch(() => null);
      if (!health) throw new Error(t("structuredTable.views.connectToUpgrade"));
      if ((health.tableSchemaVersion ?? 0) < next.schemaVersion) {
        throw new Error(t("structuredTable.views.upgradeServer"));
      }
      if (documentRef.current !== current) throw new Error(t("structuredTable.views.changed"));
    }
    changeDocument(next);
    selectView(selected);
    return true;
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null);
  const rowIndices = useMemo(() => {
    const map = new Map<string, number>();
    gridRows.forEach((row, index) => { if (row.type === "record") map.set(row.record.id, index); });
    return map;
  }, [gridRows]);
  const editingIndex = editing ? rowIndices.get(editing.recordId) : undefined;
  const focusedIndex = focusedRecordId ? rowIndices.get(focusedRecordId) : undefined;
  // Unmounting a focused row can silently discard its input or break keyboard navigation.
  const rangeExtractor = useCallback((range: Range) => {
    const indices = new Set(defaultRangeExtractor(range));
    if (editingIndex !== undefined) indices.add(editingIndex);
    if (focusedIndex !== undefined) indices.add(focusedIndex);
    return [...indices].sort((left, right) => left - right);
  }, [editingIndex, focusedIndex]);
  const rowKey = useCallback((index: number) => {
    const row = gridRows[index];
    return !row || row.type === "group" ? `group:${row?.key ?? index}` : row.record.id;
  }, [gridRows]);
  const rowVirtualizer = useVirtualizer({
    count: gridRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TABLE_ROW_ESTIMATE,
    overscan: TABLE_ROW_OVERSCAN,
    getItemKey: rowKey,
    rangeExtractor,
    useAnimationFrameWithResizeObserver: true,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const viewColumns = useMemo(
    () => document && activeView ? resolveTableViewColumns(document.fields, activeView) : [],
    [activeView, document],
  );
  const visibleColumns = useMemo(() => viewColumns.filter((column) => !column.hidden), [viewColumns]);
  const visibleFields = useMemo(() => {
    const fields = document?.fields ?? [];
    return visibleColumns.map((column) => fields.find((field) => field.id === column.fieldId)!)
      .filter((field): field is TableField => Boolean(field));
  }, [document?.fields, visibleColumns]);
  const fieldWidths = useMemo(() => visibleColumns.map(
    (column) => column.width ?? (document?.fields.find((field) => field.id === column.fieldId)?.type === "attachment" ? TABLE_ATTACHMENT_WIDTH : TABLE_FIELD_WIDTH),
  ), [document?.fields, visibleColumns]);
  const assistantMarkdown = aiAssistantOpen && document ? markdownFor(document).markdown : memo.contentMarkdown;
  const assistantLauncher = !readOnly && !aiAssistantOpen ? (
    <IconTooltip
      side="left"
      label={`${t("aiAssistant.open")} (${formatShortcutBinding(shortcutSettings.openAiAssistant)})`}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        data-ai-assistant-launcher=""
        className={`${AI_ASSISTANT_LAUNCHER_POSITION} absolute z-30 size-11 rounded-full border-slate-200 bg-card text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.14)] hover:bg-card hover:text-slate-950`}
        aria-label={t("aiAssistant.open")}
        onClick={() => {
          setAiSidebarOpen(true);
          if (dirty) saveRef.current();
        }}
      >
        <Sparkles className="size-5" strokeWidth={1.75} />
      </Button>
    </IconTooltip>
  ) : null;
  const assistantSidebar = (
    <AiSidebarErrorBoundary open={aiAssistantOpen} onOpenChange={setAiSidebarOpen}>
      <AiSidebar
        open={aiAssistantOpen}
        onOpenChange={setAiSidebarOpen}
        companionAvailable={companionAvailable}
        contentMarkdown={assistantMarkdown}
        memoId={memo.id}
        notebookId={memo.notebookId}
        notebookTitle={notebookOptions.find((notebook) => notebook.id === memo.notebookId)?.name}
        noteTitle={title}
        beforeCompanionApply={async () => {
          if (dirty && !(await save())) throw new Error("save failed");
          await beforeCompanionApply?.();
        }}
        onCompanionNotesChanged={onCompanionNotesChanged}
        onOpenCompanionNote={onOpenCompanionNote}
      />
    </AiSidebarErrorBoundary>
  );

  if (!document || !activeView) {
    return (
      <div className="relative flex h-full min-h-0 min-w-0 bg-card">
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <Button type="button" variant="ghost" size="sm" onClick={onBackToList}>
              <ChevronLeft className="h-4 w-4" />
              {t("structuredTable.back")}
            </Button>
          </div>
          <p className="p-6 text-sm text-slate-500">{t("structuredTable.unreadable")}</p>
          {assistantLauncher}
        </div>
        {assistantSidebar}
      </div>
    );
  }

  const filtered = activeView.filters.length > 0;
  const countLabel = filtered
    ? t("structuredTable.recordCountFiltered", { count: visibleRecords.length, total: document.records.length })
    : t("structuredTable.recordCount", { count: document.records.length });
  const saveLabel = saveError ? saveError : saving ? t("structuredTable.saving") : dirty ? t("structuredTable.unsaved") : editSessionReady ? t("structuredTable.saved") : "";
  const fieldLimitReached = document.fields.length >= TABLE_FIELD_LIMIT;
  const recordLimitReached = document.records.length >= TABLE_RECORD_LIMIT;

  const refreshBlocked = refreshing || saving || dirty || Boolean(editing) || isLocalMemoId(memo.id);
  const refreshTable = async () => {
    if (refreshBlocked || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setSaveError(null);
    try {
      // Same as the base editor: deliver queued edits before trusting the server snapshot.
      if (!(await flushPendingMemoUpdate(memo.id))) {
        setSaveError(t("structuredTable.refreshPending"));
        return;
      }
      const latest = (await api.getMemo(memo.id)).memo;
      if (latest.revision < memoRef.current.revision) return;
      const next = parseTableDocument(latest.contentMarkdown);
      if (!next) {
        setSaveError(t("structuredTable.unreadable"));
        return;
      }
      const nextTitle = latest.title ?? "";
      setTitle(nextTitle);
      titleRef.current = nextTitle;
      setDocument(next);
      documentRef.current = next;
      savedDraftRef.current = { title: nextTitle, document: next };
      setDirty(false);
      setSaveFailed(false);
      setEditing(null);
      editingRef.current = null;
      memoRef.current = latest;
      await onSaved(latest).catch(() => undefined);
    } catch (error) {
      setSaveError(error instanceof Error && error.message ? error.message : t("structuredTable.refreshError"));
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };

  const importCsvFile = async (file: File | null) => {
    if (!file || readOnly || importing) return;
    const current = documentRef.current;
    if (!current) return;
    setImporting(true);
    setImportNotice(null);
    setSaveError(null);
    try {
      const result = await appendTableRecordsFromCsv(current, await file.text());
      if (documentRef.current !== current) throw new Error(t("structuredTable.views.changed"));
      changeDocument(result.document);
      setImportNotice(t("structuredTable.csvImported", { count: result.imported }));
    } catch (error) {
      setSaveError(`${t("structuredTable.csvImportError")}: ${error instanceof Error ? error.message : ""}`.trim());
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const renderRecordCell = (field: TableField, record: TableRecord) => (
    <RecordCell
      document={document}
      field={field}
      record={record}
      recordIndex={document.records.findIndex((item) => item.id === record.id)}
      active={editing?.recordId === record.id && editing.fieldId === field.id}
      readOnly={readOnly}
      memoId={memo.id}
      repository={repository}
      onAdd={(attachment) => {
        const current = documentRef.current;
        const rowRecord = current?.records.find((item) => item.id === record.id);
        const existing = attachmentItems(rowRecord?.cells[field.id] ?? null);
        if (!current || !rowRecord || !current.fields.some((candidate) => candidate.id === field.id && candidate.type === "attachment")
          || existing.length >= TABLE_ATTACHMENT_LIMIT || existing.some((item) => item.resourceId === attachment.resourceId)) return false;
        changeDocument(updateTableCell(current, record.id, field.id, [...existing, attachment]));
        return true;
      }}
      onRemove={(resourceId) => {
        const current = documentRef.current;
        const rowRecord = current?.records.find((item) => item.id === record.id);
        if (!current || !rowRecord) return;
        const next = updateTableCell(current, record.id, field.id,
          attachmentItems(rowRecord.cells[field.id] ?? null).filter((item) => item.resourceId !== resourceId));
        changeDocument(next);
        // The active snapshot may still need this file. Its acknowledgement
        // will either transfer ownership or retire the abandoned upload.
        if (!savingRef.current && pendingUploadIdsRef.current.has(resourceId)
          && !listTableAttachmentResourceIds(next).has(resourceId)) {
          pendingUploadIdsRef.current.delete(resourceId);
          void repository.deleteResource(resourceId).catch(() => undefined);
        }
      }}
      onUploaded={(resourceId) => pendingUploadIdsRef.current.add(resourceId)}
      uploadState={field.type === "attachment" ? attachmentUploads.get(attachmentUploadKey(record.id, field.id)) : undefined}
      onUploadState={(state) => {
        const key = attachmentUploadKey(record.id, field.id);
        setAttachmentUploads((current) => {
          const next = new Map(current);
          if (state === undefined) next.delete(key);
          else next.set(key, state);
          return next;
        });
      }}
      onEdit={(cell) => {
        editingRef.current = cell;
        if (cell) draftRef.current = displayCell(field, record.cells[field.id] ?? null);
        setEditing(cell);
      }}
      onCommit={commitEditing}
      onDraft={(value) => { draftRef.current = value; }}
      onChange={changeDocument}
    />
  );

  const renderRecordActions = (recordId: string) => (
    <div className="flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("structuredTable.expandRecord")}
            onClick={() => setExpandedRecordId(recordId)}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("structuredTable.expandRecord")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("structuredTable.deleteRecord")}
            disabled={readOnly}
            onClick={() => changeDocument(removeTableRecord(document, recordId))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("structuredTable.deleteRecord")}</TooltipContent>
      </Tooltip>
    </div>
  );

  const exportCsv = () => {
    const blob = new Blob([tableDocumentToCsv(document, visibleRecords, visibleFields)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    const fileName = (title.trim() || t("structuredTable.name")).replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
    link.href = url;
    link.download = `${fileName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 overflow-clip bg-card">
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="lg:hidden" aria-label={t("structuredTable.back")} onClick={onBackToList}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("structuredTable.back")}</TooltipContent>
        </Tooltip>
        <Table2 className="h-4 w-4 text-slate-900" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <MemoTitleInput
            ariaLabel={t("structuredTable.title")}
            placeholder={t("structuredTable.title")}
            readOnly={readOnly}
            value={title}
            onValueChange={(value) => {
              setTitle(value);
              titleRef.current = value;
              if (documentRef.current) setDirty(value !== savedDraftRef.current?.title || documentRef.current !== savedDraftRef.current?.document);
            }}
          />
        </div>
        <span className="text-xs text-slate-500">{countLabel}</span>
        {saveLabel ? <span className={saveError ? "text-xs text-rose-600" : "text-xs text-slate-400"}>{saveLabel}</span> : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={refreshBlocked}
                aria-label={t("structuredTable.refresh")}
                onClick={() => { void refreshTable(); }}
              >
                <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                {t("structuredTable.refresh")}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t(dirty || editing ? "structuredTable.unsaved" : "structuredTable.refreshTooltip")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={readOnly}
              className={formAccepting ? "border-slate-900 bg-slate-100 text-slate-950 hover:bg-slate-200" : undefined}
              onClick={() => setFormOpen(true)}
            >
              <Form className="h-4 w-4" />
              {t(formAccepting ? "structuredTable.formLive" : "structuredTable.openForm")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t(formAccepting ? "structuredTable.formLiveTooltip" : "structuredTable.openFormTooltip")}</TooltipContent>
        </Tooltip>
        <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4" />
          {t("structuredTable.exportCsv")}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={readOnly || importing || recordLimitReached}
                aria-label={t("structuredTable.importCsv")}
                onClick={() => importInputRef.current?.click()}
              >
                <Upload className={importing ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
                {t("structuredTable.importCsv")}
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={readOnly || fieldLimitReached}
              aria-label={fieldLimitReached ? t("structuredTable.fieldLimit") : t("structuredTable.addField")}
              onClick={() => changeDocument(addTableField(document, {
                id: createTableId("fld"),
                name: t("structuredTable.newField", { index: document.fields.length + 1 }),
                type: "text",
              }))}
            >
              <Plus className="h-4 w-4" />
              {t("structuredTable.addField")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{fieldLimitReached ? t("structuredTable.fieldLimit") : t("structuredTable.addField")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="solid"
              size="sm"
              disabled={readOnly || recordLimitReached}
              aria-label={recordLimitReached ? t("structuredTable.recordLimit") : t("structuredTable.addRecord")}
              onClick={() => changeDocument(addTableRecord(document))}
            >
              <Plus className="h-4 w-4" />
              {t("structuredTable.addRecord")}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{recordLimitReached ? t("structuredTable.recordLimit") : t("structuredTable.addRecord")}</TooltipContent>
        </Tooltip>
      </div>
      <TableViewControls fields={document.fields} views={views} active={activeView} readOnly={readOnly}
        onSelect={selectView} onCommit={commitViews} />
      <TableFormDialog
        memoId={memo.id}
        memoTitle={title}
        fields={document.fields.filter((field) => field.type !== "autoNumber")}
        open={formOpen}
        onOpenChange={setFormOpen}
      />
      <RecordDetailDialog
        document={document}
        recordId={expandedRecordId}
        readOnly={readOnly}
        onClose={() => setExpandedRecordId(null)}
        onChange={changeDocument}
      />
      {activeView.layout === "kanban" ? (
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3" data-testid="table-kanban">
          <div className="flex h-full min-h-0 items-stretch gap-3">
            {recordGroups.map((group) => {
              const option = group.key || t("structuredTable.emptyGroup");
              return (
                <section key={group.key || "empty"} className="flex min-h-0 w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/20">
                  <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <span className="truncate text-sm font-medium">{option}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{group.records.length}</span>
                  </header>
                  <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-2">
                    {group.records.map((record) => {
                      const primary = visibleFields[0];
                      return (
                        <article key={record.id} className="rounded-lg border border-border bg-card p-2 shadow-sm">
                          <div className="flex items-start justify-between gap-1">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {primary ? displayCell(primary, record.cells[primary.id] ?? null, document.records.indexOf(record)) : "—"}
                            </span>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("structuredTable.expandRecord")} onClick={() => setExpandedRecordId(record.id)}>
                              <Maximize2 className="size-3.5" />
                            </Button>
                          </div>
                          <dl className="mt-1 grid gap-0.5">
                            {visibleFields.slice(1, 4).map((field) => (
                              <div key={field.id} className="flex min-w-0 items-baseline gap-1 text-xs">
                                <dt className="shrink-0 text-muted-foreground">{field.name}</dt>
                                <dd className="min-w-0 truncate">{displayCell(field, record.cells[field.id] ?? null, document.records.indexOf(record)) || "—"}</dd>
                              </div>
                            ))}
                          </dl>
                        </article>
                      );
                    })}
                    {group.records.length === 0 ? <p className="px-1 py-2 text-xs text-muted-foreground">{t("structuredTable.noCards")}</p> : null}
                  </div>
                </section>
              );
            })}
            {recordGroups.length === 0 ? <p className="p-4 text-sm text-slate-500">{t("structuredTable.kanbanNeedSelect")}</p> : null}
          </div>
        </div>
      ) : (
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <table
          className="min-w-full table-fixed border-separate border-spacing-0"
          style={{ width: fieldWidths.reduce((sum, width) => sum + width, TABLE_ACTION_WIDTH) }}
          aria-rowcount={gridRows.length + 1}
        >
          <colgroup>
            {visibleFields.map((field, index) => <col key={field.id} style={{ width: fieldWidths[index] }} />)}
            <col style={{ width: TABLE_ACTION_WIDTH }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {visibleFields.map((field) => (
                <th key={field.id} scope="col" className="border-b border-slate-200 bg-muted/40 px-2 py-1 text-left font-medium">
                  <FieldHeader document={document} field={field} readOnly={readOnly} onChange={changeDocument} />
                </th>
              ))}
              <th scope="col" className="border-b border-slate-200 bg-muted/40" />
            </tr>
          </thead>
          <tbody
            onFocus={(event) => {
              setFocusedRecordId(event.target.closest<HTMLTableRowElement>("tr[data-record-id]")?.dataset.recordId ?? null);
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setFocusedRecordId(null);
            }}
          >
            {virtualRows.map((item, index) => {
              const row = gridRows[item.index]!;
              return (
                <Fragment key={item.key}>
                  <VirtualRowGap height={item.start - (virtualRows[index - 1]?.end ?? 0)} columns={visibleFields.length + 1} />
                  {row.type === "group" ? (
                    <tr ref={rowVirtualizer.measureElement} data-index={item.index} aria-rowindex={item.index + 2} className="bg-muted/40">
                      <td colSpan={visibleFields.length + 1} className="border-b border-border/70 px-3 py-1.5 text-xs font-medium text-foreground">
                        <span className="truncate">{row.key || t("structuredTable.emptyGroup")}</span>
                        <span className="ml-2 tabular-nums text-muted-foreground">{row.count}</span>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      ref={rowVirtualizer.measureElement}
                      data-index={item.index}
                      data-record-id={row.record.id}
                      aria-rowindex={item.index + 2}
                      className="hover:bg-muted/25"
                    >
                      {visibleFields.map((field) => (
                        <td key={field.id} className="border-b border-border/70 px-2 py-1 align-top">
                          {renderRecordCell(field, row.record)}
                        </td>
                      ))}
                      <td className="border-b border-border/70 px-2 py-1 align-top">{renderRecordActions(row.record.id)}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <VirtualRowGap
              height={rowVirtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0)}
              columns={visibleFields.length + 1}
            />
          </tbody>
        </table>
        {visibleRecords.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-500">{filtered ? t("structuredTable.noMatches") : t("structuredTable.empty")}</p>
        ) : null}
      </div>
      )}
      {assistantLauncher}
    </div>
    {assistantSidebar}
    </div>
  );
};

export default TableEditorPane;
