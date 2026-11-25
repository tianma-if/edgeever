import { useEffect, useRef, useState } from "react";
import { AtSign, CalendarDays, Check, Clock, Coins, Copy, Download, ExternalLink, Gauge, Hash, Link2, List, ListChecks, Paperclip, Pencil, Percent, Phone, Plus, SquareCheck, Star, Trash2, Type, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  removeTableField,
  tableFieldIsComputed,
  TABLE_ATTACHMENT_LIMIT,
  TABLE_FIELD_TYPES,
  tableAttachmentUrl,
  tableAttachmentValues,
  tableCellDisplayText,
  updateTableCell,
  updateTableField,
  type TableAttachment,
  type TableCellValue,
  type TableDocument,
  type TableField,
  type TableFieldType,
  type TableRecord,
} from "@edgeever/shared";
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
import { OptionPill } from "./option-pill";
import { ResourceImage } from "@/components/table/ResourceImage";
import { readImageCompressionPreference } from "@/lib/app-helpers";
import { copyImageUrlToClipboard } from "@/lib/clipboard";
import { compressImageForUpload } from "@/lib/image-compression";
import { toDesktopResourceDownloadUrl, toDesktopResourceUrl } from "@/lib/desktop-resources";
import { resolveSafeTableUrl } from "@/lib/table-url";
import type { EdgeEverRepository } from "@/lib/repository";

export type EditingCell = { recordId: string; fieldId: string };
export type AttachmentUploadState = "uploading" | { error: string };

export const attachmentUploadKey = (recordId: string, fieldId: string) => JSON.stringify([recordId, fieldId]);

export const controlClassName = "h-8 rounded-md border border-slate-200 bg-card px-2 text-xs text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:cursor-not-allowed disabled:opacity-50";

export const FIELD_ICONS: Record<TableFieldType, typeof Type> = {
  text: Type,
  number: Hash,
  checkbox: SquareCheck,
  date: CalendarDays,
  select: List,
  multiSelect: ListChecks,
  url: Link2,
  phone: Phone,
  email: AtSign,
  autoNumber: Hash,
  attachment: Paperclip,
  createdTime: Clock,
  updatedTime: Clock,
  progress: Gauge,
  rating: Star,
  currency: Coins,
  percent: Percent,
};

export const optionText = (field: TableField) => (field.options ?? []).join(", ");

export const parseOptionText = (value: string) => value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);

export const displayCell = (field: TableField, value: TableCellValue, recordIndex?: number) => {
  if (field.type === "checkbox") return value === true ? "true" : "false";
  if (field.type === "autoNumber") return tableCellDisplayText(field, value, recordIndex);
  const attachments = tableAttachmentValues(value);
  if (attachments) return attachments.map((item) => item.filename).join(", ");
  if (value === null || value === undefined || value === "") return "";
  return tableCellDisplayText(field, value, recordIndex);
};

