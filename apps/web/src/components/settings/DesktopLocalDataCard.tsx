import { useState } from "react";
import { AlertCircle, AlertTriangle, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SETTINGS_CARD_DESCRIPTION_CLASSNAME,
  SETTINGS_CARD_HEADER_CLASSNAME,
  SETTINGS_CARD_ICON_CLASSNAME,
  SETTINGS_CARD_TITLE_CLASSNAME,
} from "./settings-ui";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const localDataResetErrorKeys: Record<DesktopLocalDataResetErrorCode, string> = {
  "unsafe-data-directory": "localDataReset.errors.unsafeDataDirectory",
  "application-bundle-not-found": "localDataReset.errors.applicationBundleNotFound",
  "helper-start-failed": "localDataReset.errors.helperStartFailed",
  unexpected: "localDataReset.errors.unexpected",
};

export const DesktopLocalDataCard = () => {
  const { t } = useTranslation();
  const bridge = window.edgeeverDesktop;
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [errorCode, setErrorCode] = useState<DesktopLocalDataResetErrorCode | null>(null);

  if (!bridge?.canClearLocalData) return null;

  const handleClear = async () => {
    setIsClearing(true);
    setErrorCode(null);
    try {
      const result = await bridge.clearLocalData();
      if (!result.scheduled) {
        setIsClearing(false);
        setErrorCode(result.errorCode);
      }
    } catch {
      setIsClearing(false);
      setErrorCode("unexpected");
    }
  };

  return (
    <>
      <Card className="w-full min-w-0 overflow-hidden border-rose-100 bg-rose-50/30 shadow-none">
        <CardHeader className={SETTINGS_CARD_HEADER_CLASSNAME}>
          <CardTitle className={cn(SETTINGS_CARD_TITLE_CLASSNAME, "text-rose-800")}>
            <AlertTriangle className={cn(SETTINGS_CARD_ICON_CLASSNAME, "text-rose-700")} />
            {t("localDataReset.title")}
          </CardTitle>
          <CardDescription className={SETTINGS_CARD_DESCRIPTION_CLASSNAME}>{t("localDataReset.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 sm:px-5 sm:pb-5">
          {errorCode ? (
            <p className="flex items-center gap-1.5 text-xs text-rose-700" role="alert">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {t(localDataResetErrorKeys[errorCode])}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              variant="danger"
              className="bg-rose-600 font-semibold text-white shadow-sm hover:bg-rose-700"
              onClick={() => {
                setErrorCode(null);
                setConfirmationOpen(true);
              }}
            >
              <RotateCcw className="h-4 w-4" />
              {t("localDataReset.action")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={confirmationOpen}
        onOpenChange={(open) => {
          if (!isClearing) setConfirmationOpen(open);
        }}
      >
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
          <DialogHeader className="flex flex-row items-start gap-4 border-b border-slate-200 px-5 py-5 text-left">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-700">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base leading-6">{t("localDataReset.dialogTitle")}</DialogTitle>
              <DialogDescription className="mt-1 text-sm leading-5">
                {t("localDataReset.dialogDescription")}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="grid gap-3 px-5 py-4 text-sm leading-5 text-slate-600">
            <p>{t("localDataReset.remoteUnaffected")}</p>
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 font-medium text-rose-800">
              {t("localDataReset.warning")}
            </p>
          </div>
          <DialogFooter className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={isClearing} onClick={() => setConfirmationOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              className="bg-rose-600 font-semibold text-white hover:bg-rose-700"
              disabled={isClearing}
              onClick={() => void handleClear()}
            >
              {isClearing ? t("localDataReset.clearing") : t("localDataReset.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
