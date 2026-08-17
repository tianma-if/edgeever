import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EdgeEverPluginHost, RegisteredPluginPanel } from "@/lib/plugins/plugin-host";

export const PluginPanelDialog = ({ host, panel, onClose }: {
  host: EdgeEverPluginHost;
  panel: RegisteredPluginPanel | null;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [mountError, setMountError] = useState<string | null>(null);
  const panelPluginId = panel?.pluginId ?? null;
  const panelId = panel?.id ?? null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !panelPluginId || !panelId) return;
    let disposed = false;
    let disposePanel: (() => void) | null = null;
    setMountError(null);
    container.replaceChildren();
    void host.mountPanel(panelPluginId, panelId, container).then((dispose) => {
      if (disposed) dispose();
      else disposePanel = dispose;
    }).catch((error: unknown) => {
      if (!disposed) setMountError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      disposed = true;
      disposePanel?.();
      container.replaceChildren();
    };
  }, [host, panelId, panelPluginId]);

  return (
    <Dialog open={Boolean(panel)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{panel?.title ?? t("plugins.panel")}</DialogTitle>
          <DialogDescription>{t("plugins.panelDescription")}</DialogDescription>
        </DialogHeader>
        {mountError ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{mountError}</div> : null}
        <div ref={containerRef} className="min-h-40 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700" />
      </DialogContent>
    </Dialog>
  );
};
