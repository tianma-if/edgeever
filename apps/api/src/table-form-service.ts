import {
  addTableRecord,
  createTableId,
  markdownToDoc,
  parseTableDocument,
  parseTableDocumentMetadata,
  serializeTableDocument,
  tableFallbackMarkdown,
  TABLE_ATTACHMENT_LIMIT,
  TABLE_RECORD_LIMIT,
  updateTableCell,
  type TableAttachment,
  type TableCellValue,
  type TableDocument,
  type TableField,
  type TableFormFieldSetting,
} from "@edgeever/shared";
import { AppError } from "./app-error";
import { applySharedMemoRecords, getMemoDetail, getSharedMemoWriteState, getTableMemoSource, updateMemoRecord } from "./memo-service";
import type { DatabaseAdapter } from "./storage-contract";

export const TABLE_FORM_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;

export type TableFormRow = {
  id: string;
  memo_id: string;
  workspace_id: string;
  token: string;
  enabled: number;
  password_hash: string | null;
  title: string;
  description: string;
  submit_label: string;
  fields_json: string;
  created_by: string | null;
  submit_count: number;
  submit_window_started_at: string | null;
};

export const parseTableFormFields = (value: string): TableFormFieldSetting[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const field = item as { fieldId?: unknown; required?: unknown };
      if (typeof field.fieldId !== "string" || !field.fieldId) return [];
      return [{ fieldId: field.fieldId, required: field.required === true }];
    });
  } catch {
    return [];
  }
};

const submissionValue = (field: TableField, value: unknown, attachments: Map<string, TableAttachment>) => {
  if (field.type === "attachment") {
    const ids = Array.isArray(value) ? value : [];
    const files: TableAttachment[] = [];
    for (const item of ids) {
      const resourceId = typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof (item as { resourceId?: unknown }).resourceId === "string"
          ? (item as { resourceId: string }).resourceId
          : "";
      const file = attachments.get(resourceId);
      if (!file || files.some((current) => current.resourceId === file.resourceId)) continue;
      files.push(file);
      if (files.length >= TABLE_ATTACHMENT_LIMIT) break;
    }
    return files;
  }
  if (field.type === "select") {
    const option = typeof value === "string" ? value.trim() : "";
    if (option && !(field.options ?? []).includes(option)) {
      throw new AppError("table_form_invalid", "Choose one of the listed options.", 400);
    }
    return option;
  }
  if (field.type === "url") {
    const url = typeof value === "string" ? value.trim() : "";
    if (url && !URL_PATTERN.test(url)) throw new AppError("table_form_invalid", "Enter a link that starts with http:// or https://.", 400);
    return url;
  }
  if (field.type === "date") {
    const date = typeof value === "string" ? value.trim() : "";
    if (date && !DATE_PATTERN.test(date)) throw new AppError("table_form_invalid", "Enter a date as YYYY-MM-DD.", 400);
    return date;
  }
  if (field.type === "number") {
    if (value === null || value === undefined || value === "") return null;
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) throw new AppError("table_form_invalid", "Enter a number.", 400);
    return number;
  }
  if (field.type === "checkbox") return value === true || value === "true" || value === 1 || value === "1";
  return typeof value === "string" ? value.slice(0, 2000) : value == null ? "" : String(value).slice(0, 2000);
};

const valueMissing = (field: TableField, value: TableCellValue) => {
  if (field.type === "checkbox") return value !== true;
  if (field.type === "number") return value === null;
  if (field.type === "attachment") return !Array.isArray(value) || value.length === 0;
  return value === null || value === "";
};

