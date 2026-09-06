import {
  JsonBackupResourceMetadataSchema,
  type JsonBackupResource,
  type Resource,
} from "@edgeever/shared";
import { auditStatement } from "./audit";
import type { AppContext, AuditActor } from "./api-context";
import { AppError } from "./app-error";
import { createId, isoNow } from "./entity-utils";
import { resolveObjectStorage } from "./object-storage";
import {
  SUPPORTED_IMAGE_MIME_TYPES,
  getResourceRow,
  inferImageExtension,
  mapResource,
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  normalizeFilename,
  validateAttachmentUpload,
  validateImageUpload,
} from "./resource-service";
import { getWorkspaceId } from "./request-auth";
import type { BlobUploadedPart } from "./storage-contract";

export const RESOURCE_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const RESOURCE_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export type ResourceUploadRow = {
  id: string;
  workspace_id: string;
  memo_id: string;
  resource_id: string;
  storage_config_id: string;
  bucket_name: string;
  object_key: string;
  provider_upload_id: string;
  kind: "image" | "attachment";
  mime_type: string;
  filename: string;
  byte_size: number;
  part_size: number;
  part_count: number;
  restore_metadata_json: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

type ResourceUploadPartRow = {
  part_number: number;
  etag: string;
  byte_size: number;
};

const uploadNotFound = () => new AppError("upload_not_found", "Resource upload was not found.", 404);

const assertActiveUpload = (upload: ResourceUploadRow | null): ResourceUploadRow => {
  if (!upload) throw uploadNotFound();
  if (Date.parse(upload.expires_at) <= Date.now()) {
    throw new AppError("upload_expired", "Resource upload has expired.", 410);
  }
  return upload;
};

const uploadHttpMetadata = (mimeType: string) => ({
  httpMetadata: {
    contentType: mimeType,
    cacheControl: "private, max-age=3600",
  },
});

const cleanupExpiredResourceUploads = async (context: AppContext) => {
  const expired = await context.env.storage.db.prepare(
    `SELECT id, workspace_id, memo_id, resource_id, storage_config_id, bucket_name, object_key,
            provider_upload_id, kind, mime_type, filename, byte_size, part_size, part_count, restore_metadata_json,
            created_at, updated_at, expires_at
     FROM resource_uploads
     WHERE workspace_id = ? AND expires_at <= ?
     ORDER BY expires_at ASC LIMIT 10`,
  ).bind(getWorkspaceId(context), isoNow()).all<ResourceUploadRow>();

  for (const upload of expired.results) {
    try {
      const destination = await resolveObjectStorage(context.env, upload.storage_config_id);
      await destination.store
        .resumeMultipartUpload(upload.object_key, upload.provider_upload_id)
        .abort();
    } catch {
      // Provider multipart uploads have their own expiry lifecycle. Remove the
      // inaccessible application session even if the provider already did so.
    }
    await context.env.storage.db.prepare("DELETE FROM resource_uploads WHERE id = ?").bind(upload.id).run();
  }
};

export const getResourceUpload = (
  context: AppContext,
  uploadId: string,
) => context.env.storage.db.prepare(
  `SELECT id, workspace_id, memo_id, resource_id, storage_config_id, bucket_name, object_key,
          provider_upload_id, kind, mime_type, filename, byte_size, part_size, part_count, restore_metadata_json,
          created_at, updated_at, expires_at
   FROM resource_uploads WHERE id = ? AND workspace_id = ?`,
).bind(uploadId, getWorkspaceId(context)).first<ResourceUploadRow>();

export const initiateResourceUpload = async (
  context: AppContext,
  input: { memoId: string; filename: string; mimeType: string; byteSize: number },
) => {
  await cleanupExpiredResourceUploads(context);
  const kind = SUPPORTED_IMAGE_MIME_TYPES.has(input.mimeType) ? "image" : "attachment";
  if (kind === "image") validateImageUpload(input.mimeType, input.byteSize);
  else validateAttachmentUpload(input.byteSize);

  const uploadId = createId("upload");
  const resourceId = createId("res");
  const workspaceId = getWorkspaceId(context);
  const filename = normalizeFilename(input.filename) || resourceId;
  const extension = kind === "image" ? inferImageExtension(filename, input.mimeType) : "";
  const objectKey = `workspaces/${workspaceId}/memos/${input.memoId}/${resourceId}${extension}`;
  const destination = await resolveObjectStorage(context.env);
  const multipart = await destination.store.createMultipartUpload(
    objectKey,
    uploadHttpMetadata(input.mimeType),
  );
  const now = isoNow();
  const expiresAt = new Date(Date.now() + RESOURCE_UPLOAD_TTL_MS).toISOString();
  const partCount = Math.ceil(input.byteSize / RESOURCE_UPLOAD_PART_BYTES);

  try {
    await context.env.storage.db.prepare(
      `INSERT INTO resource_uploads (
        id, workspace_id, memo_id, resource_id, storage_config_id, bucket_name, object_key,
        provider_upload_id, kind, mime_type, filename, byte_size, part_size, part_count, restore_metadata_json,
        created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      uploadId,
      workspaceId,
      input.memoId,
      resourceId,
      destination.configId,
      destination.bucketName,
      objectKey,
      multipart.uploadId,
      kind,
      input.mimeType,
      filename,
      input.byteSize,
      RESOURCE_UPLOAD_PART_BYTES,
      partCount,
      null,
      now,
      now,
      expiresAt,
    ).run();
  } catch (error) {
    await multipart.abort().catch(() => undefined);
    throw error;
  }

  return {
    id: uploadId,
    resourceId,
    partSize: RESOURCE_UPLOAD_PART_BYTES,
    partCount,
    byteSize: input.byteSize,
    expiresAt,
  };
};

export const initiateResourceRestoreUpload = async (
  context: AppContext,
  input: unknown,
) => {
  await cleanupExpiredResourceUploads(context);
  const parsed = JsonBackupResourceMetadataSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("invalid_restore_resource", "Restore resource metadata is invalid.", 400);
  }
  const metadata = parsed.data as JsonBackupResource;
  const maxBytes = metadata.kind === "image" ? MAX_IMAGE_UPLOAD_BYTES : MAX_ATTACHMENT_UPLOAD_BYTES;
  if (!Number.isSafeInteger(metadata.byteSize) || metadata.byteSize <= 0 || metadata.byteSize > maxBytes) {
    throw new AppError("upload_too_large", "Backup resource size is invalid.", 413);
  }

  const workspaceId = getWorkspaceId(context);
  const memo = await context.env.storage.db.prepare(
    "SELECT id FROM memos WHERE id = ? AND workspace_id = ? LIMIT 1",
  ).bind(metadata.memoId, workspaceId).first<{ id: string }>();
  if (!memo) {
    throw new AppError("not_found", "Restore target memo not found.", 404);
  }
  const foreignResource = await context.env.storage.db.prepare(
    `SELECT r.id FROM resources r INNER JOIN memos m ON m.id = r.memo_id
     WHERE r.id = ? AND m.workspace_id <> ? LIMIT 1`,
  ).bind(metadata.id, workspaceId).first<{ id: string }>();
  if (foreignResource) {
    throw new AppError(
      "cross_workspace_id_conflict",
      "Backup resource ID is already used by another user.",
      409,
    );
  }

  const uploadId = createId("upload");
  const filename = normalizeFilename(metadata.filename || "") || `${metadata.kind}-${metadata.id}`;
  const mimeType = metadata.mimeType?.trim() || "application/octet-stream";
  const objectKey = `workspaces/${workspaceId}/restores/${metadata.memoId}/${metadata.id}/${Date.now()}-${filename}`;
  const destination = await resolveObjectStorage(context.env);
  const multipart = await destination.store.createMultipartUpload(
    objectKey,
    uploadHttpMetadata(mimeType),
  );
  const now = isoNow();
  const expiresAt = new Date(Date.now() + RESOURCE_UPLOAD_TTL_MS).toISOString();
  const partCount = Math.ceil(metadata.byteSize / RESOURCE_UPLOAD_PART_BYTES);

  try {
    await context.env.storage.db.prepare(
      `INSERT INTO resource_uploads (
        id, workspace_id, memo_id, resource_id, storage_config_id, bucket_name, object_key,
        provider_upload_id, kind, mime_type, filename, byte_size, part_size, part_count, restore_metadata_json,
        created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      uploadId,
      workspaceId,
      metadata.memoId,
      metadata.id,
      destination.configId,
      destination.bucketName,
      objectKey,
      multipart.uploadId,
      metadata.kind,
      mimeType,
      filename,
      metadata.byteSize,
      RESOURCE_UPLOAD_PART_BYTES,
      partCount,
      JSON.stringify(metadata),
      now,
      now,
      expiresAt,
    ).run();
  } catch (error) {
    await multipart.abort().catch(() => undefined);
    throw error;
  }

  return {
    id: uploadId,
    resourceId: metadata.id,
    partSize: RESOURCE_UPLOAD_PART_BYTES,
    partCount,
    byteSize: metadata.byteSize,
    expiresAt,
  };
};

export const uploadResourcePart = async (
  context: AppContext,
  uploadId: string,
  partNumber: number,
  body: ReadableStream<Uint8Array>,
  byteSize: number,
) => {
  const upload = assertActiveUpload(await getResourceUpload(context, uploadId));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > upload.part_count) {
    throw new AppError("invalid_upload_part", "Resource upload part number is invalid.", 400);
  }
  const expectedBytes = partNumber === upload.part_count
    ? upload.byte_size - upload.part_size * (upload.part_count - 1)
    : upload.part_size;
  if (byteSize !== expectedBytes) {
    throw new AppError(
      "invalid_upload_part",
      `Resource upload part ${partNumber} must contain exactly ${expectedBytes} bytes.`,
      400,
    );
  }

  const destination = await resolveObjectStorage(context.env, upload.storage_config_id);
  const multipart = destination.store.resumeMultipartUpload(upload.object_key, upload.provider_upload_id);
  const part = await multipart.uploadPart(partNumber, body);
  const now = isoNow();
  await context.env.storage.db.batch([
    context.env.storage.db.prepare(
      `INSERT INTO resource_upload_parts (upload_id, part_number, etag, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(upload_id, part_number) DO UPDATE SET
         etag = excluded.etag, byte_size = excluded.byte_size, created_at = excluded.created_at`,
    ).bind(upload.id, part.partNumber, part.etag, byteSize, now),
    context.env.storage.db.prepare(
      "UPDATE resource_uploads SET updated_at = ? WHERE id = ?",
    ).bind(now, upload.id),
  ]);
  return { partNumber: part.partNumber, byteSize };
};

const completeRestoredResourceUpload = async (
  context: AppContext,
  upload: ResourceUploadRow,
  actor: AuditActor,
): Promise<Resource> => {
  let metadataInput: unknown;
  try {
    metadataInput = JSON.parse(upload.restore_metadata_json ?? "null");
  } catch {
    throw new AppError("invalid_restore_resource", "Restore resource metadata is invalid.", 400);
  }
  const parsed = JsonBackupResourceMetadataSchema.safeParse(metadataInput);
  if (!parsed.success || parsed.data.id !== upload.resource_id || parsed.data.memoId !== upload.memo_id) {
    throw new AppError("invalid_restore_resource", "Restore resource metadata is invalid.", 400);
  }
  const metadata = parsed.data as JsonBackupResource;
  const originalMemo = metadata.originalMemoId
    ? await context.env.storage.db.prepare(
      "SELECT id FROM memos WHERE id = ? AND workspace_id = ? LIMIT 1",
    ).bind(metadata.originalMemoId, upload.workspace_id).first<{ id: string }>()
    : null;
  const previous = await context.env.storage.db.prepare(
    `SELECT r.object_key, r.storage_config_id FROM resources r
     INNER JOIN memos m ON m.id = r.memo_id
     WHERE r.id = ? AND m.workspace_id = ? LIMIT 1`,
  ).bind(upload.resource_id, upload.workspace_id).first<{
    object_key: string;
    storage_config_id: string;
  }>();
  const now = isoNow();

  try {
    await context.env.storage.db.batch([
      context.env.storage.db.prepare(
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
        upload.bucket_name,
        upload.object_key,
        upload.storage_config_id,
        metadata.kind,
        metadata.mimeType ?? upload.mime_type,
        upload.filename,
        upload.byte_size,
        metadata.sha256,
        metadata.width,
        metadata.height,
        JSON.stringify({ source: "edgeever-zip-import" }),
        metadata.createdAt,
        now,
      ),
      auditStatement(
        context.env.storage.db,
        actor.actorType,
        actor.actorId,
        "resource.restore",
        "resource",
        metadata.id,
        { memoId: metadata.memoId, byteSize: upload.byte_size, multipart: true },
      ),
      context.env.storage.db.prepare("DELETE FROM resource_uploads WHERE id = ?").bind(upload.id),
    ]);
  } catch (error) {
    const destination = await resolveObjectStorage(context.env, upload.storage_config_id);
    await destination.store.delete(upload.object_key).catch(() => undefined);
    throw error;
  }

  if (previous?.object_key && previous.object_key !== upload.object_key) {
    const previousStorage = await resolveObjectStorage(context.env, previous.storage_config_id);
    await previousStorage.store.delete(previous.object_key).catch(() => undefined);
  }

  const resource = await getResourceRow(context.env.storage.db, upload.workspace_id, upload.resource_id);
  if (!resource) throw new AppError("not_found", "Resource not found", 404);
  return mapResource(resource);
};

export const completeResourceUpload = async (
  context: AppContext,
  uploadId: string,
  actor: AuditActor,
): Promise<Resource> => {
  const upload = assertActiveUpload(await getResourceUpload(context, uploadId));
  const rows = await context.env.storage.db.prepare(
    `SELECT part_number, etag, byte_size FROM resource_upload_parts
     WHERE upload_id = ? ORDER BY part_number ASC`,
  ).bind(upload.id).all<ResourceUploadPartRow>();
  if (rows.results.length !== upload.part_count) {
    throw new AppError("upload_incomplete", "Not all resource upload parts have been received.", 409);
  }

  let totalBytes = 0;
  const parts: BlobUploadedPart[] = rows.results.map((part, index) => {
    const expectedPartNumber = index + 1;
    const expectedBytes = expectedPartNumber === upload.part_count
      ? upload.byte_size - upload.part_size * (upload.part_count - 1)
      : upload.part_size;
    if (part.part_number !== expectedPartNumber || part.byte_size !== expectedBytes) {
      throw new AppError("upload_incomplete", "Resource upload parts do not match the expected file size.", 409);
    }
    totalBytes += part.byte_size;
    return { partNumber: part.part_number, etag: part.etag };
  });
  if (totalBytes !== upload.byte_size) {
    throw new AppError("upload_incomplete", "Resource upload size does not match the expected file size.", 409);
  }

  const destination = await resolveObjectStorage(context.env, upload.storage_config_id);
  const multipart = destination.store.resumeMultipartUpload(upload.object_key, upload.provider_upload_id);
  await multipart.complete(parts);

  if (upload.restore_metadata_json) {
    return completeRestoredResourceUpload(context, upload, actor);
  }

  const now = isoNow();
  const metadata = upload.kind === "image"
    ? {
        source: "upload",
        originalFilename: upload.filename,
        originalMimeType: upload.mime_type,
        originalByteSize: upload.byte_size,
        compression: "disabled",
      }
    : { originalFilename: upload.filename };
  try {
    await context.env.storage.db.batch([
      context.env.storage.db.prepare(
        `INSERT INTO resources (
          id, memo_id, bucket_name, object_key, storage_config_id, kind, mime_type, filename,
          byte_size, sha256, width, height, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        upload.resource_id,
        upload.memo_id,
        upload.bucket_name,
        upload.object_key,
        upload.storage_config_id,
        upload.kind,
        upload.mime_type,
        upload.filename,
        upload.byte_size,
        null,
        null,
        null,
        JSON.stringify(metadata),
        now,
        now,
      ),
      auditStatement(
        context.env.storage.db,
        actor.actorType,
        actor.actorId,
        "resource.create",
        "resource",
        upload.resource_id,
        { memoId: upload.memo_id, mimeType: upload.mime_type, byteSize: upload.byte_size, multipart: true },
      ),
      context.env.storage.db.prepare("DELETE FROM resource_uploads WHERE id = ?").bind(upload.id),
    ]);
  } catch (error) {
    await destination.store.delete(upload.object_key).catch(() => undefined);
    throw error;
  }

  const resource = await getResourceRow(context.env.storage.db, upload.workspace_id, upload.resource_id);
  if (!resource) throw new AppError("not_found", "Resource not found", 404);
  return mapResource(resource);
};

export const abortResourceUpload = async (context: AppContext, uploadId: string) => {
  const upload = await getResourceUpload(context, uploadId);
  if (!upload) return;
  const destination = await resolveObjectStorage(context.env, upload.storage_config_id);
  await destination.store
    .resumeMultipartUpload(upload.object_key, upload.provider_upload_id)
    .abort();
  await context.env.storage.db.prepare("DELETE FROM resource_uploads WHERE id = ?").bind(upload.id).run();
};
