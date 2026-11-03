import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopBackupActions, DesktopBackupStatus } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { describeDesktopBackupError } from "@/lib/desktop-backup";

export const DesktopBackupRunDialog = ({ status, onRun, onClose }: {
  status: DesktopBackupStatus;
  onRun: (input: DesktopBackupActions["run"]["input"]) => Promise<unknown>;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const pending = status.pendingPublication;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = password.length > 0 && (Boolean(pending) || password === confirmation);
  const run = async () => {
    if (!valid || working) return;
    setWorking(true); setError(null);
    try {
      await onRun({ backupSetId: status.backupSetId, password });
      onClose();
    } catch (failure) { setError(describeDesktopBackupError(t, failure)); setWorking(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !working) onClose(); }}><DialogContent>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void run(); }}>
      <DialogHeader>
        <DialogTitle>{t(pending ? "desktopBackup.verifyPublication" : "desktopBackup.run")}</DialogTitle>
        <DialogDescription className="break-all">{pending ? t("desktopBackup.verifyPassword", { name: pending.name }) : status.actualDirectory}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Input autoFocus type="password" autoComplete="off" aria-label={t("desktopBackup.password")} placeholder={t("desktopBackup.password")} disabled={working} value={password} onChange={(event) => setPassword(event.target.value)} />
        {!pending ? <Input type="password" autoComplete="off" aria-label={t("desktopBackup.confirmPassword")} placeholder={t("desktopBackup.confirmPassword")} disabled={working} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /> : null}
        {!pending && confirmation && password !== confirmation ? <p className="text-sm text-destructive" role="alert">{t("desktopBackup.passwordMismatch")}</p> : null}
        {!pending ? <p className="text-sm text-muted-foreground">{t("desktopBackup.oncePassword")}</p> : null}
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <DialogFooter><Button type="button" variant="outline" disabled={working} onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" className="bg-foreground text-background hover:bg-foreground/90" disabled={!valid || working}>{t(working ? "common.processing" : pending ? "desktopBackup.verifyPublication" : "desktopBackup.run")}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
};
