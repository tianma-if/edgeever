import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { PRINT_PDF_OPTIONS } from "./print-pdf.mjs";

const read = (url) => readFileSync(new URL(url, import.meta.url), "utf8");

describe("desktop note PDF", () => {
  test("asks Chromium for a heading outline in the viewer sidebar", () => {
    expect(PRINT_PDF_OPTIONS).toMatchObject({
      generateDocumentOutline: true,
      generateTaggedPDF: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
  });

  test("the print window can only save its own PDF", () => {
    const preload = read("../preload/print.cjs");
    const main = read("./index.mjs");
    expect(preload).toContain('ipcRenderer.invoke("desktop:print-pdf")');
    expect(preload).not.toContain("edgeeverDesktop");
    expect(main).toContain('ipcMain.handle("desktop:print-pdf"');
    expect(main).toContain("isAllowedPrintPreviewUrl");
    expect(main).toContain("PRINT_PDF_OPTIONS");
  });
});
