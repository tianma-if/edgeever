import { resolveAttachmentKind } from "./attachment-kind";

const TYPE_LABELS = {
  image: "IMAGE",
  audio: "AUDIO",
  video: "VIDEO",
  pdf: "PDF",
  spreadsheet: "XLS",
  document: "DOC",
  presentation: "PPT",
  archive: "ZIP",
  code: "CODE",
  text: "TXT",
  file: "FILE",
} as const;

export const normalizeAttachmentByteSize = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

export const formatAttachmentByteSize = (value: unknown): string | null => {
  const bytes = normalizeAttachmentByteSize(value);
  if (bytes === null) return null;
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** exponent;
  return `${exponent === 0 ? amount.toFixed(0) : amount.toFixed(amount >= 10 ? 1 : 2)} ${units[exponent]}`;
};

export const getAttachmentTypeLabel = (
  mimeType: string | null | undefined,
  filename: string | null | undefined,
) => TYPE_LABELS[resolveAttachmentKind(mimeType, filename)];

export const formatAttachmentMetadata = (
  mimeType: string | null | undefined,
  filename: string | null | undefined,
  byteSize: unknown,
) => [getAttachmentTypeLabel(mimeType, filename), formatAttachmentByteSize(byteSize)].filter(Boolean).join(" · ");
