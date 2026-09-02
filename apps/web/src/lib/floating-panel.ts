export type FloatingPanelPosition = {
  left: number;
  top: number;
};

export type FloatingPanelAnchor = FloatingPanelPosition & {
  placement: "above" | "below";
};

export type AnchoredFloatingPanelLayout = {
  bottom?: number;
  left: number;
  maxHeight: number;
  top?: number;
};

export const resolveAnchoredFloatingPanelLayout = (
  anchor: FloatingPanelAnchor,
  panelWidth: number,
  viewportSize: { height: number; width: number },
  edgeGap = 12,
  maxHeightRatio = 0.7,
): AnchoredFloatingPanelLayout => {
  const availableHeight = Math.max(0, viewportSize.height - edgeGap * 2);
  const maxHeight = Math.min(viewportSize.height * maxHeightRatio, availableHeight);
  const left = Math.max(
    edgeGap,
    Math.min(anchor.left, viewportSize.width - panelWidth - edgeGap),
  );

  if (anchor.placement === "above") {
    const desiredBottom = viewportSize.height - anchor.top;
    const largestBottom = Math.max(edgeGap, viewportSize.height - maxHeight - edgeGap);
    return {
      bottom: Math.max(edgeGap, Math.min(desiredBottom, largestBottom)),
      left,
      maxHeight,
    };
  }

  const largestTop = Math.max(edgeGap, viewportSize.height - maxHeight - edgeGap);
  return {
    left,
    maxHeight,
    top: Math.max(edgeGap, Math.min(anchor.top, largestTop)),
  };
};

export const clampFloatingPanelPosition = (
  position: FloatingPanelPosition,
  panelSize: { height: number; width: number },
  viewportSize: { height: number; width: number },
  edgeGap = 12,
): FloatingPanelPosition => ({
  left: Math.max(edgeGap, Math.min(position.left, viewportSize.width - panelSize.width - edgeGap)),
  top: Math.max(edgeGap, Math.min(position.top, viewportSize.height - panelSize.height - edgeGap)),
});
