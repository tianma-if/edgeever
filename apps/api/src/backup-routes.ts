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
import type { Hono } from "hono";
import type { AppEnv } from "./api-context";
import { AppError } from "./app-error";
import { isoNow, parseJsonArray } from "./entity-utils";
import { apiError, badRequest, conflict, notFound } from "./http-errors";
import { resolveObjectStorage } from "./object-storage";
import {
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  mapResource,
  normalizeFilename,
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

const listBackupPage = async (
  database: DatabaseAdapter,
  workspaceId: string,
  limit: number,
  offset: number,
) => Promise.all([
  database.prepare(
    `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
            m.is_archived, m.is_deleted, m.created_at, m.updated_at, m.deleted_at, mc.revision,
            mc.content_json, mc.content_markdown, mc.content_text, mc.content_hash,
            m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
     FROM memos m
     INNER JOIN memo_contents mc ON mc.memo_id = m.id
     WHERE m.workspace_id = ? AND m.is_deleted = 0
     ORDER BY m.created_at ASC, m.id ASC
     LIMIT ? OFFSET ?`,
  ).bind(workspaceId, limit, offset).all<BackupMemoDetailRow>(),
  database.prepare(
    `SELECT COUNT(*) AS count FROM memos WHERE workspace_id = ? AND is_deleted = 0`,
  ).bind(workspaceId).first<{ count: number }>(),
]);

export const registerBackupRoutes = (
  app: Hono<AppEnv>,
  dependencies: BackupRouteDependencies,
) => {
  app.get("/api/v1/exports/markdown", async (context) => {
    const denied = requireScopes(context, "read:memos", "read:resources");
    if (denied) return denied;

    const limit = dependencies.clampNumber(Number(context.req.query("limit") ?? 50), 1, 100);
    const offset = dependencies.clampNumber(Number(context.req.query("offset") ?? 0), 0, 1_000_000);
    const workspaceId = getWorkspaceId(context);
    const [memoRows, totalRow] = await listBackupPage(context.env.storage.db, workspaceId, limit, offset);
    const memoIds = memoRows.results.map((row) => row.id);
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

    const totalCount = totalRow?.count ?? memoRows.results.length;
    return context.json({
      memos: memoRows.results.map(dependencies.mapMemoDetail),
      resources,
      totalCount,
      nextOffset: offset + memoRows.results.length < totalCount
        ? offset + memoRows.results.length
        : null,
    });
  });

  app.get("/api/v1/backups/json", async (context) => {
    const denied = requireScopes(context, "read:memos", "read:resources");
    if (denied) return denied;

    const limit = dependencies.clampNumber(Number(context.req.query("limit") ?? 25), 1, 50);
    const offset = dependencies.clampNumber(Number(context.req.query("offset") ?? 0), 0, 1_000_000);
    const workspaceId = getWorkspaceId(context);
    const [memoRows, totalRow] = await listBackupPage(context.env.storage.db, workspaceId, limit, offset);
    const memoIds = memoRows.results.map((row) => row.id);
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

    const totalCount = totalRow?.count ?? memoRows.results.length;
    return context.json({
      memos: memoRows.results.map(dependencies.mapMemoDetail),
      resources,
      revisions,
      totalCount,
      nextOffset: offset + memoRows.results.length < totalCount
        ? offset + memoRows.results.length
        : null,
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
      httpMetadata: { contentType: metadata.mimeType ?? file.type ?? "application/octet-stream" },
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
        metadata.mimeType ?? file.type ?? null,
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
