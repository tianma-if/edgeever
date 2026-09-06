import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

type ImageViewerProps = {
  alt: string;
  closeLabel: string;
  open: boolean;
  src: string;
  viewerLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  onClose: () => void;
};

export const ImageViewer = ({
  alt,
  closeLabel,
  open,
  src,
  viewerLabel,
  zoomInLabel,
  zoomOutLabel,
  onClose,
}: ImageViewerProps) => {
  if (!open || !src) return null;

  return (
    <Lightbox
      open
      close={onClose}
      index={0}
      slides={[{ src, alt: alt || viewerLabel, imageFit: "contain" }]}
      plugins={[Zoom]}
      labels={{
        Close: closeLabel,
        "Photo gallery": viewerLabel,
        "Zoom in": zoomInLabel,
        "Zoom out": zoomOutLabel,
      }}
      toolbar={{ buttons: ["zoom", "close"] }}
      carousel={{ finite: true, padding: 24, imageFit: "contain" }}
      controller={{
        closeOnBackdropClick: true,
        closeOnPullDown: false,
        closeOnPullUp: false,
        disableSwipeNavigation: true,
      }}
      zoom={{
        maxZoomPixelRatio: 6,
        zoomInMultiplier: 1.5,
        keyboardMoveDistance: 80,
        pinchZoomV4: true,
        scrollToZoom: true,
      }}
      animation={{ fade: 160, zoom: 180 }}
      render={{
        buttonPrev: () => null,
        buttonNext: () => null,
      }}
    />
  );
};
