import {
  addTableField,
  createTableId,
  docToText,
  listTableAttachmentResourceIds,
  markdownToDoc,
  parseTableDocument,
  removeTableField,
  serializeTableDocument,
  stripTableDocumentMarker,
  TABLE_ATTACHMENT_LIMIT,
  TABLE_FIELD_LIMIT,
  TABLE_FIELD_TYPES,
  updateTableField,
  type MemoDetail,
  type TableDocument,
  type TableField,
  type TableFieldType,
} from "@edgeever/shared";
import { AppError } from "./app-error";
import { getRequiredString } from "./mcp-json-rpc";
import type { DatabaseAdapter } from "./storage-contract";

export const memoWithoutTablePayload = (memo: MemoDetail) => {
  const contentMarkdown = stripTableDocumentMarker(memo.contentMarkdown);
  const contentJson = markdownToDoc(contentMarkdown);
  return { ...memo, contentMarkdown, contentJson, contentText: docToText(contentJson) };
};

export const requiredTableRevision = (value: unknown) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AppError("invalid_params", "expectedRevision must be a non-negative integer", 400);
  }
  return value as number;
};

export const tableCellPatch = async (
  db: DatabaseAdapter,
  memoId: string,
  document: TableDocument,
  value: unknown,
  allowEmpty: boolean,
) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("invalid_params", "cells must be an object keyed by field ID", 400);
  }
  const cells = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  if (!allowEmpty && Object.keys(cells).length === 0) {
    throw new AppError("invalid_params", "cells must include at least one field", 400);
  }
  const fields = new Map(document.fields.map((field) => [field.id, field]));
  for (const [fieldId, cell] of Object.entries(cells)) {
    const field = fields.get(fieldId);
    if (!field) throw new AppError("invalid_params", `Unknown table field: ${fieldId}`, 400);
    if (field.type === "attachment") {
      if (!Array.isArray(cell) || cell.length > TABLE_ATTACHMENT_LIMIT || cell.some((id) => typeof id !== "string")) {
        throw new AppError("invalid_params", `${fieldId} requires an array of up to ${TABLE_ATTACHMENT_LIMIT} resource IDs`, 400);
      }
      if (new Set(cell).size !== cell.length) {
        throw new AppError("invalid_params", `${fieldId} contains duplicate resource IDs`, 400);
      }
      const attachments = [];
      for (const resourceId of cell) {
        const resource = await db.prepare(
          `SELECT id, filename, mime_type, byte_size FROM resources
           WHERE id = ? AND memo_id = ? AND kind = 'attachment' AND is_deleted = 0`,
        ).bind(resourceId, memoId).first<{ id: string; filename: string | null; mime_type: string | null; byte_size: number }>();
        if (!resource) throw new AppError("invalid_params", `Attachment resource not found in this memo: ${resourceId}`, 400);
        attachments.push({
          resourceId: resource.id,
          filename: resource.filename ?? "attachment",
          mimeType: resource.mime_type ?? "application/octet-stream",
          byteSize: resource.byte_size,
        });
      }
      normalized[fieldId] = attachments;
      continue;
    }
    if (field.type === "checkbox") {
      if (typeof cell !== "boolean") throw new AppError("invalid_params", `${fieldId} requires a boolean`, 400);
    } else if (field.type === "number") {
      if (cell !== null && (typeof cell !== "number" || !Number.isFinite(cell))) {
        throw new AppError("invalid_params", `${fieldId} requires a finite number or null`, 400);
      }
    } else if (cell !== null && (typeof cell !== "string" || cell.length > 2000)) {
      throw new AppError("invalid_params", `${fieldId} requires a string of at most 2000 characters or null`, 400);
    }
    if (field.type === "select" && cell && !field.options?.includes(cell as string)) {
      throw new AppError("invalid_params", `${fieldId} requires an existing option`, 400);
    }
    if (field.type === "date" && cell && !/^\d{4}-\d{2}-\d{2}$/.test(cell as string)) {
      throw new AppError("invalid_params", `${fieldId} requires YYYY-MM-DD`, 400);
    }
    if (field.type === "url" && cell && !/^https?:\/\//i.test(cell as string)) {
      throw new AppError("invalid_params", `${fieldId} requires an http:// or https:// URL`, 400);
    }
    normalized[fieldId] = cell;
  }
  return normalized;
};

const tableObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("invalid_params", `${label} must be an object`, 400);
  }
  return value as Record<string, unknown>;
};

const tableFieldName = (value: unknown) => {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 80) {
    throw new AppError("invalid_params", "Field name must have 1–80 characters", 400);
  }
  return name;
};

const tableFieldType = (value: unknown): TableFieldType => {
  if (typeof value !== "string" || !TABLE_FIELD_TYPES.includes(value as TableFieldType)) {
    throw new AppError("invalid_params", "Unsupported table field type", 400);
  }
  return value as TableFieldType;
};

const tableFieldOptions = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) {
    throw new AppError("invalid_params", "Select fields require 1–40 options", 400);
  }
  const options = value.map((option) => tableFieldName(option));
  if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
    throw new AppError("invalid_params", "Select options must be unique", 400);
  }
  return options;
};

