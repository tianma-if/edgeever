import {
  AI_ATTACHMENT_MEDIA_TYPES,
  MAX_AI_ATTACHMENTS,
  MAX_AI_ATTACHMENTS_TOTAL_BYTES,
  MAX_AI_ATTACHMENT_BYTES,
  MAX_AI_TEXT_ATTACHMENT_BYTES,
  isAiTextAttachment,
  type AiAttachmentInput,
  type AiAttachmentMediaType,
} from "@edgeever/shared";

export const AI_ATTACHMENT_ACCEPT = AI_ATTACHMENT_MEDIA_TYPES.join(",");

const MEDIA_TYPE_BY_EXTENSION: Record<string, AiAttachmentMediaType> = {
  csv: "text/csv",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  markdown: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  webp: "image/webp",
};

export type PreparedAiAttachment = AiAttachmentInput & { byteLength: number };
export type AiAttachmentErrorCode = "count" | "fileTooLarge" | "totalTooLarge" | "unsupported" | "readFailed";

export class AiAttachmentError extends Error {
  constructor(public readonly code: AiAttachmentErrorCode) {
    super(code);
  }
}

export const resolveAiAttachmentMediaType = (file: Pick<File, "name" | "type">) => {
  if (AI_ATTACHMENT_MEDIA_TYPES.includes(file.type as AiAttachmentMediaType)) {
    return file.type as AiAttachmentMediaType;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_TYPE_BY_EXTENSION[extension] ?? null;
};

const readFileAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new AiAttachmentError("readFailed"));
  reader.onload = () => {
    const result = typeof reader.result === "string" ? reader.result : "";
    const separator = result.indexOf(",");
    if (separator < 0) reject(new AiAttachmentError("readFailed"));
    else resolve(result.slice(separator + 1));
  };
  reader.readAsDataURL(file);
});

export const prepareAiAttachments = async (
  files: File[],
  existing: PreparedAiAttachment[],
): Promise<PreparedAiAttachment[]> => {
  if (existing.length + files.length > MAX_AI_ATTACHMENTS) throw new AiAttachmentError("count");
  let totalBytes = existing.reduce((total, attachment) => total + attachment.byteLength, 0);
  const prepared: PreparedAiAttachment[] = [];
  for (const file of files) {
    const mediaType = resolveAiAttachmentMediaType(file);
    if (!mediaType) throw new AiAttachmentError("unsupported");
    const fileLimit = isAiTextAttachment(mediaType) ? MAX_AI_TEXT_ATTACHMENT_BYTES : MAX_AI_ATTACHMENT_BYTES;
    if (file.size > fileLimit) throw new AiAttachmentError("fileTooLarge");
    totalBytes += file.size;
    if (totalBytes > MAX_AI_ATTACHMENTS_TOTAL_BYTES) throw new AiAttachmentError("totalTooLarge");
    prepared.push({
      filename: file.name,
      mediaType,
      base64Data: await readFileAsBase64(file),
      byteLength: file.size,
    });
  }
  return prepared;
};

export const formatAiAttachmentSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
