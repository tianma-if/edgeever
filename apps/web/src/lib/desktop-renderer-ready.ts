let rendererReadyReported = false;

export const reportDesktopRendererReadyAfterPaint = () => {
  if (rendererReadyReported || typeof window === "undefined") return () => {};

  let cancelled = false;
  let secondFrame = 0;
  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => {
      if (cancelled || rendererReadyReported || !document.querySelector("#root > *")) return;
      rendererReadyReported = true;
      document.documentElement.dataset.edgeeverRendererReady = "true";
      window.edgeeverDesktop?.rendererBootstrapReady();
    });
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(firstFrame);
    if (secondFrame) window.cancelAnimationFrame(secondFrame);
  };
};
