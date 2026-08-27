import { describe, expect, test } from "bun:test";
import {
  MAX_PDF_THUMBNAIL_BYTES,
  calculatePdfThumbnailScale,
  isPdfThumbnailEligible,
  PDF_THUMBNAIL_CONCURRENCY,
} from "./pdf-thumbnail.ts";

describe("PDF first-page thumbnails", () => {
  test("fits portrait and landscape pages inside the available box", () => {
    expect(calculatePdfThumbnailScale(
      { width: 600, height: 800 },
      { width: 160, height: 160 },
    )).toBeCloseTo(0.18);
    expect(calculatePdfThumbnailScale(
      { width: 800, height: 600 },
      { width: 160, height: 80 },
    )).toBeCloseTo(0.1067, 3);
  });

  test("falls back for empty, invalid, and oversized resources", () => {
    expect(isPdfThumbnailEligible(349)).toBe(true);
    expect(isPdfThumbnailEligible(MAX_PDF_THUMBNAIL_BYTES)).toBe(true);
    expect(isPdfThumbnailEligible(0)).toBe(false);
    expect(isPdfThumbnailEligible(Number.NaN)).toBe(false);
    expect(isPdfThumbnailEligible(MAX_PDF_THUMBNAIL_BYTES + 1)).toBe(false);
  });

  test("uses a bounded thumbnail work queue", () => {
    expect(PDF_THUMBNAIL_CONCURRENCY).toBe(3);
  });
});
