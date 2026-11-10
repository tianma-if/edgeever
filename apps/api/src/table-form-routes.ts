import {
  resolveResourceUploadMimeType,
  parseTableDocumentMetadata,
  TABLE_RECORD_LIMIT,
  PublicShareUnlockSchema,
  PublicTableFormSubmissionSchema,
  TableFormUpdateSchema,
  type PublicTableForm,
  type PublicTableFormField,
  type TableAttachment,
  type TableDocument,
  type TableFormFieldSetting,
  type TableFormSettings,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppContext, AppEnv } from "./api-context";
import { AppError } from "./app-error";
import { audit } from "./audit";
import { authenticateRequest } from "./auth-service";
import { hashPassword, randomToken, verifyPassword } from "./auth-crypto";
import { createId, isoNow } from "./entity-utils";
import { apiError, notFound } from "./http-errors";
import { getTableMemoSource } from "./memo-service";
import { getAuditActor, getWorkspaceId, requireUser } from "./request-auth";
import {
  createAttachmentResource,
  createImageResource,
  deleteReleasedResourceObjects,
  SUPPORTED_IMAGE_MIME_TYPES,
} from "./resource-service";
import {
  createShareAccessCookieValue,
  isShareUnlockBlocked,
  isValidShareAccessCookieValue,
  nextShareUnlockFailure,
  SHARE_ACCESS_MAX_AGE_SECONDS,
} from "./share-access";
import { generateSharePassword } from "./share-password";
import {
  appendTableFormSubmission,
  parseTableFormFields,
  TABLE_FORM_ATTACHMENT_BYTES,
  type TableFormRow,
} from "./table-form-service";

const FORM_TOKEN_BYTES = 32;
const FORM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FORM_COOKIE = "ee_form";
const FORM_SUBMIT_LIMIT = 30;
const FORM_SUBMIT_WINDOW_MS = 10 * 60 * 1000;
const PENDING_ATTACHMENT_MS = 60 * 60 * 1000;
// Uploads that were not submitted yet; stale ones are retired after an hour.
const PENDING_ATTACHMENT_LIMIT = 50;

const selectFormSql = `SELECT id, memo_id, workspace_id, token, enabled, password_hash, title, description,
  submit_label, fields_json, created_by, submit_count, submit_window_started_at
  FROM table_forms`;

const normalizeToken = (value: string) => {
  const token = value.trim();
  return FORM_TOKEN_PATTERN.test(token) ? token : null;
};

const cookiePath = (token: string) => `/api/public/forms/${encodeURIComponent(token)}`;

const loadForm = (c: AppContext, token: string) => c.env.storage.db.prepare(
  `${selectFormSql}
   WHERE token = ? AND enabled = 1
     AND EXISTS (
       SELECT 1 FROM memos m
       WHERE m.id = table_forms.memo_id AND m.workspace_id = table_forms.workspace_id AND m.is_deleted = 0
     )`,
).bind(token).first<TableFormRow>();

const allowForm = async (c: AppContext, form: TableFormRow) => {
  if (!form.password_hash) return true;
  if (await isValidShareAccessCookieValue(getCookie(c, FORM_COOKIE), form.password_hash, form.token)) return true;
  const auth = await authenticateRequest(c, false);
  return auth?.workspaceId === form.workspace_id;
};

const publicFields = (form: TableFormRow, document: Pick<TableDocument, "fields"> | null): PublicTableFormField[] => {
  if (!document) return [];
  const fields = new Map(document.fields.map((field) => [field.id, field]));
  return parseTableFormFields(form.fields_json).flatMap((setting) => {
    const field = fields.get(setting.fieldId);
    if (!field) return [];
    const view: PublicTableFormField = {
      id: field.id,
      name: field.name,
      type: field.type,
      required: setting.required,
    };
    if (field.type === "select") view.options = field.options ?? [];
    return [view];
  });
};