export const FieldHeader = ({
  document,
  field,
  readOnly,
  onChange,
  onConfigure,
}: {
  document: TableDocument;
  field: TableField;
  readOnly: boolean;
  onChange: (document: TableDocument) => void;
  onConfigure?: (field: TableField) => void;
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(field.name);
  const [options, setOptions] = useState(optionText(field));
  const Icon = FIELD_ICONS[field.type];
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
          className="flex w-full min-w-36 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
          aria-label={t("structuredTable.editField", { name: field.name })}
          disabled={readOnly}
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{field.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 space-y-2 p-2">
        {onConfigure ? (
          <DropdownMenuItem onSelect={() => onConfigure(field)}>
            <Pencil className="h-4 w-4" />
            {t("structuredTable.configureField")}
          </DropdownMenuItem>
        ) : null}
        {onConfigure ? null : (
        <label className="block space-y-1 text-xs text-slate-500">
          <span>{t("structuredTable.fieldName")}</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} onBlur={commitName} aria-label={t("structuredTable.fieldName")} />
        </label>
        )}
        {onConfigure ? null : (
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
        )}
        {!onConfigure && (field.type === "select" || field.type === "multiSelect") ? (
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

export const attachmentItems = (value: TableCellValue): TableAttachment[] => tableAttachmentValues(value) ?? [];

export const isImageAttachment = (item: TableAttachment) => item.mimeType.toLowerCase().startsWith("image/");

export const downloadTableAttachment = (href: string, filename: string) => {
  const anchor = document.createElement("a");
  anchor.href = toDesktopResourceDownloadUrl(href, filename);
  anchor.download = filename;
  anchor.rel = "noreferrer";
  anchor.click();
};

export const AttachmentCell = ({
  field,
  record,
  memoId,
  readOnly,
  repository,
  onAdd,
  onRemove,
  onUploaded,
  uploadState,
  onUploadState,
}: {
  field: TableField;
  record: TableRecord;
  memoId: string;
  readOnly: boolean;
  repository: EdgeEverRepository;
  onAdd: (attachment: TableAttachment) => boolean;
  onRemove: (resourceId: string) => void;
  onUploaded: (resourceId: string) => void;
  uploadState: AttachmentUploadState | undefined;
  onUploadState: (state: AttachmentUploadState | undefined) => void;
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<number | null>(null);
  const uploading = uploadState === "uploading";
  const uploadError = typeof uploadState === "object" ? uploadState.error : null;
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
    if (!files?.length || readOnly || uploading) return;
    onUploadState("uploading");
    try {
      for (const file of files) {
        // Posters and screenshots are often tens of megabytes; the workspace image
        // preference applies here exactly as it does to editor uploads.
        const uploadFile = file.type.startsWith("image/") && readImageCompressionPreference()
          ? await compressImageForUpload(file).then((result) => result.file).catch(() => file)
          : file;
        const { resource } = await repository.uploadMemoResource(memoId, uploadFile);
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
      onUploadState(undefined);
    } catch (error) {
      onUploadState({ error: error instanceof Error ? error.message : t("structuredTable.saveError") });
    } finally {
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
                    <ResourceImage resourceId={item.resourceId} width={96} />
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

export const MultiSelectCell = ({
  document,
  field,
  record,
  active,
  readOnly,
  onEdit,
  onChange,
}: {
  document: TableDocument;
  field: TableField;
  record: TableRecord;
  active: boolean;
  readOnly: boolean;
  onEdit: (cell: EditingCell | null) => void;
  onChange: (document: TableDocument) => void;
}) => {
  const { t } = useTranslation();
  const selected = Array.isArray(record.cells[field.id])
    ? (record.cells[field.id] as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const options = field.options ?? [];
  const toggle = (option: string, checked: boolean) => {
    const next = checked ? [...selected, option] : selected.filter((item) => item !== option);
    onChange(updateTableCell(document, record.id, field.id, next));
  };
  const badges = selected.length ? (
    <span className="inline-flex min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-hidden">
      {selected.map((option) => <OptionPill key={option} field={field} option={option} className="shrink-0" />)}
    </span>
  ) : <span className="text-slate-300">—</span>;

  if (!active) {
    return (
      <button
        type="button"
        className="flex h-8 w-full min-w-36 items-center rounded-md px-2 text-left text-sm text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:hover:bg-transparent"
        disabled={readOnly}
        onClick={() => onEdit({ recordId: record.id, fieldId: field.id })}
      >
        {badges}
      </button>
    );
  }

  return (
    <div className="relative h-8 w-full min-w-36">
      <button
        type="button"
        className="flex h-8 w-full items-center rounded-md px-2 text-left text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
        onClick={() => onEdit(null)}
      >
        {badges}
      </button>
      <div className="absolute left-0 top-9 z-40 w-56 rounded-md border border-slate-200 bg-card p-2 shadow-lg">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-600">{field.name}</span>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label={t("actions.close")} onClick={() => onEdit(null)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {options.map((option) => (
            <label key={option} className="flex items-center gap-2 rounded px-1 py-1 text-sm text-slate-700 hover:bg-slate-50">
              <Checkbox
                checked={selected.includes(option)}
                aria-label={option}
                onCheckedChange={(checked) => toggle(option, checked === true)}
              />
              <OptionPill field={field} option={option} />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};

export const RecordCell = ({
  document,
  field,
  record,
  recordIndex,
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
  uploadState,
  onUploadState,
}: {
  document: TableDocument;
  field: TableField;
  record: TableRecord;
  recordIndex: number;
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
  uploadState: AttachmentUploadState | undefined;
  onUploadState: (state: AttachmentUploadState | undefined) => void;
}) => {
  const { t } = useTranslation();
  const value = record.cells[field.id] ?? null;
  const text = displayCell(field, value, recordIndex);
  const rawText = value === null || value === undefined || Array.isArray(value) ? "" : String(value);
  const [draft, setDraft] = useState(rawText);
  useEffect(() => { if (active) setDraft(rawText); }, [active, rawText]);
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
        uploadState={uploadState}
        onUploadState={onUploadState}
      />
    );
  }
  if (field.type === "autoNumber" || tableFieldIsComputed(field.type)) {
    return (
      <span className="block h-8 min-w-36 truncate px-2 text-sm leading-8 text-slate-600" title={text} data-testid={`computed-cell-${field.type}`}>
        {text}
      </span>
    );
  }
  if (field.type === "progress" && !active) {
    const percent = typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0;
    return (
      <div className="flex h-8 min-w-36 items-center gap-2 px-2">
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <span className="block h-full rounded-full bg-sky-500" style={{ width: `${percent}%` }} />
        </span>
        <span className="text-xs tabular-nums text-slate-600">{Math.round(percent)}%</span>
      </div>
    );
  }
  if (field.type === "rating" && !active) {
    const score = typeof value === "number" ? value : 0;
    return (
      <div className="flex h-8 min-w-36 items-center gap-0.5 px-2" role="img" aria-label={t("structuredTable.ratingValue", { value: score })}>
        {[1, 2, 3, 4, 5].map((step) => (
          <span key={step} className={step <= score ? "text-amber-500" : "text-slate-300"} aria-hidden="true">★</span>
        ))}
      </div>
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
  if (field.type === "multiSelect") {
    return (
      <MultiSelectCell
        document={document}
        field={field}
        record={record}
        active={active}
        readOnly={readOnly}
        onEdit={onEdit}
        onChange={onChange}
      />
    );
  }
  if (!active) {
    const safeUrl = field.type === "url" ? resolveSafeTableUrl(text) : null;
    if (safeUrl) {
      return (
        <div className="group/url-cell flex h-8 w-full min-w-36 items-center gap-1 px-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 flex-1 items-center gap-1 rounded-sm text-sm text-foreground underline decoration-foreground/40 underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20"
                aria-label={t("structuredTable.openUrl", { url: safeUrl })}
              >
                <span className="truncate">{text}</span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
              </a>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs break-all">{t("structuredTable.openUrl", { url: safeUrl })}</TooltipContent>
          </Tooltip>
          {!readOnly ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 opacity-70 transition-opacity md:opacity-0 md:group-hover/url-cell:opacity-100 md:group-focus-within/url-cell:opacity-100 focus-visible:opacity-100"
                  aria-label={t("structuredTable.editUrl", { name: field.name })}
                  onClick={() => onEdit({ recordId: record.id, fieldId: field.id })}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("structuredTable.editUrlTooltip")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      );
    }
    return (
      <button
        type="button"
        className="block h-8 w-full min-w-36 truncate rounded-md px-2 text-left text-sm text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:hover:bg-transparent"
        disabled={readOnly}
        onClick={() => onEdit({ recordId: record.id, fieldId: field.id })}
      >
        {text && field.type === "select" ? (
          <OptionPill field={field} option={text} className="align-middle" />
        ) : text || <span className="text-slate-300">—</span>}
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
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "url" ? "url" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
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