export const buildTableFormSubmission = (
  document: TableDocument,
  configured: TableFormFieldSetting[],
  cells: Record<string, unknown>,
  attachments: Map<string, TableAttachment>,
) => {
  const fields = new Map(document.fields.map((field) => [field.id, field]));
  const nextCells: Record<string, TableCellValue> = {};
  for (const setting of configured) {
    const field = fields.get(setting.fieldId);
    if (!field) continue;
    const value = submissionValue(field, cells[field.id], attachments);
    if (setting.required && valueMissing(field, value)) {
      throw new AppError("table_form_required", "Fill in every required field.", 400);
    }
    nextCells[field.id] = value;
  }
  const requested = new Set<string>();
  for (const value of Object.values(nextCells)) {
    if (!Array.isArray(value)) continue;
    for (const file of value) requested.add(file.resourceId);
  }
  for (const resourceId of requested) {
    if (!attachments.has(resourceId)) throw new AppError("table_form_invalid", "Upload the attachment again.", 400);
  }
  return nextCells;
};

export const getTableFormSource = async (db: DatabaseAdapter, workspaceId: string, memoId: string) => {
  const shared = await getSharedMemoWriteState(db, workspaceId, memoId);
  if (shared) {
    const header = JSON.parse(shared.header_json) as TableDocument;
    return { title: shared.title, document: { fields: header.fields, recordCount: shared.row_count } };
  }
  const memo = await getTableMemoSource(db, workspaceId, memoId);
  return { title: memo?.title, document: parseTableDocumentMetadata(memo?.contentMarkdown) };
};

export const appendTableFormSubmission = async (
  db: DatabaseAdapter,
  form: TableFormRow,
  cells: Record<string, unknown>,
  attachments: Map<string, TableAttachment>,
) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shared = await getSharedMemoWriteState(db, form.workspace_id, form.memo_id);
    if (shared) {
      if (shared.row_count >= TABLE_RECORD_LIMIT) throw new AppError("table_record_limit", "This form is no longer accepting responses.", 409);
      const header = JSON.parse(shared.header_json) as TableDocument;
      const values = buildTableFormSubmission(header, parseTableFormFields(form.fields_json), cells, attachments);
      const record = addTableRecord(header, createTableId("rec")).records[0];
      record.cells = { ...record.cells, ...values };
      try {
        await applySharedMemoRecords(db, form.workspace_id, shared, header, { puts: [record], deletes: [] },
          { actorType: "user", actorId: form.created_by }, "table-form");
        return { usedResourceIds: Object.values(values).flatMap((value) => Array.isArray(value) ? value.map((file) => file.resourceId) : []) };
      } catch (error) {
        if (error instanceof AppError && error.code === "revision_conflict") continue;
        throw error;
      }
    }
    const current = await getMemoDetail(db, form.workspace_id, form.memo_id);
    if (!current) throw new AppError("not_found", "Form not found", 404);
    const document = parseTableDocument(current.contentMarkdown);
    if (!document) throw new AppError("not_found", "Form not found", 404);
    if (document.records.length >= TABLE_RECORD_LIMIT) {
      throw new AppError("table_record_limit", "This form is no longer accepting responses.", 409);
    }
    const nextCells = buildTableFormSubmission(document, parseTableFormFields(form.fields_json), cells, attachments);
    const recordId = createTableId("rec");
    let next = addTableRecord(document, recordId);
    for (const [fieldId, value] of Object.entries(nextCells)) {
      next = updateTableCell(next, recordId, fieldId, value);
    }
    const saved = await updateMemoRecord(
      db,
      form.workspace_id,
      form.memo_id,
      {
        expectedRevision: current.revision,
        contentMarkdown: serializeTableDocument(next),
        contentJson: markdownToDoc(tableFallbackMarkdown(next)),
        tags: current.tags,
      },
      { actorType: "user", actorId: form.created_by },
      "table-form",
      false,
    );
    if ("memo" in saved) {
      const usedResourceIds = Object.values(nextCells).flatMap((value) => (
        Array.isArray(value) ? value.map((file) => file.resourceId) : []
      ));
      return { usedResourceIds };
    }
    if (saved.error !== "revision_conflict" && saved.error !== "content_conflict") {
      throw new AppError(saved.error, saved.message, saved.status ?? 409);
    }
  }
  throw new AppError("revision_conflict", "The form was updated while submitting. Try again.", 409);
};
