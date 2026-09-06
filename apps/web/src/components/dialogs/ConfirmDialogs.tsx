import { useState, useEffect, useRef } from "react";
import { AlertTriangle, ShieldCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Notebook } from "@edgeever/shared";

// Types derived from App.tsx
export type MemoDeleteConfirmation = { kind: "single" | "bulk"; memoIds: string[]; permanent: boolean };
export type NotebookNameDialogState =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; notebook: Notebook };

export const AppConfirmDialog = ({
  cancelLabel,
  confirmLabel,
  description,
  error,
  hideCancel = false,
  isWorking = false,
  title,
  tone = "danger",
  closeOnBrowserBack,
  onCancel,
  onConfirm,
}: {
  cancelLabel?: string;
  confirmLabel: string;
  description: string;
  error?: string | null;
  hideCancel?: boolean;
  isWorking?: boolean;
  title: string;
  tone?: "danger" | "neutral" | "primary";
  closeOnBrowserBack?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const { t } = useTranslation();
  const toneClassName =
    tone === "danger"
      ? "bg-rose-50 text-rose-700"
      : tone === "primary"
        ? "bg-emerald-50 text-emerald-700"
        : "bg-slate-100 text-slate-600";
  const confirmVariant = tone === "danger" ? "danger" : "solid";
  const Icon = tone === "danger" ? AlertTriangle : ShieldCheck;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open && !isWorking) onCancel(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden border border-slate-200 bg-white shadow-lg rounded-lg">
        <DialogHeader className="flex flex-row items-start gap-4 border-b border-slate-200 px-5 py-5 text-left">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", toneClassName)}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold text-slate-950">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5 text-slate-500">
              {description}
            </DialogDescription>
            {error ? <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p> : null}
          </div>
        </DialogHeader>
        <DialogFooter className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end border-t border-slate-50 bg-slate-50/50">
          {!hideCancel && (
            <Button className="justify-center" variant="outline" onClick={onCancel} disabled={isWorking}>
              {cancelLabel ?? t("common.cancel")}
            </Button>
          )}
          <Button className="justify-center" variant={confirmVariant} onClick={onConfirm} disabled={isWorking}>
            {isWorking ? t("common.processing") : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const MemoDeleteConfirmDialog = ({
  confirmation,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  confirmation: MemoDeleteConfirmation;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const { t } = useTranslation();
  const count = confirmation.memoIds.length;
  const isBulk = confirmation.kind === "bulk" || count > 1;
  const title = confirmation.permanent
    ? isBulk
      ? t("dialogs.memoDelete.permanentBulkTitle", { count })
      : t("dialogs.memoDelete.permanentSingleTitle")
    : isBulk
      ? t("dialogs.memoDelete.softBulkTitle", { count })
      : t("dialogs.memoDelete.softSingleTitle");
  const description = confirmation.permanent ? t("dialogs.memoDelete.permanentDescription") : t("dialogs.memoDelete.softDescription");
  const confirmLabel = confirmation.permanent ? t("dialogs.memoDelete.permanentConfirm") : t("dialogs.memoDelete.softConfirm");

  return (
    <AppConfirmDialog
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      tone="danger"
      isWorking={isDeleting}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
};

export const NotebookNameDialog = ({
  dialog,
  isSaving,
  onCancel,
  onSubmit,
}: {
  dialog: NotebookNameDialogState;
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) => {
  const { t } = useTranslation();
  const initialName = dialog.mode === "rename" ? dialog.notebook.name : "";
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedName = name.trim();
  const unchanged = dialog.mode === "rename" && trimmedName === dialog.notebook.name;
  const title = dialog.mode === "create" ? t("dialogs.notebookName.createTitle") : t("dialogs.notebookName.renameTitle");
  const submitLabel = dialog.mode === "create" ? t("dialogs.notebookName.createSubmit") : t("common.save");

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
  }, []);

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open && !isSaving) onCancel(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden border border-slate-200 bg-white shadow-lg rounded-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmedName || unchanged || isSaving) {
              return;
            }
            onSubmit(trimmedName);
          }}
        >
          <DialogHeader className="flex flex-row items-start justify-between gap-3 border-b border-slate-200 px-5 py-5 text-left">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-slate-950">
                {title}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm leading-5 text-slate-500">
                {dialog.mode === "create" ? t("dialogs.notebookName.createDescription") : t("dialogs.notebookName.renameDescription")}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="px-5 py-5">
            <label className="block text-xs font-semibold uppercase text-slate-500" htmlFor="notebook-name-input">
              {t("dialogs.notebookName.nameLabel")}
            </label>
            <Input
              id="notebook-name-input"
              ref={inputRef}
              className="mt-2 h-11 text-base focus-visible:border-emerald-300 focus-visible:ring-emerald-500/20"
              value={name}
              disabled={isSaving}
              maxLength={80}
              placeholder={t("dialogs.notebookName.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end border-t border-slate-50 bg-slate-50/50">
            <Button className="justify-center" type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button className="justify-center" type="submit" variant="solid" disabled={!trimmedName || unchanged || isSaving}>
              {isSaving ? t("common.saving") : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
