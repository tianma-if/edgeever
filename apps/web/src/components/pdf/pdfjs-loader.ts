import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

/** Shares one lazy PDF.js module and worker configuration across viewers and thumbnails. */
export const loadPdfJs = () => {
  pdfJsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return pdfjs;
  });
  return pdfJsPromise;
};
