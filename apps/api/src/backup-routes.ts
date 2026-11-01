import {
  emptyDoc,
  JsonBackupResourceMetadataSchema,
  RestoreJsonMemosSchema,
  RestoreJsonNotebooksSchema,
  type JsonBackupMemo,
  type JsonBackupNotebook,
  type JsonBackupResource,
  type JsonBackupRevision,
  type MemoDetail,
  type Resource,
  type TiptapDoc,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { AppError } from "./app-error";
import { isoNow, parseJsonArray } from "./entity-utils";
import { apiError, badRequest, conflict, notFound } from "./http-errors";
import { resolveObjectStorage } from "./object-storage";
import { AI_PROMPT_SELECT_COLUMNS, mapAiPromptTemplateRow, type AiPromptTemplateRow } from "./ai-prompt-service";
import { mapNotebook, notebookSelectSql, type NotebookRow } from "./notebook-service";
import {
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  mapResource,
  normalizeFilename,
  validateRestoredResourceMimeType,
  type ResourceRow,
} from "./resource-service";
import { getWorkspaceId, requireScopes, requireUser } from "./request-auth";
import type { DatabaseAdapter } from "./storage-contract";
import type { initiateResourceRestoreUpload as initiateResourceRestoreUploadService } from "./resource-upload-service";

export type BackupMemoDetailRow = {
  id: string;
  notebook_id: string;
  title: string | null;
  excerpt: string;
  tags_json: string;
  is_pinned: number;
  is_archived: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  content_json: string;
  content_markdown: string;
  content_text: string;
  content_hash: string;
  source_memo_ids: string;
  merge_source_count: number;
  merged_into_memo_id: string | null;
};

type BackupRevisionRow = {
  id: string;
  memo_id: string;
  revision: number;
  title: string | null;
  tags_json: string;
  content_json: string;
  content_markdown: string;
  content_text: string;
  content_hash: string;
  created_by: string;
  created_at: string;
};

type BackupRouteDependencies = {
  clampNumber: (value: number, min: number, max: number) => number;
  getMemoDetail: (
    database: DatabaseAdapter,
    workspaceId: string,
    memoId: string,
  ) => Promise<MemoDetail | null>;
  mapMemoDetail: (row: BackupMemoDetailRow) => MemoDetail;
  restoreJsonMemos: (
    database: DatabaseAdapter,
    workspaceId: string,
    memos: JsonBackupMemo[],
  ) => Promise<void>;
  restoreJsonNotebooks: (
    database: DatabaseAdapter,
    workspaceId: string,
    notebooks: JsonBackupNotebook[],
  ) => Promise<void>;
  sha256Bytes: (bytes: Uint8Array) => Promise<string>;
  initiateResourceRestoreUpload: typeof initiateResourceRestoreUploadService;
};

const MAX_LEGACY_RESTORE_BYTES = 100 * 1024 * 1024;

const parseRevisionDoc = (json: string): TiptapDoc => {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? value as TiptapDoc : emptyDoc();
  } catch {
    return emptyDoc();
  }
};

