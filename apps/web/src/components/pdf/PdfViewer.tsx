import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ButtonTooltip } from "@/components/ui/button-tooltip";
import { AttachmentFileIcon } from "@/components/attachments/AttachmentFileIcon";
import { isDesktopResourceRuntime, toApiResourceUrl } from "@/lib/desktop-resources";
import { cn } from "@/lib/utils";
import { loadPdfJs } from "./pdfjs-loader";
import { loadPdfDocumentSource } from "./pdf-document-source";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

type PdfPageProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  fitWidth: boolean;
  zoom: number;
};

const PdfPage = ({ document, pageNumber, fitWidth, zoom }: PdfPageProps) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [hostWidth, setHostWidth] = useState(0);
  const [page, setPage] = useState<PDFPageProxy | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setVisible(true);
    }, { rootMargin: "600px 0px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void document.getPage(pageNumber).then((loadedPage) => {
      if (!cancelled) setPage(loadedPage);
    });
    return () => {
      cancelled = true;
      setPage(null);
    };
  }, [document, pageNumber, visible]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => setHostWidth(entry?.contentRect.width ?? 0));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !page || !canvas || hostWidth <= 0) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const cssScale = fitWidth ? Math.max(0.1, (hostWidth - 16) / baseViewport.width) : zoom;
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: cssScale * outputScale });
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / outputScale)}px`;
    canvas.style.height = `${Math.floor(viewport.height / outputScale)}px`;
    const task = page.render({ canvas, canvasContext: context, viewport });
    return () => task.cancel();
  }, [fitWidth, hostWidth, page, visible, zoom]);

  const placeholderHeight = 640;

  return (
    <span ref={hostRef} className="flex w-full justify-center" style={{ minHeight: visible && page ? undefined : placeholderHeight }}>
      <canvas ref={canvasRef} className="max-w-none bg-white shadow-sm" aria-label={`PDF page ${pageNumber}`} />
    </span>
  );
};

type PdfDocumentProps = {
  url: string;
  active: boolean;
  fitWidth: boolean;
  zoom: number;
  onError: () => void;
};

const PdfDocument = ({ url, active, fitWidth, zoom, onError }: PdfDocumentProps) => {
  const { t } = useTranslation();
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);

  useEffect(() => {
    if (!active) return;
    setDocument(null);
    let cancelled = false;
    let loadingTask: ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | null = null;

    void loadPdfJs().then(async (pdfjs) => {
      if (cancelled) return;
      const source = await loadPdfDocumentSource(url);
      if (cancelled) return;
      loadingTask = pdfjs.getDocument(source);
      const loadedDocument = await loadingTask.promise;
      if (cancelled) return;
      setDocument(loadedDocument);
    }).catch(() => {
      if (!cancelled) onError();
    });

    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [active, onError, url]);

  if (!document) {
    return (
      <span className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-600" aria-hidden="true" />
        {t("pdfViewer.loading")}
      </span>
    );
  }

  return (
    <span className="flex flex-col items-center gap-3 p-3">
      {Array.from({ length: document.numPages }, (_, index) => (
        <PdfPage key={index + 1} document={document} pageNumber={index + 1} fitWidth={fitWidth} zoom={zoom} />
      ))}
    </span>
  );
};

export type PdfViewerProps = {
  url: string;
  label: string;
  className?: string;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  fullscreen?: boolean;
  onRequestClose?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
};

export const PdfViewer = ({
  url,
  label,
  className,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  fullscreen = false,
  onRequestClose,
  onPrevious,
  onNext,
}: PdfViewerProps) => {
  const { t } = useTranslation();
  const resolvedUrl = isDesktopResourceRuntime() ? url : toApiResourceUrl(url);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);
  const [nearViewport, setNearViewport] = useState(fullscreen);
  const [fitWidth, setFitWidth] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const [internalFullscreen, setInternalFullscreen] = useState(false);
  const isFullscreen = fullscreen || internalFullscreen;
  const expanded = isFullscreen || (controlledExpanded ?? uncontrolledExpanded);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || fullscreen) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setNearViewport(true);
    }, { rootMargin: "500px 0px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, [fullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable = target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      if (event.key === "Escape") {
        if (fullscreen) onRequestClose?.();
        else setInternalFullscreen(false);
        return;
      }
      if (isEditable || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowLeft" && onPrevious) {
        event.preventDefault();
        onPrevious();
      } else if (event.key === "ArrowRight" && onNext) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fullscreen, isFullscreen, onNext, onPrevious, onRequestClose]);

  const handleError = useCallback(() => setFailed(true), []);
  const closeFullscreen = () => fullscreen ? onRequestClose?.() : setInternalFullscreen(false);
  const setExpanded = (nextExpanded: boolean) => {
    if (controlledExpanded === undefined) setUncontrolledExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  };
  const active = expanded && nearViewport && !failed;

  const viewer = (
    <span
      ref={rootRef}
      className={cn(
        "edgeever-pdf-viewer block w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm",
        isFullscreen && "fixed inset-0 z-[120] flex rounded-none border-0 bg-slate-950/95 p-3 sm:p-5",
        className,
      )}
      role={isFullscreen ? "dialog" : undefined}
      aria-modal={isFullscreen ? true : undefined}
      aria-label={isFullscreen ? t("pdfViewer.fullscreenLabel", { filename: label }) : undefined}
    >
      <span className={cn("flex min-w-0 flex-col", isFullscreen && "mx-auto h-full w-full max-w-6xl overflow-hidden rounded-xl bg-white shadow-2xl")}>
        <span className="flex min-h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3">
          {isFullscreen && onPrevious ? (
            <ButtonTooltip title={t("pdfViewer.previous")}>
              <button type="button" className="pdf-viewer-action" aria-label={t("pdfViewer.previous")} onClick={onPrevious}>
                <ChevronLeft aria-hidden="true" />
              </button>
            </ButtonTooltip>
          ) : null}
          {isFullscreen && onNext ? (
            <ButtonTooltip title={t("pdfViewer.next")}>
              <button type="button" className="pdf-viewer-action" aria-label={t("pdfViewer.next")} onClick={onNext}>
                <ChevronRight aria-hidden="true" />
              </button>
            </ButtonTooltip>
          ) : null}
          <button
            type="button"
            className="edgeever-attachment-link flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm font-semibold text-slate-800 disabled:cursor-default"
            aria-expanded={expanded}
            disabled={isFullscreen}
            onClick={() => setExpanded(!expanded)}
          >
            <AttachmentFileIcon mimeType="application/pdf" filename={label} className="h-4 w-4" />
            <span className="min-w-0 truncate">{label}</span>
          </button>
          {expanded && !failed ? (
            <>
              <ButtonTooltip title={t("pdfViewer.zoomOut")}>
                <button type="button" className="pdf-viewer-action" aria-label={t("pdfViewer.zoomOut")} disabled={fitWidth || zoom <= MIN_ZOOM} onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}>
                  <ZoomOut aria-hidden="true" />
                </button>
              </ButtonTooltip>
              <ButtonTooltip title={t("pdfViewer.zoomIn")}>
                <button type="button" className="pdf-viewer-action" aria-label={t("pdfViewer.zoomIn")} disabled={fitWidth || zoom >= MAX_ZOOM} onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}>
                  <ZoomIn aria-hidden="true" />
                </button>
              </ButtonTooltip>
              <ButtonTooltip title={t("pdfViewer.fitWidth")}>
                <button type="button" className={cn("pdf-viewer-action", fitWidth && "is-active")} aria-label={t("pdfViewer.fitWidth")} aria-pressed={fitWidth} onClick={() => setFitWidth((value) => !value)}>
                  <RotateCcw aria-hidden="true" />
                </button>
              </ButtonTooltip>
            </>
          ) : null}
          <ButtonTooltip title={t("pdfViewer.download")}>
            <a className="pdf-viewer-action" href={resolvedUrl} download={label} aria-label={t("pdfViewer.download")}><Download aria-hidden="true" /></a>
          </ButtonTooltip>
          <ButtonTooltip title={t("pdfViewer.openExternal")}>
            <a className="pdf-viewer-action" href={resolvedUrl} target="_blank" rel="noreferrer" aria-label={t("pdfViewer.openExternal")}><ExternalLink aria-hidden="true" /></a>
          </ButtonTooltip>
          {isFullscreen || (expanded && !failed) ? (
            <ButtonTooltip title={isFullscreen ? t("pdfViewer.exitFullscreen") : t("pdfViewer.fullscreen")}>
              <button type="button" className="pdf-viewer-action" aria-label={isFullscreen ? t("pdfViewer.exitFullscreen") : t("pdfViewer.fullscreen")} onClick={() => {
                if (isFullscreen) closeFullscreen();
                else {
                  setNearViewport(true);
                  setInternalFullscreen(true);
                }
              }}>
                {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
              </button>
            </ButtonTooltip>
          ) : null}
          {!isFullscreen ? (
            <ButtonTooltip title={expanded ? t("pdfViewer.collapse") : t("pdfViewer.expand")}>
              <button type="button" className="pdf-viewer-action" aria-label={expanded ? t("pdfViewer.collapse") : t("pdfViewer.expand")} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </button>
            </ButtonTooltip>
          ) : null}
        </span>
        {failed ? (
          <span className="flex min-h-24 items-center justify-center px-4 text-center text-sm text-slate-500">
            {t("pdfViewer.unavailable")}
          </span>
        ) : expanded ? (
          <span className={cn("block overflow-auto bg-slate-100", isFullscreen ? "min-h-0 flex-1" : "h-[min(72vh,52rem)]")}>
            <PdfDocument url={resolvedUrl} active={active} fitWidth={fitWidth} zoom={zoom} onError={handleError} />
          </span>
        ) : null}
      </span>
    </span>
  );

  return isFullscreen ? createPortal(viewer, document.body) : viewer;
};