const mapOwnerForm = (row: TableFormRow, password?: string): TableFormSettings => ({
  enabled: row.enabled === 1,
  token: row.token,
  passwordProtected: Boolean(row.password_hash),
  ...(password ? { password } : {}),
  title: row.title,
  description: row.description,
  submitLabel: row.submit_label,
  fields: parseTableFormFields(row.fields_json),
});

const activeFieldSettings = (document: Pick<TableDocument, "fields">, fields: TableFormFieldSetting[]) => {
  const ids = new Set(document.fields.map((field) => field.id));
  const seen = new Set<string>();
  return fields.filter((field) => {
    if (!ids.has(field.fieldId) || seen.has(field.fieldId)) return false;
    seen.add(field.fieldId);
    return true;
  });
};

const reserveSubmission = async (c: AppContext, form: TableFormRow) => {
  const nowMs = Date.now();
  const windowStart = Date.parse(form.submit_window_started_at ?? "");
  const inWindow = Number.isFinite(windowStart) && nowMs - windowStart < FORM_SUBMIT_WINDOW_MS;
  const count = inWindow ? form.submit_count + 1 : 1;
  if (count > FORM_SUBMIT_LIMIT) throw new AppError("table_form_rate_limited", "Too many submissions. Try again later.", 429);
  const startedAt = inWindow ? form.submit_window_started_at : new Date(nowMs).toISOString();
  await c.env.storage.db.prepare(
    `UPDATE table_forms SET submit_count = ?, submit_window_started_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(count, startedAt, isoNow(), form.id).run();
};

const pendingAttachments = async (c: AppContext, form: TableFormRow, resourceIds: string[]) => {
  const attachments = new Map<string, TableAttachment>();
  if (!resourceIds.length) return attachments;
  const rows = await c.env.storage.db.prepare(
    `SELECT id, filename, mime_type, byte_size
     FROM resources
     WHERE memo_id = ? AND is_deleted = 0
       AND json_extract(metadata_json, '$.tableFormId') = ?
       AND json_extract(metadata_json, '$.pending') = 1
       AND id IN (${resourceIds.map(() => "?").join(", ")})`,
  ).bind(form.memo_id, form.id, ...resourceIds).all<{ id: string; filename: string | null; mime_type: string | null; byte_size: number }>();
  for (const row of rows.results) {
    attachments.set(row.id, {
      resourceId: row.id,
      filename: row.filename || "attachment",
      mimeType: row.mime_type || "",
      byteSize: row.byte_size,
    });
  }
  return attachments;
};

const countPendingAttachments = async (c: AppContext, form: TableFormRow) => (await c.env.storage.db.prepare(
  `SELECT COUNT(*) AS count
   FROM resources
   WHERE memo_id = ? AND is_deleted = 0
     AND json_extract(metadata_json, '$.tableFormId') = ?
     AND json_extract(metadata_json, '$.pending') = 1`,
).bind(form.memo_id, form.id).first<{ count: number }>())?.count ?? 0;

const collectResourceIds = (cells: Record<string, unknown>) => {
  const ids: string[] = [];
  for (const value of Object.values(cells)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const resourceId = typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof (item as { resourceId?: unknown }).resourceId === "string"
          ? (item as { resourceId: string }).resourceId
          : "";
      if (resourceId) ids.push(resourceId);
    }
  }
  return ids;
};

const retirePendingAttachments = async (c: AppContext, form: TableFormRow) => {
  const cutoff = new Date(Date.now() - PENDING_ATTACHMENT_MS).toISOString();
  const stale = await c.env.storage.db.prepare(
    `SELECT id, object_key, storage_config_id
     FROM resources
     WHERE memo_id = ? AND is_deleted = 0
       AND json_extract(metadata_json, '$.tableFormId') = ?
       AND json_extract(metadata_json, '$.pending') = 1
       AND created_at < ?`,
  ).bind(form.memo_id, form.id, cutoff).all<{ id: string; object_key: string; storage_config_id: string }>();
  if (!stale.results.length) return;
  const now = isoNow();
  await c.env.storage.db.batch(stale.results.map((row) => c.env.storage.db.prepare(
    `UPDATE resources SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ? AND is_deleted = 0`,
  ).bind(now, now, row.id)));
  await deleteReleasedResourceObjects(c.env, stale.results.map((row) => ({
    objectKey: row.object_key,
    storageConfigId: row.storage_config_id,
  })));
};

const markAttachmentsUsed = async (c: AppContext, form: TableFormRow, resourceIds: string[]) => {
  if (!resourceIds.length) return;
  const now = isoNow();
  await c.env.storage.db.batch(resourceIds.map((resourceId) => c.env.storage.db.prepare(
    `UPDATE resources
     SET metadata_json = json_set(metadata_json, '$.pending', 0), updated_at = ?
     WHERE id = ? AND memo_id = ? AND json_extract(metadata_json, '$.tableFormId') = ?`,
  ).bind(now, resourceId, form.memo_id, form.id)));
};

export const registerPublicTableFormRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/public/forms/:token", async (c) => {
    const token = normalizeToken(c.req.param("token"));
    if (!token) return notFound(c, "Form not found");
    const form = await loadForm(c, token);
    if (!form) return notFound(c, "Form not found");
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (!(await allowForm(c, form))) {
      const locked: PublicTableForm = {
        passwordRequired: true,
        title: "",
        description: "",
        submitLabel: "",
        full: false,
        fields: [],
      };
      return c.json({ form: locked });
    }
    const memo = await getTableMemoSource(c.env.storage.db, form.workspace_id, form.memo_id);
    const document = parseTableDocumentMetadata(memo?.contentMarkdown);
    const view: PublicTableForm = {
      passwordRequired: false,
      title: form.title || memo?.title || "",
      description: form.description,
      submitLabel: form.submit_label,
      full: (document?.recordCount ?? 0) >= TABLE_RECORD_LIMIT,
      fields: publicFields(form, document),
    };
    return c.json({ form: view });
  });

  app.post("/api/public/forms/:token/unlock", zValidator("json", PublicShareUnlockSchema), async (c) => {
    const token = normalizeToken(c.req.param("token"));
    if (!token) return notFound(c, "Form not found");
    const form = await loadForm(c, token);
    if (!form?.password_hash) return notFound(c, "Form not found");
    const gate = await c.env.storage.db.prepare(
      `SELECT unlock_failed_count, unlock_window_started_at, unlock_blocked_until FROM table_forms WHERE id = ?`,
    ).bind(form.id).first<{ unlock_failed_count: number; unlock_window_started_at: string | null; unlock_blocked_until: string | null }>();
    if (gate && isShareUnlockBlocked(gate.unlock_blocked_until)) {
      return apiError(c, "table_form_rate_limited", "Too many password attempts. Try again later.", 429);
    }
    if (!(await verifyPassword(c.req.valid("json").password, form.password_hash))) {
      const failure = nextShareUnlockFailure({
        unlock_failed_count: gate?.unlock_failed_count ?? 0,
        unlock_window_started_at: gate?.unlock_window_started_at ?? null,
        unlock_blocked_until: gate?.unlock_blocked_until ?? null,
      });
      await c.env.storage.db.prepare(
        `UPDATE table_forms SET unlock_failed_count = ?, unlock_window_started_at = ?, unlock_blocked_until = ? WHERE id = ?`,
      ).bind(failure.failureCount, failure.windowStartedAt, failure.blockedUntil, form.id).run();
      return apiError(c, "table_form_password_invalid", "Incorrect form password", 403);
    }
    await c.env.storage.db.prepare(
      `UPDATE table_forms SET unlock_failed_count = 0, unlock_window_started_at = NULL, unlock_blocked_until = NULL WHERE id = ?`,
    ).bind(form.id).run();
    const value = await createShareAccessCookieValue(form.password_hash, form.token);
    setCookie(c, FORM_COOKIE, value, {
      httpOnly: true,
      secure: new URL(c.req.url).protocol === "https:",
      sameSite: "Lax",
      path: cookiePath(form.token),
      maxAge: SHARE_ACCESS_MAX_AGE_SECONDS,
    });
    return c.json({ ok: true });
  });

  app.post("/api/public/forms/:token/resources", async (c) => {
    const token = normalizeToken(c.req.param("token"));
    if (!token) return notFound(c, "Form not found");
    const form = await loadForm(c, token);
    if (!form || !(await allowForm(c, form))) return notFound(c, "Form not found");
    await retirePendingAttachments(c, form);
    const body = await c.req.raw.formData();
    const file = body.get("file");
    if (!(file instanceof File)) return apiError(c, "table_form_invalid", "Choose a file to upload.", 400);
    if (file.size <= 0 || file.size > TABLE_FORM_ATTACHMENT_BYTES) {
      return apiError(c, "upload_too_large", "Each form attachment must be between 1 byte and 20 MiB.", 413);
    }
    const memo = await getTableMemoSource(c.env.storage.db, form.workspace_id, form.memo_id);
    if (!memo || !publicFields(form, parseTableDocumentMetadata(memo.contentMarkdown)).some((field) => field.type === "attachment")) {
      return apiError(c, "table_form_invalid", "This form does not accept files.", 400);
    }
    if (await countPendingAttachments(c, form) >= PENDING_ATTACHMENT_LIMIT) {
      return apiError(c, "table_form_rate_limited", "Too many uploads. Try again later.", 429);
    }
    const actor = { actorType: "user" as const, actorId: form.created_by };
    const input = {
      // Public form visitors are not signed in, so the note's workspace
      // comes from the form.
      workspaceId: form.workspace_id,
      memoId: form.memo_id,
      filename: file.name,
      mimeType: resolveResourceUploadMimeType(file.name, file.type),
      bytes: new Uint8Array(await file.arrayBuffer()),
      actor,
      metadata: { tableFormId: form.id, pending: 1 },
    };
    const resource = SUPPORTED_IMAGE_MIME_TYPES.has(input.mimeType)
      ? await createImageResource(c, { ...input, source: "upload" })
      : await createAttachmentResource(c, input);
    if (SUPPORTED_IMAGE_MIME_TYPES.has(input.mimeType)) {
      await c.env.storage.db.prepare(
        `UPDATE resources SET metadata_json = ? WHERE id = ?`,
      ).bind(JSON.stringify({ tableFormId: form.id, pending: 1 }), resource.id).run();
    }
    // The check above runs before the file is stored, so concurrent uploads
    // can pass it together. Count again now that this upload is stored and
    // withdraw it if the form went over the limit.
    if (await countPendingAttachments(c, form) > PENDING_ATTACHMENT_LIMIT) {
      const stored = await c.env.storage.db.prepare(
        `SELECT object_key, storage_config_id FROM resources WHERE id = ?`,
      ).bind(resource.id).first<{ object_key: string; storage_config_id: string }>();
      const now = isoNow();
      await c.env.storage.db.prepare(
        `UPDATE resources SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ? AND is_deleted = 0`,
      ).bind(now, now, resource.id).run();
      if (stored) {
        await deleteReleasedResourceObjects(c.env, [{ objectKey: stored.object_key, storageConfigId: stored.storage_config_id }]);
      }
      return apiError(c, "table_form_rate_limited", "Too many uploads. Try again later.", 429);
    }
    c.header("Cache-Control", "private, no-store");
    return c.json({
      resource: {
        id: resource.id,
        filename: resource.filename,
        mimeType: resource.mimeType,
        byteSize: resource.byteSize,
      },
    }, 201);
  });

  app.post("/api/public/forms/:token/submissions", zValidator("json", PublicTableFormSubmissionSchema), async (c) => {
    const token = normalizeToken(c.req.param("token"));
    if (!token) return notFound(c, "Form not found");
    const form = await loadForm(c, token);
    if (!form || !(await allowForm(c, form))) return notFound(c, "Form not found");
    try {
      await reserveSubmission(c, form);
      await retirePendingAttachments(c, form);
      const cells = c.req.valid("json").cells;
      const attachments = await pendingAttachments(c, form, collectResourceIds(cells));
      const { usedResourceIds } = await appendTableFormSubmission(c.env.storage.db, form, cells, attachments);
      // Only files the new row references are kept; uploads sent in other
      // cells stay pending and are retired with the other stale uploads.
      await markAttachmentsUsed(c, form, usedResourceIds);
      c.header("Cache-Control", "private, no-store");
      return c.json({ ok: true }, 201);
    } catch (error) {
      if (error instanceof AppError) return apiError(c, error.code, error.message, error.status);
      throw error;
    }
  });
};

export const registerTableFormRoutes = (app: Hono<AppEnv>) => {
  app.get("/api/v1/memos/:id/form", async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const row = await c.env.storage.db.prepare(
      `${selectFormSql} WHERE memo_id = ? AND workspace_id = ?`,
    ).bind(c.req.param("id"), getWorkspaceId(c)).first<TableFormRow>();
    return c.json({ form: row ? mapOwnerForm(row) : null });
  });

  app.put("/api/v1/memos/:id/form", zValidator("json", TableFormUpdateSchema), async (c) => {
    const denied = requireUser(c);
    if (denied) return denied;
    const memoId = c.req.param("id");
    const workspaceId = getWorkspaceId(c);
    const memo = await getTableMemoSource(c.env.storage.db, workspaceId, memoId);
    const document = parseTableDocumentMetadata(memo?.contentMarkdown);
    if (!document) return notFound(c, "Table not found");
    const input = c.req.valid("json");
    const fields = activeFieldSettings(document, input.fields);
    if (input.enabled && fields.length === 0) {
      return apiError(c, "table_form_invalid", "Choose at least one field for the form.", 400);
    }
    const existing = await c.env.storage.db.prepare(
      `${selectFormSql} WHERE memo_id = ? AND workspace_id = ?`,
    ).bind(memoId, workspaceId).first<TableFormRow>();
    const now = isoNow();
    const actor = getAuditActor(c);
    const enablePassword = input.passwordProtected;
    const rotate = enablePassword && (input.rotatePassword === true || !existing?.password_hash);
    const password = rotate ? generateSharePassword() : undefined;
    const passwordHash = password ? await hashPassword(password) : existing?.password_hash ?? null;
    const nextHash = enablePassword ? passwordHash : null;
    if (!existing) {
      const token = randomToken(FORM_TOKEN_BYTES);
      await c.env.storage.db.prepare(
        `INSERT INTO table_forms (
          id, memo_id, workspace_id, token, enabled, password_hash, title, description, submit_label,
          fields_json, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        createId("form"),
        memoId,
        workspaceId,
        token,
        input.enabled ? 1 : 0,
        nextHash,
        input.title,
        input.description,
        input.submitLabel,
        JSON.stringify(fields),
        actor.actorId,
        now,
        now,
      ).run();
    } else {
      await c.env.storage.db.prepare(
        `UPDATE table_forms
         SET enabled = ?, password_hash = ?, title = ?, description = ?, submit_label = ?, fields_json = ?, updated_at = ?,
             unlock_failed_count = CASE WHEN ? IS NULL THEN 0 ELSE unlock_failed_count END
         WHERE id = ?`,
      ).bind(
        input.enabled ? 1 : 0,
        nextHash,
        input.title,
        input.description,
        input.submitLabel,
        JSON.stringify(fields),
        now,
        nextHash,
        existing.id,
      ).run();
    }
    await audit(c.env.storage.db, actor.actorType, actor.actorId, "table_form.update", "memo", memoId, { enabled: input.enabled });
    const saved = await c.env.storage.db.prepare(
      `${selectFormSql} WHERE memo_id = ? AND workspace_id = ?`,
    ).bind(memoId, workspaceId).first<TableFormRow>();
    if (!saved) return notFound(c, "Form not found");
    return c.json({ form: mapOwnerForm(saved, password) });
  });
};
