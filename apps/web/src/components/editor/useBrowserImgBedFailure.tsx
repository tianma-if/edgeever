import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BrowserImgBedFailureChoice } from "@/lib/picgo";

// Serialize failures from multi-image insertion; changing notes cancels pending
// choices so a retry cannot send an old note's image after navigation.
export const useBrowserImgBedFailure = (identity: string) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pending = useRef<((choice: BrowserImgBedFailureChoice) => void) | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const finish = useCallback((choice: BrowserImgBedFailureChoice) => {
    pending.current?.(choice);
    pending.current = null;
    setOpen(false);
  }, []);
  useEffect(() => {
    setOpen(false);
    return () => {
      generation.current++;
      pending.current?.("cancel");
      pending.current = null;
    };
  }, [identity]);
  const chooseFailure = useCallback((): Promise<BrowserImgBedFailureChoice> => {
    const requestedGeneration = generation.current;
    const result = queue.current.then(() => {
      if (requestedGeneration !== generation.current) return "cancel" as const;
      return new Promise<BrowserImgBedFailureChoice>((resolve) => {
        pending.current = resolve;
        setOpen(true);
      });
    });
    queue.current = result;
    return result;
  }, []);
  const failureDialog = (
    <Dialog open={open} onOpenChange={(value) => { if (!value) finish("cancel"); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.picgo.imgbed.failedTitle")}</DialogTitle>
          <DialogDescription>{t("settings.picgo.imgbed.browserUploadFailed")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => finish("cancel")}>{t("settings.picgo.cancel")}</Button>
          <Button variant="outline" onClick={() => finish("fallback")}>{t("settings.picgo.fallback")}</Button>
          <Button onClick={() => finish("retry")}>{t("settings.picgo.retry")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { chooseFailure, failureDialog };
};
