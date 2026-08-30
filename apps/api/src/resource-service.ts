import type {
  Resource,
  ResourceListItem,
  ResourceStorageSummary,
} from "@edgeever/shared";
import { auditStatement } from "./audit";
import type { AppContext, AuditActor } from "./api-context";
import { AppError } from "./app-error";
import { createId, isoNow } from "./entity-utils";
import { sha256Bytes } from "./hash-utils";
import { resolveObjectStorage } from "./object-storage";
import { getWorkspaceId } from "./request-auth";
import type { DatabaseAdapter } from "./storage-contract";

export const MAX_IMAGE_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENT_UPLOAD_BYTES = 100 * 1024 * 1024;

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export type ResourceRow = {
  id: string;
  memo_id: string;
  original_memo_id: string | null;
  bucket_name: string;
  object_key: string;
  storage_config_id: string;
  kind: "image" | "attachment";
  mime_type: string | null;
  filename: string | null;
  byte_size: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
  updated_at: string;
  is_deleted?: number;
};

export type ResourceListRow = ResourceRow & {
  memo_title: string | null;
  memo_excerpt: string | null;
  memo_is_deleted: number | null;
};

export type ResourceStatsRow = {
  total_count: number;
  total_bytes: number;
  image_count: number;
  attachment_count: number;
};

type PreparedImage = {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  width: number | null;
  height: number | null;
  compressed: boolean;
  metadata: Record<string, unknown>;
};

export const mapResource = (row: ResourceRow): Resource => ({
  id: row.id,
  memoId: row.memo_id,
  originalMemoId: row.original_memo_id,
  kind: row.kind,
  mimeType: row.mime_type,
  filename: row.filename,
  byteSize: row.byte_size,
  sha256: row.sha256,
  width: row.width,
  height: row.height,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  url: `/api/v1/resources/${row.id}/blob`,
});

export const mapResourceListItem = (row: ResourceListRow): ResourceListItem => ({
  ...mapResource(row),
  memoTitle: row.memo_title,
  memoExcerpt: row.memo_excerpt,
  memoDeleted: Boolean(row.memo_is_deleted),
});

export const mapResourceStorageSummary = (
  row: ResourceStatsRow | null,
): ResourceStorageSummary => ({
  totalCount: row?.total_count ?? 0,
  totalBytes: row?.total_bytes ?? 0,
  imageCount: row?.image_count ?? 0,
  attachmentCount: row?.attachment_count ?? 0,
});

export const validateImageUpload = (mimeType: string, size: number) => {
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new AppError(
      "unsupported_media_type",
      "Only PNG, JPEG, GIF, WebP and AVIF images are supported.",
      415,
    );
  }
  if (size <= 0 || size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new AppError("upload_too_large", "Image must be between 1 byte and 50 MB.", 413);
  }
};

export const validateAttachmentUpload = (size: number) => {
  if (size <= 0 || size > MAX_ATTACHMENT_UPLOAD_BYTES) {
    throw new AppError("upload_too_large", "Attachment must be between 1 byte and 100 MB.", 413);
  }
};

export const normalizeFilename = (filename: string) => filename
  .trim()
  .replace(/[\\/]/g, "-")
  .replace(/[\u0000-\u001f\u007f]/g, "")
  .slice(0, 160);

export const inferImageExtension = (filename: string, mimeType: string) => {
  const extension = /\.(png|jpe?g|gif|webp|avif)$/i.exec(filename)?.[0]?.toLowerCase();
  if (extension) return extension === ".jpeg" ? ".jpg" : extension;

  switch (mimeType) {
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    case "image/avif": return ".avif";
    default: return "";
  }
};

export const prepareImageForStorage = (input: {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  source: "upload" | "mcp";
}): PreparedImage => ({
  bytes: input.bytes,
  mimeType: input.mimeType,
  filename: input.filename,
  width: null,
  height: null,
  compressed: false,
  metadata: {
    source: input.source,
    originalFilename: normalizeFilename(input.filename) || null,
    originalMimeType: input.mimeType,
    originalByteSize: input.bytes.byteLength,
    compression: "disabled",
  },
});

export const getResourceRow = async (
  database: DatabaseAdapter,
  workspaceId: string,
  resourceId: string,
  includeDeleted = false,
): Promise<ResourceRow | null> =>
  database
    .prepare(
      `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.storage_config_id, r.kind, r.mime_type,
              r.filename, r.byte_size, r.sha256, r.width, r.height, r.created_at, r.updated_at, r.is_deleted
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE r.id = ? AND m.workspace_id = ?${includeDeleted ? "" : " AND r.is_deleted = 0"}`,
    )
    .bind(resourceId, workspaceId)
    .first<ResourceRow>();

export const listResourcesForMemo = async (
  database: DatabaseAdapter,
  workspaceId: string,
  memoId: string,
): Promise<Resource[]> => {
  const rows = await database
    .prepare(
      `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.storage_config_id, r.kind, r.mime_type,
              r.filename, r.byte_size, r.sha256, r.width, r.height, r.created_at, r.updated_at
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE r.memo_id = ? AND m.workspace_id = ? AND r.is_deleted = 0
       ORDER BY r.created_at ASC, r.id ASC`,
    )
    .bind(memoId, workspaceId)
    .all<ResourceRow>();

  return rows.results.map(mapResource);
};

