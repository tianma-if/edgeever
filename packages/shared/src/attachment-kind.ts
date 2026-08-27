export const ATTACHMENT_KINDS = [
  "image",
  "audio",
  "video",
  "pdf",
  "spreadsheet",
  "document",
  "presentation",
  "archive",
  "code",
  "text",
  "file",
] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

const extensionOf = (filename: string | null | undefined) =>
  filename?.trim().toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/)?.[1] ?? "";

export const resolveAttachmentKind = (
  mimeType: string | null | undefined,
  filename: string | null | undefined,
): AttachmentKind => {
  const mime = mimeType?.trim().toLowerCase() ?? "";
  const extension = extensionOf(filename);

  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";

  if (
    mime.includes("spreadsheet") || mime.includes("excel") ||
    ["xls", "xlsx", "xlsm", "ods", "csv"].includes(extension)
  ) return "spreadsheet";

  if (
    mime.includes("word") || mime.includes("wordprocessingml") ||
    ["doc", "docx", "odt", "rtf"].includes(extension)
  ) return "document";

  if (
    mime.includes("presentation") || mime.includes("powerpoint") ||
    ["ppt", "pptx", "odp", "key"].includes(extension)
  ) return "presentation";

  if (
    mime.includes("zip") || mime.includes("compressed") || mime.includes("tar") ||
    mime.includes("rar") || mime.includes("gzip") ||
    ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(extension)
  ) return "archive";

  if (
    mime.includes("javascript") || mime.includes("typescript") || mime.includes("json") ||
    mime.includes("xml") || mime.includes("yaml") ||
    ["js", "jsx", "ts", "tsx", "json", "xml", "yaml", "yml", "html", "css", "sh", "py", "java", "go", "rs"].includes(extension)
  ) return "code";

  if (mime.startsWith("text/") || ["txt", "md", "log"].includes(extension)) return "text";
  return "file";
};
