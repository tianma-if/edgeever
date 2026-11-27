import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { MemoDetail } from "@edgeever/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const SaveAsTemplateDialog = ({ initialName, onSave, onClose }: {
  initialName: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (saving || !trimmed) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSave(trimmed);
      onClose();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-w-md" aria-describedby={undefined} showCloseButton={!saving}
        onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }}>
        <DialogTitle>{t("templates.saveAsTemplate")}</DialogTitle>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <label htmlFor={inputId}>{t("templates.name")}</label>
            <Input id={inputId} ref={inputRef} value={name} disabled={saving}
              onChange={(event) => setName(event.target.value)} />
          </div>
          {failed && <p role="alert" className="text-sm text-destructive">{t("templates.createFailed")}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={saving || !name.trim()}>{t(saving ? "common.saving" : "common.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const useSaveAsTemplateDialog = (
  editableMemoId: string | null,
  onSave: (memo: MemoDetail, name: string) => Promise<void>,
) => {
  const [source, setSource] = useState<{ memo: MemoDetail; initialName: string } | null>(null);
  useEffect(() => { setSource(null); }, [editableMemoId]);
  const requestTemplateName = useCallback((memo: MemoDetail, initialName: string) => {
    setSource({ memo, initialName });
  }, []);

  const templateNameDialog = source && source.memo.id === editableMemoId ? (
    <SaveAsTemplateDialog
      initialName={source.initialName}
      onSave={(name) => onSave(source.memo, name)}
      onClose={() => setSource((current) => current === source ? null : current)}
    />
  ) : null;
  return { requestTemplateName, templateNameDialog };
};
