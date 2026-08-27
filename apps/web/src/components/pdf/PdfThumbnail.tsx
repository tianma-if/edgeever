import type { PDFPageProxy } from "pdfjs-dist";
import { FileText } from "lucide-react";
import pLimit from "p-limit";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { loadPdfJs } from "./pdfjs-loader";
import { loadPdfDocumentSource } from "./pdf-document-source";
import {
  calculatePdfThumbnailScale,
  isPdfThumbnailEligible,
  PDF_THUMBNAIL_CONCURRENCY,
  type PdfThumbnailSize,
} from "./pdf-thumbnail";

const limitPdfThumbnailLoad = pLimit(PDF_THUMBNAIL_CONCURRENCY);
const limitPdfThumbnailRender = pLimit(PDF_THUMBNAIL_CONCURRENCY);

type PdfThumbnailProps = {
  url: string;
  label: string;
  byteSize: number;
  className?: string;
};

export const PdfThumbnail = memo(({ url, label, byteSize, className }: PdfThumbnailProps) => {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [hostSize, setHostSize] = useState<PdfThumbnailSize>({ width: 0, height: 0 });
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);
  const eligible = isPdfThumbnailEligible(byteSize);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !eligible) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setNearViewport(true);
      observer.disconnect();
    }, { rootMargin: "400px 0px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [eligible]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !eligible) return;
    const updateSize = () => {
      const { width, height } = host.getBoundingClientRect();
      setHostSize((current) => current.width === width && current.height === height
        ? current
        : { width, height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [eligible]);

  useEffect(() => {
    if (!eligible || !nearViewport || failed) return;
    let cancelled = false;
    let loadingTask: ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | null = null;

    void limitPdfThumbnailLoad(async () => {
      if (cancelled) return;
      const pdfjs = await loadPdfJs();
      if (cancelled) return;
      const source = await loadPdfDocumentSource(url);
      if (cancelled) return;
      loadingTask = pdfjs.getDocument(source);
      const document = await loadingTask.promise;
      const firstPage = await document.getPage(1);
      if (!cancelled) setPage(firstPage);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [eligible, failed, nearViewport, url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!page || !canvas || hostSize.width <= 0 || hostSize.height <= 0 || failed) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const cssScale = calculatePdfThumbnailScale(
      { width: baseViewport.width, height: baseViewport.height },
      hostSize,
    );
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: cssScale * outputScale });
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    let task: ReturnType<PDFPageProxy["render"]> | null = null;
    void limitPdfThumbnailRender(async () => {
      if (cancelled) return;
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${Math.max(1, Math.floor(viewport.width / outputScale))}px`;
      canvas.style.height = `${Math.max(1, Math.floor(viewport.height / outputScale))}px`;
      task = page.render({ canvas, canvasContext: context, viewport });
      await task.promise;
      if (!cancelled) setRendered(true);
    }).catch((error: { name?: string }) => {
      if (!cancelled && error?.name !== "RenderingCancelledException") setFailed(true);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [failed, hostSize, page]);

  return (
    <span ref={hostRef} className={cn("relative flex h-full w-full items-center justify-center overflow-hidden", className)}>
      {!rendered ? <FileText className="h-8 w-8 text-rose-600" aria-hidden="true" /> : null}
      <canvas
        ref={canvasRef}
        role={rendered ? "img" : undefined}
        aria-label={rendered ? t("assets.pdfThumbnail", { filename: label }) : undefined}
        aria-hidden={rendered ? undefined : true}
        className={cn(
          "absolute max-h-full max-w-full bg-white shadow-sm transition-opacity duration-200",
          rendered ? "opacity-100" : "opacity-0",
        )}
      />
    </span>
  );
});

PdfThumbnail.displayName = "PdfThumbnail";