export const mapJsonBackupRevision = (row: BackupRevisionRow): JsonBackupRevision => ({
  id: row.id,
  memoId: row.memo_id,
  revision: row.revision,
  title: row.title,
  tags: parseJsonArray(row.tags_json),
  contentJson: parseRevisionDoc(row.content_json),
  contentMarkdown: row.content_markdown,
  contentText: row.content_text,
  contentHash: row.content_hash,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

export const MAX_MARKDOWN_EXPORT_MEMO_IDS = 100;

export const parseMarkdownExportMemoIds = (value: string | undefined): { ids: string[] | null; error?: "too_many" } => {
  if (value === undefined) {
    return { ids: null };
  }

  const ids = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (ids.length > MAX_MARKDOWN_EXPORT_MEMO_IDS) {
    return { ids: null, error: "too_many" };
  }

  return { ids };
};

const MEMO_EXPORT_SELECT_SQL = `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
            m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
            mc.content_json, mc.content_markdown, mc.content_text, mc.content_hash,
            m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
     FROM memos m
     INNER JOIN memo_contents mc ON mc.memo_id = m.id`;

type BackupStateRow = {
  identity: string;
  backup_revision: string;
  notebooks: number;
  memos: number;
  revisions: number;
  resources: number;
  prompts: number;
};

// Page checks need only the transactional revision. Recounting every table here
// makes a full backup quadratic in source size and can exhaust D1's daily reads.
const readBackupVersion = (database: DatabaseAdapter, workspaceId: string) => database.prepare(
  `SELECT created_at AS identity, CAST(backup_revision AS TEXT) AS backup_revision
   FROM workspaces WHERE id = ?`,
).bind(workspaceId).first<Pick<BackupStateRow, "identity" | "backup_revision">>();

const readBackupState = (database: DatabaseAdapter, workspaceId: string) => database.prepare(
  `SELECT w.created_at AS identity, CAST(w.backup_revision AS TEXT) AS backup_revision,
     (SELECT COUNT(*) FROM notebooks WHERE workspace_id = w.id AND is_deleted = 0) AS notebooks,
     (SELECT COUNT(*) FROM memos WHERE workspace_id = w.id AND is_deleted = 0) AS memos,
     (SELECT COUNT(*) FROM memo_revisions r JOIN memos m ON m.id = r.memo_id WHERE m.workspace_id = w.id AND m.is_deleted = 0) AS revisions,
     (SELECT COUNT(*) FROM resources r JOIN memos m ON m.id = r.memo_id WHERE m.workspace_id = w.id AND m.is_deleted = 0 AND r.is_deleted = 0) AS resources,
     (SELECT COUNT(*) FROM ai_prompt_templates WHERE workspace_id = w.id) AS prompts
   FROM workspaces w WHERE w.id = ?`,
).bind(workspaceId).first<BackupStateRow>();

const readBackupRelations = async (database: DatabaseAdapter, memoIds: string[]) => {
  if (memoIds.length === 0) return { resources: [] as Resource[], revisions: [] as JsonBackupRevision[] };
  const placeholders = memoIds.map(() => "?").join(", ");
  const [resources, revisions] = await Promise.all([
    database.prepare(
      `SELECT id, memo_id, original_memo_id, bucket_name, object_key, storage_config_id, kind, mime_type,
              filename, byte_size, sha256, width, height, created_at, updated_at
       FROM resources WHERE is_deleted = 0 AND memo_id IN (${placeholders})
       ORDER BY memo_id ASC, created_at ASC, id ASC`,
    ).bind(...memoIds).all<ResourceRow>(),
    database.prepare(
      `SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown,
              content_text, content_hash, created_by, created_at FROM memo_revisions
       WHERE memo_id IN (${placeholders}) ORDER BY memo_id ASC, revision ASC, created_at ASC`,
    ).bind(...memoIds).all<BackupRevisionRow>(),
  ]);
  return { resources: resources.results.map(mapResource), revisions: revisions.results.map(mapJsonBackupRevision) };
};

const exportCursorSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  offset: z.number().int().nonnegative(),
});
type ExportCursor = z.infer<typeof exportCursorSchema>;

