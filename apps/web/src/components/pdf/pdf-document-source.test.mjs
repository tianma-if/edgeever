import { describe, expect, test } from "bun:test";
import { canPreviewPdfInline, loadPdfDocumentSource, MAX_INLINE_PDF_BYTES } from "./pdf-document-source.ts";

const bridge = {
  readResource: async (id) => ({ type: "application/pdf", bytes: new Uint8Array([1, id.length]) }),
  readStagedResource: async (id) => ({ name: "draft.pdf", type: "application/pdf", bytes: new Uint8Array([2, id.length]) }),
};

describe("PDF document sources", () => {
  test("keeps oversized PDFs compact instead of materializing them for inline preview", () => {
    expect(canPreviewPdfInline(MAX_INLINE_PDF_BYTES)).toBe(true);
    expect(canPreviewPdfInline(MAX_INLINE_PDF_BYTES + 1)).toBe(false);
    expect(canPreviewPdfInline(undefined)).toBe(true);
  });

  test("keeps normal web URLs for PDF.js network loading", async () => {
    await expect(loadPdfDocumentSource("https://example.com/report.pdf", bridge)).resolves.toEqual({
      url: "https://example.com/report.pdf",
    });
  });

  test("recovers leaked desktop resource URLs in the web runtime", async () => {
    await expect(loadPdfDocumentSource("edgeever-resource://resource/res_web", undefined)).resolves.toEqual({
      url: "/api/v1/resources/res_web/blob",
    });
  });

  test("loads synced desktop resources through the native bridge", async () => {
    const source = await loadPdfDocumentSource("edgeever-resource://resource/res_123", bridge);
    expect(source).toEqual({ data: new Uint8Array([1, 7]) });
  });

  test("loads staged desktop resources before sync completes", async () => {
    const source = await loadPdfDocumentSource("edgeever-staged://stage_123", bridge);
    expect(source).toEqual({ data: new Uint8Array([2, 9]) });
  });

  test("does not mutate or transfer the bridge-owned byte array", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const source = await loadPdfDocumentSource("edgeever-resource://resource/res_copy", {
      ...bridge,
      readResource: async () => ({ type: "application/pdf", bytes }),
    });
    expect(source.data).not.toBe(bytes);
    expect(source.data).toEqual(bytes);
  });
});
