import { flip, hide, offset, shift, size, type ComputePositionConfig } from "@floating-ui/react-dom";

/** Prefer the gap above a gallery; move inside it at the editor's clipping edge. */
export const imageGalleryToolbarPosition: Partial<ComputePositionConfig> = {
  placement: "top-start",
  middleware: [
    offset(({ placement, rects }) => placement.startsWith("bottom") ? 8 - rects.reference.height : 8),
    flip({ padding: 8, fallbackPlacements: ["bottom-start"] }),
    shift({ padding: 8, crossAxis: true }),
    size({ apply: ({ availableWidth, rects, elements }) => {
      elements.floating.style.maxWidth = `${Math.max(0, Math.min(rects.reference.width, availableWidth))}px`;
    } }),
    hide({ strategy: "referenceHidden" }),
  ],
};
