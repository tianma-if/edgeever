import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
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
import { DEFAULT_CUSTOM_EDITOR_THEME, type CustomEditorTheme } from "../ThemeProvider";

interface CustomEditorThemeDialogProps {
  open: boolean;
  theme: CustomEditorTheme;
  onOpenChange: (open: boolean) => void;
  onSave: (theme: CustomEditorTheme) => void;
}

const COLOR_FIELDS = [
  ["background", "settings.customEditorTheme.background"],
  ["text", "settings.customEditorTheme.text"],
  ["heading", "settings.customEditorTheme.heading"],
  ["accent", "settings.customEditorTheme.accent"],
  ["soft", "settings.customEditorTheme.soft"],
  ["border", "settings.customEditorTheme.border"],
] as const;

export const CustomEditorThemeDialog = ({ open, theme, onOpenChange, onSave }: CustomEditorThemeDialogProps) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(theme);

  useEffect(() => {
    if (open) setDraft(theme);
  }, [open, theme]);

  const update = (key: keyof CustomEditorTheme, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const valid = COLOR_FIELDS.every(([key]) => /^#[0-9a-f]{6}$/i.test(draft[key])) && draft.name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.customEditorTheme.title")}</DialogTitle>
          <DialogDescription>{t("settings.customEditorTheme.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            {t("settings.customEditorTheme.name")}
            <Input value={draft.name} onChange={(event) => update("name", event.target.value)} maxLength={32} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {COLOR_FIELDS.map(([key, labelKey]) => (
              <label key={key} className="grid gap-1.5 text-sm font-medium text-slate-700">
                {t(labelKey)}
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(draft[key]) ? draft[key] : DEFAULT_CUSTOM_EDITOR_THEME[key]}
                    onChange={(event) => update(key, event.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-md border border-slate-200 bg-white p-1"
                    aria-label={t(labelKey)}
                  />
                  <Input value={draft[key]} onChange={(event) => update(key, event.target.value)} maxLength={7} />
                </div>
              </label>
            ))}
          </div>
          <div
            className="rounded-lg border p-4 text-sm leading-7"
            style={{ backgroundColor: draft.background, color: draft.text, borderColor: draft.border }}
          >
            <div className="text-lg font-semibold" style={{ color: draft.heading }}>{t("settings.customEditorTheme.previewTitle")}</div>
            <p>{t("settings.customEditorTheme.previewBody")}</p>
            <strong style={{ color: draft.accent }}>{t("settings.customEditorTheme.previewAccent")}</strong>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="mr-auto" onClick={() => setDraft(DEFAULT_CUSTOM_EDITOR_THEME)}>
            <RotateCcw className="h-4 w-4" />
            {t("settings.customEditorTheme.reset")}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button disabled={!valid} onClick={() => { onSave({ ...draft, name: draft.name.trim() }); onOpenChange(false); }}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
