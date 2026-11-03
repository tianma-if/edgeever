/** Own only the fullscreen session started by the focus-mode control. */
export const createFocusFullscreen = (doc: Document, onExit: () => void) => {
  let enabled = false;
  let owned = false;
  let pending = false;

  const exit = () => {
    if (!owned || pending) return;
    owned = false;
    if (doc.fullscreenElement === doc.documentElement) {
      void doc.exitFullscreen().catch(() => undefined);
    }
  };
  const onChange = () => {
    if (owned && !doc.fullscreenElement && !pending) {
      owned = false;
      if (enabled) {
        enabled = false;
        onExit();
      }
    }
  };
  doc.addEventListener("fullscreenchange", onChange);

  const setEnabled = (next: boolean) => {
    enabled = next;
    if (!next) {
      exit();
      return;
    }
    if (pending || doc.fullscreenElement || !doc.fullscreenEnabled || !doc.documentElement.requestFullscreen) return;
    // Invoke synchronously in the click/shortcut event to retain user activation.
    pending = true;
    owned = true;
    try {
      void doc.documentElement.requestFullscreen().then(() => {
        pending = false;
        if (!enabled) exit();
        else onChange();
      }, (error: unknown) => {
        pending = false;
        owned = false;
        console.warn("Browser fullscreen unavailable; keeping focus mode.", error);
      });
    } catch (error) {
      pending = false;
      owned = false;
      console.warn("Browser fullscreen unavailable; keeping focus mode.", error);
    }
  };

  return {
    setEnabled,
    dispose: () => {
      doc.removeEventListener("fullscreenchange", onChange);
      setEnabled(false);
    },
  };
};
