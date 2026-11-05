import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, FilePenLine, FolderOpen, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notifyRepositoryMutation } from "@/lib/repository-events";

export const DesktopAttachmentWritebacks = ({ scope }: { scope: string }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bridge = window.edgeeverDesktop;
  const [items, setItems] = useState<DesktopAttachmentWriteback[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!bridge?.attachmentWritebacks) return;
    try { setItems(await bridge.attachmentWritebacks()); setFailed(false); }
    catch { setFailed(true); }
  }, [bridge]);

  useEffect(() => {
    if (!bridge?.attachmentWritebacks) return;
    let active = true;
    const poll = async () => {
      try {
        const result = await bridge.attachmentWritebacks!();
        if (active) { setItems(result); setFailed(false); }
      } catch { if (active) setFailed(true); }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [bridge, scope]);

  useEffect(() => bridge?.onAttachmentResourceSaved?.(resource => {
    notifyRepositoryMutation(scope, { type: "resource.updated", resource });
    void queryClient.invalidateQueries({ queryKey: ["resources"] });
    void refresh();
  }), [bridge, queryClient, refresh, scope]);

  if (!bridge?.isAvailable || !bridge.attachmentWritebacks || (!items.length && !failed)) return null;
  const attention = items.filter(item => item.status === "conflict" || item.status === "error").length;
  const pending = items.filter(item => item.status === "pending" || item.status === "saving").length;
  const Icon = attention || failed ? AlertCircle : pending ? Loader2 : items.some(item => item.status === "saved") ? Check : FilePenLine;
  const summary = t(failed ? "attachmentWriteback.unavailable" : attention ? "attachmentWriteback.needsAttention" : pending ? "attachmentWriteback.pendingCount" : "attachmentWriteback.title", { count: attention || pending });
  const action = async (id: string, operation: "retry" | "reveal") => {
    setWorking(id);
    try {
      // The reveal call stays inside the activating button event.
      await (operation === "retry" ? bridge.retryAttachmentWriteback?.(id) : bridge.revealAttachmentWriteback?.(id));
      await refresh();
    } catch { setFailed(true); }
    finally { setWorking(null); }
  };
  return (
    <>
      <Button variant="outline" size="sm" className="fixed bottom-20 right-4 z-40 gap-2 bg-card shadow-sm" aria-label={summary} onClick={() => setOpen(true)}>
        <Icon aria-hidden="true" className={`h-4 w-4 ${attention || failed ? "text-amber-600" : pending ? "animate-spin" : ""}`} />
        <span role="status" aria-live="polite">{summary}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("attachmentWriteback.title")}</DialogTitle>
            <DialogDescription>{t("attachmentWriteback.description")}</DialogDescription>
          </DialogHeader>
          {failed ? <p role="alert" className="text-sm text-amber-700">{t("attachmentWriteback.unavailable")}</p> : null}
          <ul className="max-h-[55vh] divide-y divide-slate-100 overflow-y-auto">
            {items.map(item => (
              <li key={item.id} className="flex items-start gap-3 py-4 first:pt-1 last:pb-1">
                <FilePenLine className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="break-all text-sm font-medium">{item.filename}</p>
                  <p className={`mt-1 text-sm ${item.status === "conflict" || item.status === "error" ? "text-amber-700" : "text-slate-500"}`}>
                    {t(item.status === "conflict" ? "attachmentWriteback.conflict"
                      : item.status === "error" ? item.errorCode === "upload_too_large" ? "attachmentWriteback.tooLarge" : item.errorCode === "not_found" ? "attachmentWriteback.deleted" : item.errorCode === "writeback_unsupported" ? "attachmentWriteback.serverUpdateRequired" : "attachmentWriteback.error"
                        : `attachmentWriteback.${item.status}`)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.status === "error" || item.status === "conflict" ? (
                    <Button variant="ghost" size="sm" disabled={working === item.id} onClick={() => void action(item.id, "retry")}>{t("attachmentWriteback.retry")}</Button>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("attachmentWriteback.reveal")} disabled={working === item.id} onClick={() => void action(item.id, "reveal")}><FolderOpen className="h-4 w-4" /></Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("attachmentWriteback.reveal")}</TooltipContent>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
};
