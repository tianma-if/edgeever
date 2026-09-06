import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import Lightbox, { type ZoomRef } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import {
  getMermaidSvgPresentation,
  normalizeMermaidSvgForViewer,
  resolveMermaidViewerBackground,
} from "@/lib/mermaid-svg";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MermaidViewerProps {
  closeLabel: string;
  fallbackBackgroundColor: string;
  open: boolean;
  resetZoomLabel: string;
  svg: string;
  viewerLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  onClose: () => void;
}

export const MermaidViewer = ({
  closeLabel,
  fallbackBackgroundColor,
  open,
  resetZoomLabel,
  svg,
  viewerLabel,
  zoomInLabel,
  zoomOutLabel,
  onClose,
}: MermaidViewerProps) => {
  const zoomRef = useRef<ZoomRef | null>(null);
  const [objectUrl, setObjectUrl] = useState("");
  const [zoom, setZoom] = useState(1);
  const presentation = useMemo(() => getMermaidSvgPresentation(svg), [svg]);
  const viewerSvg = useMemo(() => normalizeMermaidSvgForViewer(svg, presentation), [presentation, svg]);
  const backgroundColor = resolveMermaidViewerBackground(
    presentation.backgroundColor,
    fallbackBackgroundColor
  );

  useEffect(() => {
    if (!open || !svg) {
      setObjectUrl("");
      return;
    }

    const nextUrl = URL.createObjectURL(new Blob([viewerSvg], { type: "image/svg+xml;charset=utf-8" }));
    setObjectUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [open, svg, viewerSvg]);

  useEffect(() => {
    if (!open) setZoom(1);
  }, [open]);

  if (!open || !objectUrl) return null;

  const resetButton = (
    <TooltipProvider key="reset-mermaid-zoom" delayDuration={0} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="edgeever-mermaid-viewer-reset"
            disabled={zoom <= 1}
            aria-label={resetZoomLabel}
            onClick={() => zoomRef.current?.changeZoom(1)}
          >
            <RotateCcw aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{resetZoomLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <Lightbox
      className="edgeever-mermaid-viewer"
      open
      close={onClose}
      index={0}
      slides={[{
        src: objectUrl,
        alt: viewerLabel,
        width: presentation.width,
        height: presentation.height,
        imageFit: "contain",
      }]}
      plugins={[Zoom]}
      labels={{
        Close: closeLabel,
        "Photo gallery": viewerLabel,
        "Zoom in": zoomInLabel,
        "Zoom out": zoomOutLabel,
      }}
      toolbar={{ buttons: ["zoom", resetButton, "close"] }}
      carousel={{ finite: true, padding: 24, imageFit: "contain" }}
      controller={{
        closeOnBackdropClick: true,
        closeOnPullDown: false,
        closeOnPullUp: false,
        disableSwipeNavigation: true,
      }}
      zoom={{
        ref: zoomRef,
        maxZoomPixelRatio: 6,
        zoomInMultiplier: 1.5,
        keyboardMoveDistance: 80,
        pinchZoomV4: true,
        scrollToZoom: true,
      }}
      animation={{ fade: 160, zoom: 180 }}
      on={{ zoom: ({ zoom: nextZoom }) => setZoom(nextZoom) }}
      render={{
        buttonPrev: () => null,
        buttonNext: () => null,
      }}
      styles={{
        root: { "--yarl__color_backdrop": backgroundColor },
        container: { backgroundColor },
      }}
    />
  );
};
