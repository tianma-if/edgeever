import { describe, expect, test } from "bun:test";
import {
  buildMobileResourceDownloadRequest,
  deleteMobileAttachmentFromDoc,
  deleteMobileResourceFromDoc,
  getMobileAttachmentTarget,
  getMobileImageTarget,
  getParagraphAttachmentTarget,
  parseMobileAttachmentTargetJson,
  parseMobileResourceTargetJson,
  readBlobAsUint8Array,
  renameMobileAttachmentInDoc,
  renameMobileResourceInDoc,
  resolveExportFilename,
  resolveResourceMimeType,
} from "./mobile-attachments.ts";

const href = "/api/v1/resources/res_123/blob";
const attachmentTarget = { filename: "report.pdf", href, kind: "attachment", resourceId: "res_123" };
const doc = {
  type: "doc",
  content: [{
    type: "paragraph",
    content: [{
      type: "text",
      text: "附件：report.pdf",
      marks: [{ type: "link", attrs: { href, class: "edgeever-attachment-link" } }],
    }],
  }],
};

describe("mobile attachments", () => {
  test("builds a native disk download request with protected-resource authentication", () => {
    expect(buildMobileResourceDownloadRequest("res/a", {
      baseUrl: "https://notes.example///",
      token: "secret",
    })).toEqual({
      url: "https://notes.example/api/v1/resources/res%2Fa/blob",
      headers: { Authorization: "Bearer secret" },
    });
  });

  test("recognizes resource links and attachment paragraphs", () => {
    expect(getMobileAttachmentTarget(href, "📄 报告：report.pdf")).toEqual(attachmentTarget);
    expect(getParagraphAttachmentTarget({
      type: "paragraph",
      children: [{ type: "text", content: "附件：" }, { type: "link", attributes: { href }, children: [{ type: "text", content: "report.pdf" }] }],
    })).toEqual(attachmentTarget);
  });

  test("validates attachment targets received from the DOM editor", () => {
    expect(parseMobileAttachmentTargetJson(JSON.stringify(attachmentTarget))).toEqual(attachmentTarget);
    expect(parseMobileAttachmentTargetJson(JSON.stringify({ ...attachmentTarget, resourceId: "different" }))).toBeNull();
    expect(parseMobileAttachmentTargetJson(JSON.stringify({ ...attachmentTarget, kind: "image" }))).toBeNull();
  });

  test("renames the linked label", () => {
    const updated = renameMobileAttachmentInDoc(doc, attachmentTarget, "final.pdf", "附件：");
    expect(updated.content[0].content[0].text).toBe("附件：final.pdf");
  });

  test("removes a standalone attachment paragraph", () => {
    expect(deleteMobileAttachmentFromDoc(doc, attachmentTarget)).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  test("recognizes and validates image resources", () => {
    const target = { filename: "photo.jpg", href, kind: "image", resourceId: "res_123" };
    expect(getMobileImageTarget(href, "photo.jpg")).toEqual(target);
    expect(parseMobileResourceTargetJson(JSON.stringify(target))).toEqual(target);
    expect(getMobileImageTarget("https://example.com/photo.jpg", "photo.jpg")).toBeNull();
  });

  test("renames and removes image nodes", () => {
    const target = { filename: "photo.jpg", href, kind: "image", resourceId: "res_123" };
    const imageDoc = {
      type: "doc",
      content: [{ type: "image", attrs: { alt: "photo.jpg", src: href, title: null } }],
    };
    expect(renameMobileResourceInDoc(imageDoc, target, "passport.jpg", "附件：")).toEqual({
      type: "doc",
      content: [{ type: "image", attrs: { alt: "passport.jpg", src: href, title: "passport.jpg" } }],
    });
    expect(deleteMobileResourceFromDoc(imageDoc, target)).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  test("resolves export mime types and filenames for SAF", () => {
    expect(resolveResourceMimeType("photo.webp", "")).toBe("image/webp");
    expect(resolveResourceMimeType("EdgeEver 极客猫猫", "image/svg+xml")).toBe("image/svg+xml");
    expect(resolveExportFilename("EdgeEver 极客猫猫", "image/svg+xml")).toBe("EdgeEver 极客猫猫.svg");
    expect(resolveExportFilename("report.pdf", "application/pdf")).toBe("report.pdf");
  });

  test("reads blob bytes via FileReader when Blob.arrayBuffer is missing (React Native)", async () => {
    const payload = new Uint8Array([1, 2, 3, 250]);
    const standard = new Blob([payload], { type: "image/webp" });
    expect([...await readBlobAsUint8Array(standard)]).toEqual([1, 2, 3, 250]);

    // RN Blob has no arrayBuffer(); previously openMobileResource threw
    // "undefined is not a function" at blob.arrayBuffer().
    const rnLike = { type: "image/webp", size: payload.byteLength };
    expect(rnLike.arrayBuffer).toBeUndefined();

    const OriginalFileReader = globalThis.FileReader;
    class FakeFileReader {
      result = null;
      error = null;
      onerror = null;
      onloadend = null;
      readAsArrayBuffer(blob) {
        expect(blob).toBe(rnLike);
        void Promise.resolve().then(() => {
          this.result = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
          this.onloadend?.();
        });
      }
    }
    globalThis.FileReader = FakeFileReader;
    try {
      expect([...await readBlobAsUint8Array(/** @type {any} */ (rnLike))]).toEqual([1, 2, 3, 250]);
    } finally {
      globalThis.FileReader = OriginalFileReader;
    }
  });
});