const parseExportCursor = (value: string | undefined): ExportCursor | undefined | null => {
  if (value === undefined) return undefined;
  try {
    const parsed = exportCursorSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const exportContinuation = (page: BackupMemoDetailRow[], offset: number, hasMore: boolean) => {
  const nextOffset = hasMore ? offset + page.length : null;
  const last = page.at(-1);
  return {
    nextOffset,
    nextCursor: nextOffset !== null && last
      ? JSON.stringify({ id: last.id, createdAt: last.created_at, offset: nextOffset } satisfies ExportCursor)
      : null,
  };
};

const listBackupPage = async (
  database: DatabaseAdapter,
  workspaceId: string,
  limit: number,
  offset: number,
  includeTotal = true,
  cursor?: ExportCursor,
) => Promise.all([
  database.prepare(
    `${MEMO_EXPORT_SELECT_SQL}
     WHERE m.workspace_id = ? AND m.is_deleted = 0
       ${cursor ? "AND (m.created_at, m.id) > (?, ?)" : ""}
     ORDER BY m.created_at ASC, m.id ASC
     LIMIT ?${cursor ? "" : " OFFSET ?"}`,
  ).bind(workspaceId, ...(cursor ? [cursor.createdAt, cursor.id] : []), includeTotal ? limit : limit + 1, ...(cursor ? [] : [offset])).all<BackupMemoDetailRow>(),
  includeTotal ? database.prepare(
    `SELECT COUNT(*) AS count FROM memos WHERE workspace_id = ? AND is_deleted = 0`,
  ).bind(workspaceId).first<{ count: number }>() : Promise.resolve(null),
]);

const emptyMarkdownExportPage = async () => [
  { results: [] as BackupMemoDetailRow[] },
  { count: 0 },
] as const;

const listMarkdownExportPage = async (
  database: DatabaseAdapter,
  workspaceId: string,
  limit: number,
  offset: number,
  memoIds: string[] | null,
  includeTotal = true,
  cursor?: ExportCursor,
) => {
  if (memoIds && memoIds.length === 0) {
    return emptyMarkdownExportPage();
  }

  if (!memoIds) {
    return listBackupPage(database, workspaceId, limit, offset, includeTotal, cursor);
  }

  // json_each keeps the D1 bound-parameter count fixed (workspace + JSON + limit/offset).
  const memoIdsJson = JSON.stringify(memoIds);
  return Promise.all([
    database.prepare(
      `${MEMO_EXPORT_SELECT_SQL}
       WHERE m.workspace_id = ? AND m.is_deleted = 0
         AND m.id IN (SELECT value FROM json_each(?))
         ${cursor ? "AND (m.created_at, m.id) > (?, ?)" : ""}
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT ?${cursor ? "" : " OFFSET ?"}`,
    ).bind(workspaceId, memoIdsJson, ...(cursor ? [cursor.createdAt, cursor.id] : []), includeTotal ? limit : limit + 1, ...(cursor ? [] : [offset])).all<BackupMemoDetailRow>(),
    includeTotal ? database.prepare(
      `SELECT COUNT(*) AS count FROM memos
       WHERE workspace_id = ? AND is_deleted = 0
         AND id IN (SELECT value FROM json_each(?))`,
    ).bind(workspaceId, memoIdsJson).first<{ count: number }>() : Promise.resolve(null),
  ]);
};

export const registerBackupRoutes = (
  app: Hono<AppEnv>,
  dependencies: BackupRouteDependencies,
) => {
  app.get("/api/v1/backups/state", async (context) => {
    const denied = requireScopes(context, "read:memos", "read:resources");
    if (denied) return denied;
    // The aggregate includes private AI prompts, just like their existing route.
    const userDenied = requireUser(context);
    if (userDenied) return userDenied;
    context.header("Cache-Control", "private, no-store");
    const workspaceId = getWorkspaceId(context);
    const state = await readBackupState(context.env.storage.db, workspaceId);
    if (!state) return notFound(context, "Workspace not found.");
    return context.json({
      protocolVersion: 1,
      userId: context.get("auth").actorId,
      workspaceId,
      identity: state.identity,
      backupRevision: state.backup_revision,
      counts: { notebooks: state.notebooks, memos: state.memos, revisions: state.revisions, resources: state.resources, prompts: state.prompts },
    });
  });

  app.get("/api/v1/backups/data", async (context) => {
    const denied = requireScopes(context, "read:memos", "read:resources");
    if (denied) return denied;
    context.header("Cache-Control", "private, no-store");
    const kind = context.req.query("kind");
    if (!["memos", "notebooks", "prompts"].includes(kind ?? "")) return badRequest(context, "Unknown backup data kind.");
    if (kind === "notebooks") {
      const notebookDenied = requireScopes(context, "read:notebooks");
      if (notebookDenied) return notebookDenied;
    }
    if (kind === "prompts") {
      const promptDenied = requireUser(context);
      if (promptDenied) return promptDenied;
    }
    const identity = context.req.query("identity");
    const revision = context.req.query("revision");
    if (!identity || revision === undefined || !/^\d+$/.test(revision)) return badRequest(context, "A backup identity and revision are required.");
    const workspaceId = getWorkspaceId(context);
    const database = context.env.storage.db;
    const unchanged = async () => {
      const state = await readBackupVersion(database, workspaceId);
      return state?.identity === identity && state.backup_revision === revision;
    };
    const changed = () => conflict(context, "backup_source_changed", "The source changed during backup. Try again when it is idle.");
    if (!await unchanged()) return changed();
    const after = context.req.query("after") ?? "";
    const limit = dependencies.clampNumber(Number(context.req.query("limit") ?? 25), 1, 50);
    let result: Record<string, unknown>;
    let ids: string[];
    if (kind === "memos") {
      const rows = await database.prepare(
        `${MEMO_EXPORT_SELECT_SQL} WHERE m.workspace_id = ? AND m.is_deleted = 0 AND m.id > ? ORDER BY m.id ASC LIMIT ?`,
      ).bind(workspaceId, after, limit + 1).all<BackupMemoDetailRow>();
      const selected = rows.results.slice(0, limit);
      ids = rows.results.map((row) => row.id);
      result = { memos: selected.map(dependencies.mapMemoDetail), ...await readBackupRelations(database, selected.map((row) => row.id)) };
    } else if (kind === "notebooks") {
      const rows = await database.prepare(notebookSelectSql(
        `WHERE n.workspace_id = ? AND n.is_deleted = 0 AND n.id > ? GROUP BY n.id ORDER BY n.id ASC LIMIT ?`,
      )).bind(workspaceId, after, limit + 1).all<NotebookRow>();
      ids = rows.results.map((row) => row.id);
      result = { notebooks: rows.results.slice(0, limit).map(mapNotebook) };
    } else {
      const rows = await database.prepare(
        `SELECT ${AI_PROMPT_SELECT_COLUMNS} FROM ai_prompt_templates WHERE workspace_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
      ).bind(workspaceId, after, limit + 1).all<AiPromptTemplateRow>();
      ids = rows.results.map((row) => row.id);
      result = { prompts: rows.results.slice(0, limit).map((row) => mapAiPromptTemplateRow(row, context.req.header("Accept-Language"))) };
    }
    if (!await unchanged()) return changed();
    return context.json({ ...result, nextCursor: ids.length > limit ? ids[limit - 1] : null });
  });

  app.get("/api/v1/exports/markdown", async (context) => {
    const denied = requireScopes(context, "read:memos", "read:resources");
    if (denied) return denied;

    const limit = dependencies.clampNumber(Number(context.req.query("limit") ?? 50), 1, 100);
    const cursor = parseExportCursor(context.req.query("cursor"));
    if (cursor === null) return apiError(context, "invalid_export_cursor", "Invalid export cursor.", 400);
    const offset = cursor?.offset ?? dependencies.clampNumber(Number(context.req.query("offset") ?? 0), 0, 1_000_000);
    const parsedIds = parseMarkdownExportMemoIds(context.req.query("ids"));
    const includeTotal = cursor ? context.req.query("includeTotal") === "1" : offset === 0 || context.req.query("includeTotal") !== "0";
    if (parsedIds.error === "too_many") {
      return badRequest(context, `Export at most ${MAX_MARKDOWN_EXPORT_MEMO_IDS} notes at a time.`);
    }
    const workspaceId = getWorkspaceId(context);
    const [memoRows, totalRow] = await listMarkdownExportPage(
      context.env.storage.db,
      workspaceId,
      limit,
      offset,
      parsedIds.ids,
      includeTotal,
      cursor,
    );
    const page = memoRows.results.slice(0, limit);
    const memoIds = page.map((row) => row.id);
    let resources: Resource[] = [];

    if (memoIds.length > 0) {
      const placeholders = memoIds.map(() => "?").join(", ");
      const resourceRows = await context.env.storage.db.prepare(
        `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.storage_config_id, r.kind, r.mime_type,
                r.filename, r.byte_size, r.sha256, r.width, r.height, r.created_at, r.updated_at
         FROM resources r
         WHERE r.is_deleted = 0 AND r.memo_id IN (${placeholders})
         ORDER BY r.memo_id ASC, r.created_at ASC, r.id ASC`,
      ).bind(...memoIds).all<ResourceRow>();
      resources = resourceRows.results.map(mapResource);
    }

    const totalCount = totalRow?.count ?? page.length;
    return context.json({
      memos: page.map(dependencies.mapMemoDetail),
      resources,
      ...(includeTotal ? { totalCount } : {}),
      ...exportContinuation(page, offset, includeTotal ? offset + page.length < totalCount : memoRows.results.length > limit),
    });
  });

  app.get("/api/v1/backups/json", async (context) => {
    const denied = requireScopes(context, "read:memos", "read:resources");
    if (denied) return denied;

    const limit = dependencies.clampNumber(Number(context.req.query("limit") ?? 25), 1, 50);
    const cursor = parseExportCursor(context.req.query("cursor"));
    if (cursor === null) return apiError(context, "invalid_export_cursor", "Invalid export cursor.", 400);
    const offset = cursor?.offset ?? dependencies.clampNumber(Number(context.req.query("offset") ?? 0), 0, 1_000_000);
    const workspaceId = getWorkspaceId(context);
    const includeTotal = cursor ? context.req.query("includeTotal") === "1" : offset === 0 || context.req.query("includeTotal") !== "0";
    const [memoRows, totalRow] = await listBackupPage(context.env.storage.db, workspaceId, limit, offset, includeTotal, cursor);
    const page = memoRows.results.slice(0, limit);
    const memoIds = page.map((row) => row.id);
    let resources: Resource[] = [];
    let revisions: JsonBackupRevision[] = [];

    if (memoIds.length > 0) {
      const placeholders = memoIds.map(() => "?").join(", ");
      const [resourceRows, revisionRows] = await Promise.all([
        context.env.storage.db.prepare(
          `SELECT id, memo_id, original_memo_id, bucket_name, object_key, storage_config_id, kind, mime_type,
                  filename, byte_size, sha256, width, height, created_at, updated_at
           FROM resources
           WHERE is_deleted = 0 AND memo_id IN (${placeholders})
           ORDER BY memo_id ASC, created_at ASC, id ASC`,
        ).bind(...memoIds).all<ResourceRow>(),
        context.env.storage.db.prepare(
          `SELECT id, memo_id, revision, title, tags_json, content_json, content_markdown,
                  content_text, content_hash, created_by, created_at
           FROM memo_revisions
           WHERE memo_id IN (${placeholders})
           ORDER BY memo_id ASC, revision ASC, created_at ASC`,
        ).bind(...memoIds).all<BackupRevisionRow>(),
      ]);
      resources = resourceRows.results.map(mapResource);
      revisions = revisionRows.results.map(mapJsonBackupRevision);
    }

    const totalCount = totalRow?.count ?? page.length;
    return context.json({
      memos: page.map(dependencies.mapMemoDetail),
      resources,
      revisions,
      ...(includeTotal ? { totalCount } : {}),
      ...exportContinuation(page, offset, includeTotal ? offset + page.length < totalCount : memoRows.results.length > limit),
    });
  });

  app.post(
    "/api/v1/restores/json/notebooks",
    zValidator("json", RestoreJsonNotebooksSchema),
    async (context) => {
      const denied = requireUser(context);
      if (denied) return denied;
      await dependencies.restoreJsonNotebooks(
        context.env.storage.db,
        getWorkspaceId(context),
        context.req.valid("json").notebooks as JsonBackupNotebook[],
      );
      return context.json({ ok: true });
    },
  );

  app.post(
    "/api/v1/restores/json/memos",
    zValidator("json", RestoreJsonMemosSchema),
    async (context) => {
      const denied = requireUser(context);
      if (denied) return denied;
      await dependencies.restoreJsonMemos(
        context.env.storage.db,
        getWorkspaceId(context),
        context.req.valid("json").memos as JsonBackupMemo[],
      );
      return context.json({ ok: true });
    },
  );

  app.post("/api/v1/restores/json/resources/:id/uploads", async (context) => {
    const denied = requireUser(context);
    if (denied) return denied;
    const metadata = await context.req.json().catch(() => null);
    if (!metadata || typeof metadata !== "object" || (metadata as { id?: unknown }).id !== context.req.param("id")) {
      return badRequest(context, "Restore resource metadata is invalid.");
    }
    try {
      const upload = await dependencies.initiateResourceRestoreUpload(context, metadata);
      return context.json({ upload }, 201);
    } catch (error) {
      if (error instanceof AppError) {
        return apiError(context, error.code, error.message, error.status);
      }
      throw error;
    }
  });

  app.put("/api/v1/restores/json/resources/:id", async (context) => {
    const denied = requireUser(context);
    if (denied) return denied;

    const declaredRequestBytes = Number(context.req.header("Content-Length"));
    if (Number.isFinite(declaredRequestBytes) && declaredRequestBytes > MAX_LEGACY_RESTORE_BYTES + 1024 * 1024) {
      return apiError(
        context,
        "multipart_upload_required",
        "Backup resources larger than 100 MiB must use the resumable restore API.",
        413,
      );
    }

    const form = await context.req.raw.formData();
    const file = form.get("file");
    const metadataValue = form.get("metadata");
    if (!(file instanceof File) || typeof metadataValue !== "string") {
      return badRequest(context, "Restore resource file and metadata are required.");
    }

    let metadataInput: unknown;
    try {
      metadataInput = JSON.parse(metadataValue);
    } catch {
      return badRequest(context, "Restore resource metadata must be valid JSON.");
    }

    const parsed = JsonBackupResourceMetadataSchema.safeParse(metadataInput);
    if (!parsed.success || parsed.data.id !== context.req.param("id")) {
      return badRequest(context, "Restore resource metadata is invalid.");
    }

    const metadata = parsed.data as JsonBackupResource;
    const workspaceId = getWorkspaceId(context);
    if (!(await dependencies.getMemoDetail(context.env.storage.db, workspaceId, metadata.memoId))) {
      return notFound(context, "Restore target memo not found.");
    }

    const maxBytes = metadata.kind === "image" ? MAX_IMAGE_UPLOAD_BYTES : MAX_ATTACHMENT_UPLOAD_BYTES;
    if (file.size <= 0 || file.size > Math.min(maxBytes, MAX_LEGACY_RESTORE_BYTES)) {
      return apiError(context, "upload_too_large", "Backup resource size is invalid.", 413);
    }

    const mimeType = metadata.mimeType ?? file.type ?? "application/octet-stream";
    validateRestoredResourceMimeType(metadata.kind, mimeType, file.size);

    const filename = normalizeFilename(metadata.filename || file.name) || `${metadata.kind}-${metadata.id}`;
    const objectKey = `workspaces/${workspaceId}/restores/${metadata.memoId}/${metadata.id}/${Date.now()}-${filename}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const foreignResource = await context.env.storage.db.prepare(
      `SELECT r.id FROM resources r INNER JOIN memos m ON m.id = r.memo_id
       WHERE r.id = ? AND m.workspace_id <> ? LIMIT 1`,
    ).bind(metadata.id, workspaceId).first<{ id: string }>();
    if (foreignResource) {
      return conflict(context, "cross_workspace_id_conflict", "Backup resource ID is already used by another user.");
    }

    const previous = await context.env.storage.db.prepare(
      `SELECT r.object_key, r.storage_config_id FROM resources r INNER JOIN memos m ON m.id = r.memo_id WHERE r.id = ? AND m.workspace_id = ?`,
    ).bind(metadata.id, workspaceId).first<{ object_key: string; storage_config_id: string }>();
    const originalMemo = metadata.originalMemoId
      ? await context.env.storage.db.prepare(
        `SELECT id FROM memos WHERE id = ? AND workspace_id = ?`,
      ).bind(metadata.originalMemoId, workspaceId).first<{ id: string }>()
      : null;

    const destination = await resolveObjectStorage(context.env);
    await destination.store.put(objectKey, bytes, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { memoId: metadata.memoId, resourceId: metadata.id, restored: "true" },
    });

    try {
      const now = isoNow();
      await context.env.storage.db.prepare(
        `INSERT INTO resources (
          id, memo_id, original_memo_id, bucket_name, object_key, storage_config_id, kind, mime_type, filename,
          byte_size, sha256, width, height, metadata_json, is_deleted, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          memo_id = excluded.memo_id,
          original_memo_id = excluded.original_memo_id,
          bucket_name = excluded.bucket_name,
          object_key = excluded.object_key,
          storage_config_id = excluded.storage_config_id,
          kind = excluded.kind,
          mime_type = excluded.mime_type,
          filename = excluded.filename,
          byte_size = excluded.byte_size,
          sha256 = excluded.sha256,
          width = excluded.width,
          height = excluded.height,
          metadata_json = excluded.metadata_json,
          is_deleted = 0,
          updated_at = excluded.updated_at,
          deleted_at = NULL`,
      ).bind(
        metadata.id,
        metadata.memoId,
        originalMemo?.id ?? null,
        destination.bucketName,
        objectKey,
        destination.configId,
        metadata.kind,
        mimeType,
        filename,
        bytes.byteLength,
        await dependencies.sha256Bytes(bytes),
        metadata.width,
        metadata.height,
        JSON.stringify({ source: "edgeever-zip-import" }),
        metadata.createdAt,
        now,
      ).run();
    } catch (error) {
      await destination.store.delete(objectKey);
      throw error;
    }

    if (previous?.object_key && previous.object_key !== objectKey) {
      const previousStorage = await resolveObjectStorage(context.env, previous.storage_config_id);
      await previousStorage.store.delete(previous.object_key);
    }

    return context.json({ ok: true });
  });
};