export const listResourcesForMcp = async (
  database: DatabaseAdapter,
  workspaceId: string,
  limit: number,
) => {
  const [rows, stats] = await Promise.all([
    database.prepare(
      `SELECT r.id, r.memo_id, r.original_memo_id, r.bucket_name, r.object_key, r.storage_config_id, r.kind,
              r.mime_type, r.filename, r.byte_size, r.sha256, r.width, r.height,
              r.created_at, r.updated_at, m.title AS memo_title, m.excerpt AS memo_excerpt,
              m.is_deleted AS memo_is_deleted
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE m.workspace_id = ? AND r.is_deleted = 0
       ORDER BY r.created_at DESC
       LIMIT ?`,
    ).bind(workspaceId, limit).all<ResourceListRow>(),
    database.prepare(
      `SELECT COUNT(*) AS total_count,
              COALESCE(SUM(byte_size), 0) AS total_bytes,
              COALESCE(SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END), 0) AS image_count,
              COALESCE(SUM(CASE WHEN kind = 'attachment' THEN 1 ELSE 0 END), 0) AS attachment_count
       FROM resources r
       INNER JOIN memos m ON m.id = r.memo_id
       WHERE m.workspace_id = ? AND r.is_deleted = 0`,
    ).bind(workspaceId).first<ResourceStatsRow>(),
  ]);

  return {
    resources: rows.results.map(mapResourceListItem),
    summary: mapResourceStorageSummary(stats),
  };
};

type ResourceCreateInput = {
  memoId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  actor: AuditActor;
};

const storeResource = async (
  context: AppContext,
  input: ResourceCreateInput & {
    kind: "image" | "attachment";
    width: number | null;
    height: number | null;
    metadata: Record<string, unknown>;
    auditMetadata: Record<string, unknown>;
    objectKeyExtension?: string;
  },
) => {
  const resourceId = createId("res");
  const now = isoNow();
  const workspaceId = getWorkspaceId(context);
  const filename = normalizeFilename(input.filename) || `${resourceId}${input.objectKeyExtension ?? ""}`;
  const metadata = input.kind === "attachment"
    ? { ...input.metadata, originalFilename: filename }
    : input.metadata;
  const objectKey = `workspaces/${workspaceId}/memos/${input.memoId}/${resourceId}${input.objectKeyExtension ?? ""}`;
  const destination = await resolveObjectStorage(context.env);
  const checksum = await sha256Bytes(input.bytes);

  await destination.store.put(objectKey, input.bytes, {
    httpMetadata: {
      contentType: input.mimeType,
      cacheControl: "private, max-age=3600",
    },
    customMetadata: {
      memoId: input.memoId,
      resourceId,
      filename,
    },
  });

  try {
    await context.env.storage.db.batch([
      context.env.storage.db.prepare(
        `INSERT INTO resources (
          id, memo_id, bucket_name, object_key, storage_config_id, kind, mime_type, filename,
          byte_size, sha256, width, height, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        resourceId,
        input.memoId,
        destination.bucketName,
        objectKey,
        destination.configId,
        input.kind,
        input.mimeType,
        filename,
        input.bytes.byteLength,
        checksum,
        input.width,
        input.height,
        JSON.stringify(metadata),
        now,
        now,
      ),
      auditStatement(
        context.env.storage.db,
        input.actor.actorType,
        input.actor.actorId,
        "resource.create",
        "resource",
        resourceId,
        { memoId: input.memoId, mimeType: input.mimeType, byteSize: input.bytes.byteLength, ...input.auditMetadata },
      ),
    ]);
  } catch (error) {
    await destination.store.delete(objectKey);
    throw error;
  }

  const resource = await getResourceRow(context.env.storage.db, workspaceId, resourceId);
  if (!resource) {
    throw new AppError("not_found", "Resource not found", 404);
  }
  return mapResource(resource);
};

export const createImageResource = async (
  context: AppContext,
  input: ResourceCreateInput & { source: "upload" | "mcp" },
): Promise<Resource> => {
  validateImageUpload(input.mimeType, input.bytes.byteLength);
  const processed = prepareImageForStorage(input);
  const extension = inferImageExtension(processed.filename, processed.mimeType);
  return storeResource(context, {
    ...input,
    filename: processed.filename,
    mimeType: processed.mimeType,
    bytes: processed.bytes,
    kind: "image",
    width: processed.width,
    height: processed.height,
    metadata: processed.metadata,
    auditMetadata: { compressed: processed.compressed },
    objectKeyExtension: extension,
  });
};

export const createAttachmentResource = async (
  context: AppContext,
  input: ResourceCreateInput,
): Promise<Resource> => {
  validateAttachmentUpload(input.bytes.byteLength);
  return storeResource(context, {
    ...input,
    kind: "attachment",
    width: null,
    height: null,
    metadata: {},
    auditMetadata: {},
  });
};

const encodeRfc5987Value = (value: string) => encodeURIComponent(
  value.replace(/[\uD800-\uDFFF]/gu, "\uFFFD"),
).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

const asciiFilenameFallback = (filename: string) => {
  const normalized = filename.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const ascii = normalized.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const extension = /\.[A-Za-z0-9]{1,16}$/.exec(ascii)?.[0] ?? "";
  const basename = extension ? ascii.slice(0, -extension.length) : ascii;
  return /[A-Za-z0-9]/.test(basename) ? ascii : `download${extension}`;
};

const contentDisposition = (kind: "inline" | "attachment", filename: string | null) => {
  if (!filename) return kind;
  const normalized = normalizeFilename(filename);
  if (!normalized) return kind;
  return `${kind}; filename="${asciiFilenameFallback(normalized)}"; filename*=UTF-8''${encodeRfc5987Value(normalized)}`;
};

export const contentDispositionInline = (filename: string | null) => contentDisposition("inline", filename);

export const contentDispositionAttachment = (filename: string | null) => contentDisposition("attachment", filename);