export const tableFieldInput = (value: unknown): TableField => {
  const input = tableObject(value, "field");
  if (Object.keys(input).some((key) => !["name", "type", "options"].includes(key))) {
    throw new AppError("invalid_params", "field must include only name, type, or options", 400);
  }
  const type = tableFieldType(input.type);
  if (type !== "select" && input.options !== undefined) {
    throw new AppError("invalid_params", "Only select fields can have options", 400);
  }
  return {
    id: createTableId("fld"),
    name: tableFieldName(input.name),
    type,
    ...(type === "select" ? { options: tableFieldOptions(input.options) } : {}),
  };
};

export const ensureUniqueTableFieldName = (document: TableDocument, name: string, exceptId?: string) => {
  if (document.fields.some((field) => field.id !== exceptId && field.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new AppError("invalid_params", `Duplicate table field name: ${name}`, 400);
  }
};

const tableFieldPatch = (current: TableField, value: unknown): Partial<Pick<TableField, "name" | "type" | "options">> => {
  const changes = tableObject(value, "changes");
  if (!Object.keys(changes).length || Object.keys(changes).some((key) => !["name", "type", "options"].includes(key))) {
    throw new AppError("invalid_params", "changes must include only name, type, or options", 400);
  }
  const type = changes.type === undefined ? current.type : tableFieldType(changes.type);
  if (type !== "select" && changes.options !== undefined) {
    throw new AppError("invalid_params", "Only select fields can have options", 400);
  }
  if (type === "select" && current.type !== "select" && changes.options === undefined) {
    throw new AppError("invalid_params", "Changing to select requires options", 400);
  }
  return {
    ...(changes.name === undefined ? {} : { name: tableFieldName(changes.name) }),
    ...(changes.type === undefined ? {} : { type }),
    ...(type === "select" && changes.options !== undefined ? { options: tableFieldOptions(changes.options) } : {}),
  };
};

const validTableValueForField = (field: TableField, value: unknown) => {
  if (value === null || value === "") return true;
  if (field.type === "select") return typeof value === "string" && Boolean(field.options?.includes(value));
  if (field.type === "date") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (field.type === "url") return typeof value === "string" && /^https?:\/\//i.test(value);
  return true;
};

export const applyTableSchemaOperations = (document: TableDocument, value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) {
    throw new AppError("invalid_params", "operations must include 1–40 changes", 400);
  }
  let next = document;
  for (const valueItem of value) {
    const item = tableObject(valueItem, "operation");
    if (item.op === "add_field") {
      if (next.fields.length >= TABLE_FIELD_LIMIT) throw new AppError("table_field_limit", "Table field limit reached", 409);
      const field = tableFieldInput(item.field);
      ensureUniqueTableFieldName(next, field.name);
      next = addTableField(next, field);
    } else if (item.op === "update_field") {
      const fieldId = getRequiredString(item.fieldId, "fieldId");
      const current = next.fields.find((field) => field.id === fieldId);
      if (!current) throw new AppError("not_found", `Table field not found: ${fieldId}`, 404);
      const patch = tableFieldPatch(current, item.changes);
      if (patch.name !== undefined) ensureUniqueTableFieldName(next, patch.name, fieldId);
      next = updateTableField(next, fieldId, patch);
      const updated = next.fields.find((field) => field.id === fieldId)!;
      if (updated.type !== "select" && updated.options !== undefined) {
        next = { ...next, fields: next.fields.map((field) => field.id === fieldId ? { id: field.id, name: field.name, type: field.type } : field) };
      }
      const finalField = next.fields.find((field) => field.id === fieldId)!;
      if ((patch.type !== undefined || patch.options !== undefined) && ["select", "date", "url"].includes(finalField.type)) {
        next = {
          ...next,
          records: next.records.map((record) => validTableValueForField(finalField, record.cells[fieldId])
            ? record
            : { ...record, cells: { ...record.cells, [fieldId]: "" } }),
        };
      }
    } else if (item.op === "remove_field") {
      const fieldId = getRequiredString(item.fieldId, "fieldId");
      if (!next.fields.some((field) => field.id === fieldId)) {
        throw new AppError("not_found", `Table field not found: ${fieldId}`, 404);
      }
      if (next.fields.length === 1) throw new AppError("invalid_params", "A table must keep at least one field", 400);
      next = removeTableField(next, fieldId);
    } else {
      throw new AppError("invalid_params", "Unknown table schema operation", 400);
    }
  }
  if (!parseTableDocument(serializeTableDocument(next))) {
    throw new AppError("invalid_params", "Schema changes produced an invalid table", 400);
  }
  return next;
};

export const tableSchemaImpact = (before: TableDocument, after: TableDocument) => {
  const afterRecords = new Map(after.records.map((record) => [record.id, record]));
  let changedCellCount = 0;
  for (const record of before.records) {
    const nextRecord = afterRecords.get(record.id);
    for (const field of before.fields) {
      const oldValue = record.cells[field.id];
      const newValue = nextRecord?.cells[field.id];
      const hasValue = Array.isArray(oldValue) ? oldValue.length > 0 : oldValue !== null && oldValue !== "";
      if (hasValue && JSON.stringify(oldValue) !== JSON.stringify(newValue)) changedCellCount += 1;
    }
  }
  const retainedResources = listTableAttachmentResourceIds(after);
  return {
    changedCellCount,
    removedAttachmentCount: [...listTableAttachmentResourceIds(before)].filter((id) => !retainedResources.has(id)).length,
  };
};
