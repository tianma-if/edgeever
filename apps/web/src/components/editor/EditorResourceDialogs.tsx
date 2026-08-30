import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ResourceDialogState } from "./useEditorResourceActions";

export type EditorResourceDialogLabels = {
  renameTitle: string;
  renameDescription: string;
  filenameLabel: string;
  deleteTitle: string;
  deleteDescription: string;
};

export const EditorResourceDialogs = ({
  dialog,
  labels,
  filename,
  pending,
  error,
  onFilenameChange,
  onClose,
  onRename,
  onDelete,
}: {
  dialog: ResourceDialogState | null;
  labels: EditorResourceDialogLabels;
  filename: string;
  pending: boolean;
  error: string | null;
  onFilenameChange: (filename: string) => void;
  onClose: () => void;
  onRename: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}) => {
  const { t } = useTranslation();

  return (
    <>
      <Dialog open={dialog?.action === "rename"} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              void onRename();
            }}
          >
            <DialogHeader>
              <DialogTitle>{labels.renameTitle}</DialogTitle>
              <DialogDescription>{labels.renameDescription}</DialogDescription>
            </DialogHeader>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              {labels.filenameLabel}
              <Input
                autoFocus
                value={filename}
                maxLength={160}
                disabled={pending}
                onChange={(event) => onFilenameChange(event.target.value)}
              />
            </label>
            {error ? <p className="text-sm text-rose-600" role="alert">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="solid" disabled={pending || !filename.trim()}>
                {pending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.action === "delete"} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.deleteTitle}</DialogTitle>
            <DialogDescription>{labels.deleteDescription}</DialogDescription>
          </DialogHeader>
          <p className="truncate rounded-md bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
            {dialog?.target.filename}
          </p>
          {error ? <p className="text-sm text-rose-600" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="danger" disabled={pending} onClick={() => void onDelete()}>
              {pending ? t("common.processing") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && !dialog ? (
        <div
          className="fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white shadow-lg"
          role="alert"
        >
          {error}
        </div>
      ) : null}
    </>
  );
};
