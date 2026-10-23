import { toCanvas } from "html-to-image";
import { PDFDocument } from "pdf-lib";
import { buildMarkdownFilename } from "@/lib/note-markdown-export";
import { addPdfOutline, collectPrintOutline } from "@/lib/note-print-outline";

const A4_WIDTH = 595.28;

const canvasToPng = (canvas: HTMLCanvasElement) => new Promise<Uint8Array>((resolve, reject) => {
  canvas.toBlob(async (blob) => {
    if (!blob) {
      reject(new Error("Could not encode a PDF page"));
      return;
    }
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, "image/png");
});

export const buildPdfFilename = (title: string, fallback: string) =>
  buildMarkdownFilename(title, fallback).replace(/\.md$/i, ".pdf");

export const downloadPdfBytes = (bytes: Uint8Array, filename: string) => {
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** Browser export. Each preview page is captured, then the heading outline is attached. */
export const renderPagedPreviewPdf = async (root: Pick<ParentNode, "querySelectorAll">) => {
  const pageElements = [...root.querySelectorAll<HTMLElement>(".pagedjs_page")];
  if (pageElements.length === 0) throw new Error("Print preview has no pages");

  const outline = collectPrintOutline(root);
  const pdf = await PDFDocument.create();
  for (const [index, pageElement] of pageElements.entries()) {
    const previousShadow = pageElement.style.boxShadow;
    const pageLabel = pageElement.querySelector(".pagedjs_margin-bottom-center .pagedjs_margin-content");
    const previousLabel = pageLabel?.textContent ?? "";
    pageElement.style.boxShadow = "none";
    pageElement.classList.add("edgeever-print-pdf-capturing");
    if (pageLabel) pageLabel.textContent = `${index + 1} / ${pageElements.length}`;
    try {
      const rect = pageElement.getBoundingClientRect();
      const canvas = await toCanvas(pageElement, {
        backgroundColor: "#ffffff",
        cacheBust: false,
        pixelRatio: 2,
        skipAutoScale: true,
      });
      const image = await pdf.embedPng(await canvasToPng(canvas));
      const width = A4_WIDTH;
      const height = rect.width > 0 ? width * (rect.height / rect.width) : 841.89;
      const page = pdf.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });
    } finally {
      pageElement.style.boxShadow = previousShadow;
      pageElement.classList.remove("edgeever-print-pdf-capturing");
      if (pageLabel) pageLabel.textContent = previousLabel;
    }
  }

  addPdfOutline(pdf, outline);
  return pdf.save();
};

type PrintBridge = {
  savePdf?: () => Promise<Uint8Array>;
};

export const downloadNotePrintPdf = async (root: Pick<ParentNode, "querySelectorAll">, title: string, fallback: string) => {
  const bridge = (window as Window & { edgeeverPrint?: PrintBridge }).edgeeverPrint;
  const bytes = bridge?.savePdf ? await bridge.savePdf() : await renderPagedPreviewPdf(root);
  if (bytes.byteLength === 0) throw new Error("PDF export returned an empty file");
  downloadPdfBytes(bytes, buildPdfFilename(title, fallback));
};
