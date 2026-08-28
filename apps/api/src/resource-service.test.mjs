import { describe, expect, test } from "bun:test";
import {
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  contentDispositionAttachment,
  inferImageExtension,
  mapResourceListItem,
  normalizeFilename,
  validateAttachmentUpload,
  validateImageUpload,
} from "./resource-service.ts";

const resourceRow = {
  id: "res_1",
  memo_id: "memo_1",
  original_memo_id: null,
  bucket_name: "resources",
  object_key: "workspaces/ws/memos/memo_1/res_1",
  storage_config_id: "builtin",
  kind: "image",
  mime_type: "image/png",
  filename: "diagram.png",
  byte_size: 128,
  sha256: "checksum",
  width: 640,
  height: 480,
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T01:00:00.000Z",
  memo_title: "Architecture",
  memo_excerpt: "System overview",
  memo_is_deleted: 0,
};

describe("resource service contracts", () => {
  test("maps storage-only fields out of public resource responses", () => {
    expect(mapResourceListItem(resourceRow)).toEqual({
      id: "res_1",
      memoId: "memo_1",
      originalMemoId: null,
      kind: "image",
      mimeType: "image/png",
      filename: "diagram.png",
      byteSize: 128,
      sha256: "checksum",
      width: 640,
      height: 480,
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T01:00:00.000Z",
      url: "/api/v1/resources/res_1/blob",
      memoTitle: "Architecture",
      memoExcerpt: "System overview",
      memoDeleted: false,
    });
  });

  test("normalizes filenames and keeps UTF-8 download names", () => {
    expect(normalizeFilename("  reports/季度\u0000.pdf  ")).toBe("reports-季度.pdf");
    const disposition = contentDispositionAttachment("季度报告 (最终版)'*.pdf");
    expect(disposition).toBe(
      "attachment; filename=\"download.pdf\"; filename*=UTF-8''%E5%AD%A3%E5%BA%A6%E6%8A%A5%E5%91%8A%20%28%E6%9C%80%E7%BB%88%E7%89%88%29%27%2A.pdf",
    );
    expect(new Headers({ "Content-Disposition": disposition }).get("Content-Disposition")).toBe(disposition);
    expect(contentDispositionAttachment("résumé.pdf")).toContain('filename="resume.pdf"');
  });

  test("infers normalized image extensions", () => {
    expect(inferImageExtension("photo.JPEG", "application/octet-stream")).toBe(".jpg");
    expect(inferImageExtension("photo", "image/avif")).toBe(".avif");
  });

  test("enforces upload type and size boundaries", () => {
    expect(() => validateImageUpload("image/png", MAX_IMAGE_UPLOAD_BYTES)).not.toThrow();
    expect(() => validateAttachmentUpload(MAX_ATTACHMENT_UPLOAD_BYTES)).not.toThrow();
    expect(() => validateImageUpload("image/svg+xml", 128)).toThrow();
    expect(() => validateAttachmentUpload(MAX_ATTACHMENT_UPLOAD_BYTES + 1)).toThrow();
  });
});
