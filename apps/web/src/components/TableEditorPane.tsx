import { AI_ASSISTANT_LAUNCHER_POSITION } from "@/lib/ai-assistant-launcher";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Check, ChevronLeft, Copy, Download, Form, Paperclip, Plus, RefreshCw, Sparkles, Table2, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  addTableField,
  addTableRecord,
  applyTableView,
  createTableId,
  markdownToDoc,
  parseTableDocument,
  removeTableField,
  removeTableRecord,
  replaceTableView,
  listTableAttachmentResourceIds,
  serializeTableDocument,
  TABLE_ATTACHMENT_FILTER_OPERATORS,
  TABLE_ATTACHMENT_LIMIT,
  TABLE_FIELD_LIMIT,
  TABLE_FIELD_TYPES,
  TABLE_FILTER_OPERATORS,
  TABLE_RECORD_LIMIT,
  tableAttachmentUrl,
  tableDocumentToCsv,
  tableFallbackMarkdown,
  updateTableCell,
  updateTableField,
  type MemoDetail,
  type Notebook,
  type TableAttachment,
  type TableCellValue,
  type TableDocument,
  type TableField,
  type TableFieldType,
  type TableFilter,
  type TableFilterOperator,
  type TableRecord,
} from "@edgeever/shared";
import { AiSidebar, readAiSidebarOpen, writeAiSidebarOpen } from "@/components/ai-sidebar/AiSidebar";
import { AiSidebarErrorBoundary } from "@/components/ai-sidebar/AiSidebarErrorBoundary";
import { IconTooltip } from "@/components/editor/EditorPaneChrome";
import { MemoTitleInput } from "@/components/MemoTitleInput";
import { TableFormDialog } from "@/components/dialogs/TableFormDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { copyImageUrlToClipboard } from "@/lib/clipboard";
import { toDesktopResourceDownloadUrl, toDesktopResourceUrl } from "@/lib/desktop-resources";
import { EDITOR_LOCAL_SAVE_DELAY_MS, formatShortcutBinding, getNotebookMoveOptions, type ShortcutSettings } from "@/lib/app-helpers";
import { createLocalEditSession } from "@/components/editor/editor-pane-helpers";
import { isLocalMemoId } from "@/lib/local-mirror";
import { isBrowserOffline } from "@/lib/network-status";
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

type EditingCell = { recordId: string; fieldId: string };

const controlClassName = "h-8 rounded-md border border-slate-200 bg-card px-2 text-xs text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:cursor-not-allowed disabled:opacity-50";

const snapshotOf = (title: string, document: TableDocument) => JSON.stringify({ title, document });

const optionText = (field: TableField) => (field.options ?? []).join(", ");

const parseOptionText = (value: string) => value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);

const displayCell = (field: TableField, value: TableCellValue) => {
  if (field.type === "checkbox") return value === true ? "true" : "false";
  if (Array.isArray(value)) return value.map((item) => item.filename).join(", ");
  if (value === null || value === undefined || value === "") return "";
  return String(value);
};

