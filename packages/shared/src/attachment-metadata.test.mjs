import { describe, expect, test } from "bun:test";
import {
  formatAttachmentByteSize,
  formatAttachmentMetadata,
  getAttachmentTypeLabel,
  normalizeAttachmentByteSize,
} from "./attachment-metadata";

describe("attachment metadata", () => {
  test("formats useful byte sizes and omits missing values", () => {
    expect(formatAttachmentByteSize(856000)).toBe("835.9 KB");
    expect(formatAttachmentByteSize(12 * 1024 * 1024)).toBe("12.0 MB");
    expect(formatAttachmentByteSize(0)).toBeNull();
    expect(normalizeAttachmentByteSize("2048")).toBe(2048);
  });

  test("uses stable file-type labels with an optional size", () => {
    expect(getAttachmentTypeLabel("application/pdf", "report.pdf")).toBe("PDF");
    expect(formatAttachmentMetadata(null, "sheet.xlsx", 2048)).toBe("XLS · 2.00 KB");
    expect(formatAttachmentMetadata(null, "legacy.zip", null)).toBe("ZIP");
  });
});
