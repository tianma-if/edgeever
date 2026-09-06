import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PluginUpdateInfo } from "@/lib/plugins/plugin-updates";

const permissionLabel = (permission: string) => permission.replace(":", " · ");

export const PluginUpdateDialog = ({
  isUpdating,
  update,
  onCancel,
  onConfirm,
}: {
  isUpdating: boolean;
  update: PluginUpdateInfo;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const { t } = useTranslation();
  const hasAddedAccess = update.addedPermissions.length > 0 || update.addedNetworkHosts.length > 0;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open && !isUpdating) onCancel(); }}>
      <DialogContent className="max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white p-0 shadow-lg">
        <DialogHeader className="flex flex-row items-start gap-4 border-b border-slate-200 px-5 py-5 text-left">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${hasAddedAccess ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
            {hasAddedAccess ? <AlertTriangle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold text-slate-950">
              {t("plugins.updates.confirmTitle", { name: update.latestManifest.name })}
            </DialogTitle>
            <DialogDescription className="mt-1 flex items-center gap-2 text-sm text-slate-500">
              <span>v{update.currentVersion}</span>
              <ArrowRight className="h-3.5 w-3.5" />
              <span>v{update.latestVersion}</span>
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="grid gap-3 px-5 py-4 text-sm">
          <p className="leading-6 text-slate-600">
            {hasAddedAccess ? t("plugins.updates.addedAccessDescription") : t("plugins.updates.confirmDescription")}
          </p>
          {update.addedPermissions.length > 0 ? (
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-700">{t("plugins.updates.addedPermissions")}</div>
              <div className="flex flex-wrap gap-1.5">
                {update.addedPermissions.map((permission) => (
                  <span key={permission} className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    {permissionLabel(permission)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {update.addedNetworkHosts.length > 0 ? (
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-700">{t("plugins.updates.addedNetworkHosts")}</div>
              <div className="flex flex-wrap gap-1.5">
                {update.addedNetworkHosts.map((hostname) => (
                  <span key={hostname} className="rounded-full bg-amber-50 px-2 py-1 font-mono text-xs text-amber-800">{hostname}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancel} disabled={isUpdating}>{t("common.cancel")}</Button>
          <Button onClick={onConfirm} disabled={isUpdating}>
            {isUpdating
              ? t("plugins.updates.updating")
              : hasAddedAccess
                ? t("plugins.updates.allowAndUpdate")
                : t("plugins.updates.update")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
