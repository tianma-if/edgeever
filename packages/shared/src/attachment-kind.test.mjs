import { describe, expect, test } from "bun:test";
import { resolveAttachmentKind } from "./attachment-kind.ts";

describe("attachment kind", () => {
  test("uses MIME types for media and filenames for common documents", () => {
    expect(resolveAttachmentKind("audio/mpeg", "recording.bin")).toBe("audio");
    expect(resolveAttachmentKind(null, "report.PDF")).toBe("pdf");
    expect(resolveAttachmentKind(null, "budget.xlsx")).toBe("spreadsheet");
    expect(resolveAttachmentKind(null, "proposal.docx")).toBe("document");
    expect(resolveAttachmentKind(null, "pitch.pptx")).toBe("presentation");
    expect(resolveAttachmentKind(null, "source.ts")).toBe("code");
    expect(resolveAttachmentKind(null, "backup.7z")).toBe("archive");
  });

  test("falls back predictably for text and unknown files", () => {
    expect(resolveAttachmentKind("text/plain", "README")).toBe("text");
    expect(resolveAttachmentKind("application/octet-stream", "payload.bin")).toBe("file");
  });
});