const FieldHeader = ({
  document,
  field,
  readOnly,
  onChange,
}: {
  document: TableDocument;
  field: TableField;
  readOnly: boolean;
  onChange: (document: TableDocument) => void;
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(field.name);
  const [options, setOptions] = useState(optionText(field));
  useEffect(() => setName(field.name), [field.name]);
  useEffect(() => setOptions(optionText(field)), [field.id, field.options]);
  const commitName = () => {
    const next = name.trim();
    if (next && next !== field.name) onChange(updateTableField(document, field.id, { name: next }));
    else setName(field.name);
  };
  const commitOptions = () => onChange(updateTableField(document, field.id, { options: parseOptionText(options) }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full min-w-36 items-center rounded-md px-2 py-1 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
          aria-label={t("structuredTable.editField", { name: field.name })}
          disabled={readOnly}
        >
          <span className="truncate">{field.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 space-y-2 p-2">
        <label className="block space-y-1 text-xs text-slate-500">
          <span>{t("structuredTable.fieldName")}</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} onBlur={commitName} aria-label={t("structuredTable.fieldName")} />
        </label>
        <label className="block space-y-1 text-xs text-slate-500">
          <span>{t("structuredTable.fieldType")}</span>
          <select
            className={`${controlClassName} w-full`}
            value={field.type}
            aria-label={t("structuredTable.fieldType")}
            onChange={(event) => onChange(updateTableField(document, field.id, { type: event.target.value as TableFieldType }))}
          >
            {TABLE_FIELD_TYPES.map((type) => <option key={type} value={type}>{t(`structuredTable.types.${type}`)}</option>)}
          </select>
        </label>
        {field.type === "select" ? (
          <label className="block space-y-1 text-xs text-slate-500">
            <span>{t("structuredTable.selectOptions")}</span>
            <Input
              value={options}
              placeholder={t("structuredTable.selectOptionsHint")}
              aria-label={t("structuredTable.selectOptions")}
              onChange={(event) => setOptions(event.target.value)}
              onBlur={commitOptions}
            />
          </label>
        ) : null}
        <DropdownMenuItem
          disabled={document.fields.length <= 1}
          onSelect={() => onChange(removeTableField(document, field.id))}
        >
          <Trash2 className="h-4 w-4" />
          {t("structuredTable.deleteField")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const attachmentItems = (value: TableCellValue): TableAttachment[] => Array.isArray(value) ? value : [];

const isImageAttachment = (item: TableAttachment) => item.mimeType.toLowerCase().startsWith("image/");

const downloadTableAttachment = (href: string, filename: string) => {
  const anchor = document.createElement("a");
  anchor.href = toDesktopResourceDownloadUrl(href, filename);
  anchor.download = filename;
  anchor.rel = "noreferrer";
  anchor.click();
};

const AttachmentCell = ({
  field,
  record,
  memoId,
  readOnly,
  repository,
  onAdd,
  onRemove,
  onUploaded,
}: {
  field: TableField;
  record: TableRecord;
  memoId: string;
  readOnly: boolean;
  repository: EdgeEverRepository;
  onAdd: (attachment: TableAttachment) => boolean;
  onRemove: (resourceId: string) => void;
  onUploaded: (resourceId: string) => void;
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const items = attachmentItems(record.cells[field.id] ?? null);
  const limitReached = items.length >= TABLE_ATTACHMENT_LIMIT;

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  const copyImage = async (href: string, resourceId: string) => {
    setCopyError(null);
    const copied = await copyImageUrlToClipboard(href);
    if (!copied) {
      setCopiedId(null);
      setCopyError(t("structuredTable.copyImageFailed"));
      return;
    }
    setCopiedId(resourceId);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => {
      setCopiedId((current) => current === resourceId ? null : current);
    }, 2000);
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || readOnly) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of files) {
        const { resource } = await repository.uploadMemoResource(memoId, file);
        const added = onAdd({
          resourceId: resource.id,
          filename: resource.filename || file.name,
          mimeType: resource.mimeType || file.type,
          byteSize: resource.byteSize ?? file.size,
        });
        if (!added) {
          void repository.deleteResource(resource.id).catch(() => undefined);
          break;
        }
        onUploaded(resource.id);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t("structuredTable.saveError"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex min-w-36 flex-col gap-1 px-2">
      {items.map((item) => {
        const href = toDesktopResourceUrl(tableAttachmentUrl(item.resourceId));
        const image = isImageAttachment(item);
        const openLabel = t("structuredTable.openAttachment", { name: item.filename });
        const copied = copiedId === item.resourceId;
        return (
          <div key={item.resourceId} className="group/attachment flex items-center gap-1">
            {image ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="h-8 w-8 shrink-0 overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
                    aria-label={openLabel}
                  >
                    <img src={href} alt="" className="h-full w-full object-cover" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>{openLabel}</TooltipContent>
              </Tooltip>
            ) : (
              <>
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                <a href={href} className="min-w-0 flex-1 truncate text-sm text-slate-800 underline-offset-2 hover:underline" target="_blank" rel="noreferrer">{item.filename}</a>
              </>
            )}
            <div className="hidden items-center gap-1 group-hover/attachment:flex group-focus-within/attachment:flex">
              {image ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={copied ? t("structuredTable.imageCopied") : t("structuredTable.copyImage")}
                      onClick={() => { void copyImage(href, item.resourceId); }}
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copied ? t("structuredTable.imageCopied") : t("structuredTable.copyImage")}</TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={t("structuredTable.downloadAttachment", { name: item.filename })}
                    onClick={() => downloadTableAttachment(href, item.filename)}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("structuredTable.downloadAttachment", { name: item.filename })}</TooltipContent>
              </Tooltip>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t("structuredTable.removeAttachment", { name: item.filename })}
              disabled={readOnly}
              onClick={() => onRemove(item.resourceId)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        aria-label={t("structuredTable.addAttachment")}
        disabled={readOnly || uploading || limitReached}
        onChange={(event) => { void uploadFiles(event.target.files); }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 justify-start px-0 text-xs"
        disabled={readOnly || uploading || limitReached}
        aria-label={limitReached ? t("structuredTable.attachmentLimit") : t("structuredTable.addAttachment")}
        onClick={() => inputRef.current?.click()}
      >
        <Plus className="h-3.5 w-3.5" />
        {uploading ? t("structuredTable.uploading") : limitReached ? t("structuredTable.attachmentLimit") : t("structuredTable.addAttachment")}
      </Button>
      {uploadError ? <p className="text-xs text-rose-600">{uploadError}</p> : null}
      {copyError ? <p className="text-xs text-rose-600" role="alert">{copyError}</p> : null}
    </div>
  );
};

const RecordCell = ({
  document,
  field,
  record,
  active,
  readOnly,
  onEdit,
  memoId,
  repository,
  onCommit,
  onDraft,
  onChange,
  onAdd,
  onRemove,
  onUploaded,
}: {
  document: TableDocument;
  field: TableField;
  record: TableRecord;
  active: boolean;
  readOnly: boolean;
  onEdit: (cell: EditingCell | null) => void;
  memoId: string;
  repository: EdgeEverRepository;
  onCommit: (value: string) => void;
  onDraft: (value: string) => void;
  onChange: (document: TableDocument) => void;
  onAdd: (attachment: TableAttachment) => boolean;
  onRemove: (resourceId: string) => void;
  onUploaded: (resourceId: string) => void;
}) => {
  const value = record.cells[field.id] ?? null;
  const text = displayCell(field, value);
  const [draft, setDraft] = useState(text);
  useEffect(() => { if (active) setDraft(text); }, [active, text]);
  if (field.type === "attachment") {
    return (
      <AttachmentCell
        field={field}
        record={record}
        memoId={memoId}
        readOnly={readOnly}
        repository={repository}
        onAdd={onAdd}
        onRemove={onRemove}
        onUploaded={onUploaded}
      />
    );
  }
  if (field.type === "checkbox") {
    return (
      <Checkbox
        checked={value === true}
        disabled={readOnly}
        aria-label={field.name}
        onCheckedChange={(checked) => onChange(updateTableCell(document, record.id, field.id, checked === true))}
      />
    );
  }
  if (!active) {
    return (
      <button
        type="button"
        className="block h-8 w-full min-w-36 truncate rounded-md px-2 text-left text-sm text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:hover:bg-transparent"
        disabled={readOnly}
        onClick={() => onEdit({ recordId: record.id, fieldId: field.id })}
      >
        {text || <span className="text-slate-300">—</span>}
      </button>
    );
  }
  if (field.type === "select") {
    const options = field.options ?? [];
    const choices = draft && !options.includes(draft) ? [draft, ...options] : options;
    return (
      <select
        autoFocus
        className={`${controlClassName} w-full min-w-36`}
        value={draft}
        aria-label={field.name}
        onChange={(event) => {
          setDraft(event.target.value);
          onDraft(event.target.value);
          onCommit(event.target.value);
        }}
      >
        <option value="" />
        {choices.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  return (
    <input
      autoFocus
      className={`${controlClassName} w-full min-w-36`}
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "url" ? "url" : "text"}
      value={draft}
      aria-label={field.name}
      onChange={(event) => {
        setDraft(event.target.value);
        onDraft(event.target.value);
      }}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(draft);
        }
        if (event.key === "Escape") onEdit(null);
      }}
    />
  );
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
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const draftRef = useRef("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
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
  const savedSnapshotRef = useRef(parsed ? snapshotOf(memo.title ?? "", parsed) : "");
  const saveRef = useRef<() => void>(() => undefined);
  titleRef.current = title;
  documentRef.current = document;
  editingRef.current = editing;

  useEffect(() => {
    // Keep the displayed table and its save base in sync after AI/server edits.
    // An active local edit must retain its original revision for conflict checks.
    if (!parsed || dirty || saving || editing || memo.revision < memoRef.current.revision) return;
    const nextTitle = memo.title ?? "";
    const nextSnapshot = snapshotOf(nextTitle, parsed);
    memoRef.current = memo;
    if (nextSnapshot === savedSnapshotRef.current) return;
    setTitle(nextTitle);
    titleRef.current = nextTitle;
    setDocument(parsed);
    documentRef.current = parsed;
    savedSnapshotRef.current = nextSnapshot;
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
    setDirty(snapshotOf(titleRef.current, next) !== savedSnapshotRef.current);
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

  const save = async () => {
    const currentMemo = memoRef.current;
    const currentDocument = documentRef.current;
    const editSession = editSessionRef.current;
    if (!currentDocument || !editSession || readOnly || saving) return false;
    if (editingRef.current) commitEditing(draftRef.current);
    const nextDocument = documentRef.current;
    if (!nextDocument) return false;
    const nextSnapshot = snapshotOf(titleRef.current, nextDocument);
    if (savedSnapshotRef.current === nextSnapshot) {
      setDirty(false);
      return true;
    }
    setSaving(true);
    setSaveError(null);
    setSaveFailed(false);
    try {
      const result = await repository.updateMemo(currentMemo, {
        expectedRevision: currentMemo.revision,
        expectedContentHash: currentMemo.contentHash,
        editSessionId: editSession.id,
        title: titleRef.current,
        contentJson: markdownToDoc(tableFallbackMarkdown(nextDocument)),
        contentMarkdown: serializeTableDocument(nextDocument),
        tags: currentMemo.tags,
      });
      memoRef.current = result.memo;
      savedSnapshotRef.current = nextSnapshot;
      const keptAttachmentIds = listTableAttachmentResourceIds(nextDocument);
      for (const resourceId of pendingUploadIdsRef.current) {
        if (keptAttachmentIds.has(resourceId)) continue;
        pendingUploadIdsRef.current.delete(resourceId);
        void repository.deleteResource(resourceId).catch(() => undefined);
      }
      pendingUploadIdsRef.current.clear();
      const hasNewChanges = snapshotOf(titleRef.current, documentRef.current ?? nextDocument) !== nextSnapshot;
      setDirty(hasNewChanges);
      if (!hasNewChanges) await onSaved(result.memo);
      return true;
    } catch (error) {
      setSaveFailed(true);
      setSaveError(error instanceof Error ? error.message : t("structuredTable.saveError"));
      return false;
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = () => { void save(); };

  useEffect(() => {
    if (readOnly || !dirty || saving || !editSessionReady || saveFailed || editing) return;
    const timer = window.setTimeout(() => saveRef.current(), EDITOR_LOCAL_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, editSessionReady, editing, readOnly, saveFailed, saving]);

  const visibleRecords = useMemo(() => (document ? applyTableView(document) : []), [document]);
  const columns = useMemo<ColumnDef<TableRecord>[]>(() => {
    if (!document) return [];
    return [
      ...document.fields.map((field): ColumnDef<TableRecord> => ({
        id: field.id,
        header: () => <FieldHeader document={document} field={field} readOnly={readOnly} onChange={changeDocument} />,
        cell: ({ row }) => (
          <RecordCell
            document={document}
            field={field}
            record={row.original}
            active={editing?.recordId === row.original.id && editing.fieldId === field.id}
            readOnly={readOnly}
            memoId={memo.id}
            repository={repository}
            onAdd={(attachment) => {
              const current = documentRef.current;
              const rowRecord = current?.records.find((item) => item.id === row.original.id);
              const existing = attachmentItems(rowRecord?.cells[field.id] ?? null);
              if (!current || existing.length >= TABLE_ATTACHMENT_LIMIT || existing.some((item) => item.resourceId === attachment.resourceId)) return false;
              changeDocument(updateTableCell(current, row.original.id, field.id, [...existing, attachment]));
              return true;
            }}
            onRemove={(resourceId) => {
              const current = documentRef.current;
              const rowRecord = current?.records.find((item) => item.id === row.original.id);
              if (!current || !rowRecord) return;
              if (pendingUploadIdsRef.current.has(resourceId)) {
                pendingUploadIdsRef.current.delete(resourceId);
                void repository.deleteResource(resourceId).catch(() => undefined);
              }
              changeDocument(updateTableCell(current, row.original.id, field.id, attachmentItems(rowRecord.cells[field.id] ?? null).filter((item) => item.resourceId !== resourceId)));
            }}
            onUploaded={(resourceId) => pendingUploadIdsRef.current.add(resourceId)}
            onEdit={(cell) => {
              editingRef.current = cell;
              if (cell) draftRef.current = displayCell(field, row.original.cells[field.id] ?? null);
              setEditing(cell);
            }}
            onCommit={commitEditing}
            onDraft={(value) => { draftRef.current = value; }}
            onChange={changeDocument}
          />
        ),
      })),
      {
        id: "record-actions",
        header: () => null,
        cell: ({ row }) => (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("structuredTable.deleteRecord")}
                disabled={readOnly}
                onClick={() => changeDocument(removeTableRecord(document, row.original.id))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("structuredTable.deleteRecord")}</TooltipContent>
          </Tooltip>
        ),
      },
    ];
  }, [document, editing, memo.id, readOnly, repository, t]);

  const table = useReactTable({ data: visibleRecords, columns, getCoreRowModel: getCoreRowModel(), getRowId: (row) => row.id });

  const assistantMarkdown = document ? serializeTableDocument(document) : memo.contentMarkdown;
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

  if (!document) {
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

  const filtered = document.view.filters.length > 0;
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
      savedSnapshotRef.current = snapshotOf(nextTitle, next);
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

  const exportCsv = () => {
    const blob = new Blob([tableDocumentToCsv(document, visibleRecords)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    const fileName = (title.trim() || t("structuredTable.name")).replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
    link.href = url;
    link.download = `${fileName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const setFilter = (index: number, filter: TableFilter) => {
    const filters = document.view.filters.map((item, itemIndex) => itemIndex === index ? filter : item);
    changeDocument(replaceTableView(document, { ...document.view, filters }));
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 bg-card">
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
              if (documentRef.current) setDirty(snapshotOf(value, documentRef.current) !== savedSnapshotRef.current);
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
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <span className="text-xs text-slate-500">{t("structuredTable.filter")}</span>
        {document.view.filters.map((filter, index) => {
          const operatorNeedsValue = filter.operator === "contains" || filter.operator === "eq";
          return (
            <div key={`${filter.fieldId}-${index}`} className="flex items-center gap-1">
              <select
                className={controlClassName}
                value={filter.fieldId}
                aria-label={t("structuredTable.filter")}
                disabled={readOnly}
                onChange={(event) => {
                  const fieldId = event.target.value;
                  const attachmentField = document.fields.find((field) => field.id === fieldId)?.type === "attachment";
                  const operator = attachmentField && (filter.operator === "contains" || filter.operator === "eq") ? "notEmpty" : filter.operator;
                  setFilter(index, { ...filter, fieldId, operator });
                }}
              >
                {document.fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
              </select>
              <select
                className={controlClassName}
                value={filter.operator}
                aria-label={t("structuredTable.filter")}
                disabled={readOnly}
                onChange={(event) => setFilter(index, { ...filter, operator: event.target.value as TableFilterOperator })}
              >
                {(document.fields.find((field) => field.id === filter.fieldId)?.type === "attachment" ? TABLE_ATTACHMENT_FILTER_OPERATORS : TABLE_FILTER_OPERATORS).map((operator) => <option key={operator} value={operator}>{t(`structuredTable.operators.${operator}`)}</option>)}
              </select>
              {operatorNeedsValue ? (
                <Input
                  className="h-8 w-36 text-xs"
                  value={filter.value ?? ""}
                  placeholder={t("structuredTable.filterValue")}
                  aria-label={t("structuredTable.filterValue")}
                  disabled={readOnly}
                  onChange={(event) => setFilter(index, { ...filter, value: event.target.value })}
                />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("structuredTable.clearFilters")}
                disabled={readOnly}
                onClick={() => changeDocument(replaceTableView(document, {
                  ...document.view,
                  filters: document.view.filters.filter((_, itemIndex) => itemIndex !== index),
                }))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={readOnly || document.view.filters.length >= 8}
          onClick={() => changeDocument(replaceTableView(document, {
            ...document.view,
            filters: [...document.view.filters, { fieldId: document.fields[0]?.id ?? "", operator: "contains", value: "" }],
          }))}
        >
          {t("structuredTable.addFilter")}
        </Button>
        <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
          <span>{t("structuredTable.sort")}</span>
          <select
            className={controlClassName}
            value={document.view.sort?.fieldId ?? ""}
            aria-label={t("structuredTable.sort")}
            disabled={readOnly}
            onChange={(event) => changeDocument(replaceTableView(document, {
              ...document.view,
              sort: event.target.value ? { fieldId: event.target.value, direction: document.view.sort?.direction ?? "asc" } : null,
            }))}
          >
            <option value="">{t("structuredTable.noSort")}</option>
            {document.fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
          </select>
          <select
            className={controlClassName}
            value={document.view.sort?.direction ?? "asc"}
            aria-label={t("structuredTable.sort")}
            disabled={readOnly || !document.view.sort}
            onChange={(event) => {
              if (!document.view.sort) return;
              changeDocument(replaceTableView(document, {
                ...document.view,
                sort: { ...document.view.sort, direction: event.target.value === "desc" ? "desc" : "asc" },
              }));
            }}
          >
            <option value="asc">{t("structuredTable.ascending")}</option>
            <option value="desc">{t("structuredTable.descending")}</option>
          </select>
        </label>
      </div>
      <TableFormDialog
        memoId={memo.id}
        memoTitle={title}
        fields={document.fields}
        open={formOpen}
        onOpenChange={setFormOpen}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-slate-200">
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-2 py-1 text-left font-medium">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-2 py-1 align-top">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {visibleRecords.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-500">{filtered ? t("structuredTable.noMatches") : t("structuredTable.empty")}</p>
        ) : null}
      </div>
      {assistantLauncher}
    </div>
    {assistantSidebar}
    </div>
  );
};

export default TableEditorPane;
