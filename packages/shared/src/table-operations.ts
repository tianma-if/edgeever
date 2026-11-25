import {
  addTableField,
  addTableRecord,
  removeTableRecord,
  updateTableCell,
  TABLE_RECORD_LIMIT,
  createTableId,
  listTableAttachmentResourceIds,
  parseTableDocument,
  removeTableField,
  serializeTableDocument,
  TABLE_ATTACHMENT_LIMIT,
  TABLE_EMAIL_PATTERN,
  TABLE_FIELD_LIMIT,
  TABLE_FIELD_TYPES,
  TABLE_PHONE_PATTERN,
  TABLE_SELECT_OPTION_LIMIT,
  updateTableField,
  tableFieldIsComputed,
  TABLE_RATING_MAX,
  type TableAttachment,
  type TableDocument,
  type TableField,
  type TableFieldType,
} from "./table";
import { StructuredNoteError, requiredStructuredString as getRequiredString } from "./structured-note-error";


export const validateTableCells = async (
  resolveAttachment: (resourceId: string) => Promise<TableAttachment | null>,
  document: TableDocument,
  value: unknown,
  allowEmpty: boolean,
) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StructuredNoteError("invalid_params", "cells must be an object keyed by field ID", 400);
  }
  const cells = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  if (!allowEmpty && Object.keys(cells).length === 0) {
    throw new StructuredNoteError("invalid_params", "cells must include at least one field", 400);
  }
  const fields = new Map(document.fields.map((field) => [field.id, field]));
  for (const [fieldId, cell] of Object.entries(cells)) {
    const field = fields.get(fieldId);
    if (!field) throw new StructuredNoteError("invalid_params", `Unknown table field: ${fieldId}`, 400);
    if (field.type === "attachment") {
      if (!Array.isArray(cell) || cell.length > TABLE_ATTACHMENT_LIMIT || cell.some((id) => typeof id !== "string")) {
        throw new StructuredNoteError("invalid_params", `${fieldId} requires an array of up to ${TABLE_ATTACHMENT_LIMIT} resource IDs`, 400);
      }
      if (new Set(cell).size !== cell.length) {
        throw new StructuredNoteError("invalid_params", `${fieldId} contains duplicate resource IDs`, 400);
      }
      const attachments = [];
      for (const resourceId of cell) {
        const resource = await resolveAttachment(resourceId);
        if (!resource) throw new StructuredNoteError("invalid_params", `Attachment resource not found in this memo: ${resourceId}`, 400);
        attachments.push(resource);
      }
      normalized[fieldId] = attachments;
      continue;
    }
    // Computed and auto-number fields are derived at read time, so writes are rejected instead of stored.
    if (field.type === "autoNumber" || tableFieldIsComputed(field.type)) {
      throw new StructuredNoteError("invalid_params", `${fieldId} is read-only`, 400);
    }
    if (field.type === "checkbox") {
      if (typeof cell !== "boolean") throw new StructuredNoteError("invalid_params", `${fieldId} requires a boolean`, 400);
    } else if (field.type === "number") {
      if (cell !== null && (typeof cell !== "number" || !Number.isFinite(cell))) {
        throw new StructuredNoteError("invalid_params", `${fieldId} requires a finite number or null`, 400);
      }
    } else if (field.type === "progress") {
      if (cell !== null && (typeof cell !== "number" || !Number.isFinite(cell) || cell < 0 || cell > 100)) {
        throw new StructuredNoteError("invalid_params", `${fieldId} requires a number between 0 and 100 or null`, 400);
      }
    } else if (field.type === "rating") {
      if (cell !== null && (typeof cell !== "number" || !Number.isInteger(cell) || cell < 0 || cell > TABLE_RATING_MAX)) {
        throw new StructuredNoteError("invalid_params", `${fieldId} requires an integer between 0 and ${TABLE_RATING_MAX} or null`, 400);
      }
    } else if (field.type === "currency" || field.type === "percent") {
      if (cell !== null && (typeof cell !== "number" || !Number.isFinite(cell))) {
        throw new StructuredNoteError("invalid_params", `${fieldId} requires a finite number or null`, 400);
      }
    } else if (field.type === "multiSelect") {
      if (!Array.isArray(cell) || cell.length > TABLE_SELECT_OPTION_LIMIT
        || cell.some((option) => typeof option !== "string" || !field.options?.includes(option))) {
        throw new StructuredNoteError("invalid_params", `${fieldId} requires an array of existing options`, 400);
      }
    } else if (cell !== null && (typeof cell !== "string" || cell.length > 2000)) {
      throw new StructuredNoteError("invalid_params", `${fieldId} requires a string of at most 2000 characters or null`, 400);
    }
    if (field.type === "select" && cell && !field.options?.includes(cell as string)) {
      throw new StructuredNoteError("invalid_params", `${fieldId} requires an existing option`, 400);
    }
    if (field.type === "date" && cell && !/^\d{4}-\d{2}-\d{2}$/.test(cell as string)) {
      throw new StructuredNoteError("invalid_params", `${fieldId} requires YYYY-MM-DD`, 400);
    }
    if (field.type === "url" && cell && !/^https?:\/\//i.test(cell as string)) {
      throw new StructuredNoteError("invalid_params", `${fieldId} requires an http:// or https:// URL`, 400);
    }
    if (field.type === "email" && cell && !TABLE_EMAIL_PATTERN.test(cell as string)) {
      throw new StructuredNoteError("invalid_params", `${fieldId} requires a valid email address`, 400);
    }
    if (field.type === "phone" && cell && !TABLE_PHONE_PATTERN.test(cell as string)) {
      throw new StructuredNoteError("invalid_params", `${fieldId} requires a valid phone number`, 400);
    }
    normalized[fieldId] = cell;
  }
  return normalized;
};

const tableObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StructuredNoteError("invalid_params", `${label} must be an object`, 400);
  }
  return value as Record<string, unknown>;
};

const tableFieldName = (value: unknown) => {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 80) {
    throw new StructuredNoteError("invalid_params", "Field name must have 1–80 characters", 400);
  }
  return name;
};

const tableFieldType = (value: unknown): TableFieldType => {
  if (typeof value !== "string" || !TABLE_FIELD_TYPES.includes(value as TableFieldType)) {
    throw new StructuredNoteError("invalid_params", "Unsupported table field type", 400);
  }
  return value as TableFieldType;
};

const tableFieldOptions = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > TABLE_SELECT_OPTION_LIMIT) {
    throw new StructuredNoteError("invalid_params", `Select fields require 1–${TABLE_SELECT_OPTION_LIMIT} options`, 400);
  }
  const options = value.map((option) => tableFieldName(option));
  if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
    throw new StructuredNoteError("invalid_params", "Select options must be unique", 400);
  }
  return options;
};

export const tableFieldInput = (value: unknown): TableField => {
  const input = tableObject(value, "field");
  if (Object.keys(input).some((key) => !["name", "type", "options"].includes(key))) {
    throw new StructuredNoteError("invalid_params", "field must include only name, type, or options", 400);
  }
  const type = tableFieldType(input.type);
  if (type !== "select" && type !== "multiSelect" && input.options !== undefined) {
    throw new StructuredNoteError("invalid_params", "Only select fields can have options", 400);
  }
  return {
    id: createTableId("fld"),
    name: tableFieldName(input.name),
    type,
    ...(type === "select" || type === "multiSelect" ? { options: tableFieldOptions(input.options) } : {}),
  };
};

