import type {
  Resource,
  ResourceListItem,
  ResourceStorageSummary,
} from "@edgeever/shared";
import { AppError } from "./app-error";

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
