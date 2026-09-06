import { describe, expect, test } from "bun:test";
import { formatAiAttachmentSize, resolveAiAttachmentMediaType } from "./ai-attachments.ts";

describe("AI attachment browser helpers", () => {
  test("uses a supported declared media type or infers it from the extension", () => {
    expect(resolveAiAttachmentMediaType({ name: "photo.png", type: "image/png" })).toBe("image/png");
    expect(resolveAiAttachmentMediaType({ name: "NOTES.MD", type: "" })).toBe("text/markdown");
    expect(resolveAiAttachmentMediaType({ name: "archive.zip", type: "application/zip" })).toBeNull();
  });

  test("formats compact file sizes", () => {
    expect(formatAiAttachmentSize(512)).toBe("512 B");
    expect(formatAiAttachmentSize(1536)).toBe("2 KB");
    expect(formatAiAttachmentSize(1_572_864)).toBe("1.5 MB");
  });
});