export const ensureUniqueTableFieldName = (document: TableDocument, name: string, exceptId?: string) => {
  if (document.fields.some((field) => field.id !== exceptId && field.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new StructuredNoteError("invalid_params", `Duplicate table field name: ${name}`, 400);
  }
};

const tableFieldPatch = (current: TableField, value: unknown): Partial<Pick<TableField, "name" | "type" | "options">> => {
  const changes = tableObject(value, "changes");
  if (!Object.keys(changes).length || Object.keys(changes).some((key) => !["name", "type", "options"].includes(key))) {
    throw new StructuredNoteError("invalid_params", "changes must include only name, type, or options", 400);
  }
  const type = changes.type === undefined ? current.type : tableFieldType(changes.type);
  if (type !== "select" && type !== "multiSelect" && changes.options !== undefined) {
    throw new StructuredNoteError("invalid_params", "Only select fields can have options", 400);
  }
  if ((type === "select" || type === "multiSelect") && current.type !== type && changes.options === undefined) {
    throw new StructuredNoteError("invalid_params", `Changing to ${type} requires options`, 400);
  }
  return {
    ...(changes.name === undefined ? {} : { name: tableFieldName(changes.name) }),
    ...(changes.type === undefined ? {} : { type }),
    ...((type === "select" || type === "multiSelect") && changes.options !== undefined ? { options: tableFieldOptions(changes.options) } : {}),
  };
};

const validTableValueForField = (field: TableField, value: unknown) => {
  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return true;
  if (field.type === "select") return typeof value === "string" && Boolean(field.options?.includes(value));
  if (field.type === "multiSelect") return Array.isArray(value) && value.every((option) => typeof option === "string" && field.options?.includes(option));
  if (field.type === "date") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (field.type === "url") return typeof value === "string" && /^https?:\/\//i.test(value);
  if (field.type === "email") return typeof value === "string" && TABLE_EMAIL_PATTERN.test(value);
  if (field.type === "phone") return typeof value === "string" && TABLE_PHONE_PATTERN.test(value);
  return true;
};

export const applyTableSchemaOperations = (document: TableDocument, value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) {
    throw new StructuredNoteError("invalid_params", "operations must include 1–40 changes", 400);
  }
  let next = document;
  for (const valueItem of value) {
    const item = tableObject(valueItem, "operation");
    if (item.op === "add_field") {
      if (next.fields.length >= TABLE_FIELD_LIMIT) throw new StructuredNoteError("table_field_limit", "Table field limit reached", 409);
      const field = tableFieldInput(item.field);
      ensureUniqueTableFieldName(next, field.name);
      next = addTableField(next, field);
    } else if (item.op === "update_field") {
      const fieldId = getRequiredString(item.fieldId, "fieldId");
      const current = next.fields.find((field) => field.id === fieldId);
      if (!current) throw new StructuredNoteError("not_found", `Table field not found: ${fieldId}`, 404);
      const patch = tableFieldPatch(current, item.changes);
      if (patch.name !== undefined) ensureUniqueTableFieldName(next, patch.name, fieldId);
      next = updateTableField(next, fieldId, patch);
      const updated = next.fields.find((field) => field.id === fieldId)!;
      if (updated.type !== "select" && updated.options !== undefined) {
        next = { ...next, fields: next.fields.map((field) => field.id === fieldId ? { id: field.id, name: field.name, type: field.type } : field) };
      }
      const finalField = next.fields.find((field) => field.id === fieldId)!;
      if ((patch.type !== undefined || patch.options !== undefined) && ["select", "multiSelect", "date", "url", "email", "phone"].includes(finalField.type)) {
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
        throw new StructuredNoteError("not_found", `Table field not found: ${fieldId}`, 404);
      }
      if (next.fields.length === 1) throw new StructuredNoteError("invalid_params", "A table must keep at least one field", 400);
      next = removeTableField(next, fieldId);
    } else {
      throw new StructuredNoteError("invalid_params", "Unknown table schema operation", 400);
    }
  }
  if (!parseTableDocument(serializeTableDocument(next))) {
    throw new StructuredNoteError("invalid_params", "Schema changes produced an invalid table", 400);
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

/** Validates an entire batch before a host persists anything. */
export const applyTableOperations = async (
  document: TableDocument,
  operations: unknown,
  resolveAttachment: (resourceId: string) => Promise<TableAttachment | null>,
) => {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) {
    throw new StructuredNoteError("invalid_params", "operations must include 1–100 changes", 400);
  }
  let next = document;
  let changedCellCount = 0;
  for (const value of operations) {
    const item = tableObject(value, "operation");
    const keys = item.op === "add_field" ? ["op", "field"]
      : item.op === "update_field" ? ["op", "fieldId", "changes"]
      : item.op === "remove_field" ? ["op", "fieldId"]
      : item.op === "add_record" || item.op === "update_record" ? ["op", "recordId", "cells"]
      : item.op === "remove_record" ? ["op", "recordId"] : [];
    if (!keys.length || Object.keys(item).some(key => !keys.includes(key))) throw new StructuredNoteError("invalid_params", "Unsupported table operation or field", 400);
    if (item.op === "add_field" || item.op === "update_field" || item.op === "remove_field") {
      const updated = applyTableSchemaOperations(next, [item]);
      changedCellCount += tableSchemaImpact(next, updated).changedCellCount;
      next = updated;
      continue;
    }
    const recordId = item.op === "add_record" && item.recordId === undefined ? createTableId("rec") : getRequiredString(item.recordId, "recordId");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(recordId)) throw new StructuredNoteError("invalid_params", "Invalid table record ID", 400);
    const exists = next.records.some(record => record.id === recordId);
    if (item.op === "add_record") {
      if (exists) throw new StructuredNoteError("invalid_params", "Table record ID already exists", 400);
      if (next.records.length >= TABLE_RECORD_LIMIT) throw new StructuredNoteError("table_record_limit", "Table record limit reached", 409);
      next = addTableRecord(next, recordId);
    } else if (!exists) throw new StructuredNoteError("not_found", "Table record not found", 404);
    if (item.op === "remove_record") {
      next = removeTableRecord(next, recordId);
    } else {
      const cells = await validateTableCells(resolveAttachment, next, item.cells ?? (item.op === "add_record" ? {} : undefined), item.op === "add_record");
      for (const [fieldId, cell] of Object.entries(cells)) next = updateTableCell(next, recordId, fieldId, cell);
    }
  }
  if (!parseTableDocument(serializeTableDocument(next))) throw new StructuredNoteError("invalid_params", "Invalid resulting table", 400);
  return { document: next, ...tableSchemaImpact(document, next), changedCellCount };
};
