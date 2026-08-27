export const MAX_PDF_THUMBNAIL_BYTES = 100 * 1024 * 1024;
export const PDF_THUMBNAIL_CONCURRENCY = 3;

export type PdfThumbnailSize = { width: number; height: number };

export const isPdfThumbnailEligible = (byteSize: number) =>
  Number.isFinite(byteSize) && byteSize > 0 && byteSize <= MAX_PDF_THUMBNAIL_BYTES;

export const calculatePdfThumbnailScale = (
  pageSize: PdfThumbnailSize,
  hostSize: PdfThumbnailSize,
  padding = 8,
) => {
  const availableWidth = Math.max(1, hostSize.width - padding * 2);
  const availableHeight = Math.max(1, hostSize.height - padding * 2);
  return Math.max(0.01, Math.min(
    availableWidth / Math.max(1, pageSize.width),
    availableHeight / Math.max(1, pageSize.height),
  ));
};
