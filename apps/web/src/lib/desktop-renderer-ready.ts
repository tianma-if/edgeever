const RENDERER_READY_FALLBACK_MS = 1_000;

export const reportDesktopRendererReadyAfterPaint = () => {
  if (
    typeof window === "undefined"
    || document.documentElement.dataset.edgeeverRendererReady === "true"
  ) return () => {};

  let cancelled = false;
  let secondFrame = 0;
  const reportReadyIfMounted = () => {
    if (
      cancelled
      || document.documentElement.dataset.edgeeverRendererReady === "true"
      || !document.querySelector("#root > *")
    ) return;

    document.documentElement.dataset.edgeeverRendererReady = "true";
    window.edgeeverDesktop?.rendererBootstrapReady();
  };

  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(reportReadyIfMounted);
  });
  // Chromium may suspend animation frames while the assisted Windows installer
  // leaves the relaunched app occluded. Keep startup reporting independent of
  // window visibility so a healthy renderer is not mistaken for a failed boot.
  const fallbackTimer = window.setTimeout(reportReadyIfMounted, RENDERER_READY_FALLBACK_MS);

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(firstFrame);
    if (secondFrame) window.cancelAnimationFrame(secondFrame);
    window.clearTimeout(fallbackTimer);
  };
};
