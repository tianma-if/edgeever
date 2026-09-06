import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useDeployedUpdateNotice } from "@/hooks/useDeployedUpdateNotice";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SystemInfoPanel } from "./settings/SystemInfoPanel";

export const SystemInfoDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { t } = useTranslation();
  const { markSeen } = useDeployedUpdateNotice();

  useEffect(() => {
    if (open) markSeen();
  }, [markSeen, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(720px,calc(100dvh-2rem))] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle>{t("systemInfo.title")}</DialogTitle>
        </DialogHeader>
        <SystemInfoPanel />
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
