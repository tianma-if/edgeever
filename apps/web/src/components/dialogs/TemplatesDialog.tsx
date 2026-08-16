import { useState } from "react";
import { Check, LayoutList, Pencil, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MemoTemplate } from "@edgeever/shared";

export const TemplatesDialog = ({
  canCreateMemo,
  isCreating,
  onClose,
  savedTemplates,
  onUseSavedTemplate,
  onDeleteSavedTemplate,
  onUpdateSavedTemplate,
}: {
  canCreateMemo: boolean;
  isCreating: boolean;
  onClose: () => void;
  savedTemplates: MemoTemplate[];
  onUseSavedTemplate: (template: MemoTemplate) => void;
  onDeleteSavedTemplate: (template: MemoTemplate) => void;
  onUpdateSavedTemplate: (templateId: string, payload: { name: string; description: string | null; title: string | null; contentMarkdown: string; tags: string[] }) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const [editingTemplate, setEditingTemplate] = useState<MemoTemplate | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", title: "", contentMarkdown: "", tags: "" });

  const startEditing = (template: MemoTemplate) => {
    setEditingTemplate(template);
    setDraft({
      name: template.name,
      description: template.description ?? "",
      title: template.title ?? "",
      contentMarkdown: template.contentMarkdown,
      tags: template.tags.join(", "),
    });
  };

  const cancelEditing = () => setEditingTemplate(null);

  const saveEditing = async () => {
    if (!editingTemplate || !draft.name.trim()) return;
    await onUpdateSavedTemplate(editingTemplate.id, {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      title: draft.title.trim() || null,
      contentMarkdown: draft.contentMarkdown,
      tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    });
    setEditingTemplate(null);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open && !isCreating) onClose(); }}>
      <DialogContent className="max-w-[620px] p-0 overflow-hidden border border-slate-200 bg-white shadow-lg rounded-lg">
        <DialogHeader className="flex flex-row items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 text-left">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <LayoutList className="h-4 w-4 text-emerald-700" />
              {t("templates.title")}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-slate-500">
              {t("templates.description")}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto p-5">
          {savedTemplates.length > 0 ? (
            <section>
              <h3 className="mb-2 text-xs font-bold text-slate-900">{t("templates.myTemplates")}</h3>
              {editingTemplate && (
                <div className="mb-4 space-y-3 rounded-xl border border-emerald-200/80 bg-white p-4 shadow-xs">
                  <h4 className="text-xs font-semibold text-slate-800">{t("templates.editTemplateTitle")}</h4>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={t("templates.namePlaceholder")} />
                    <Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder={t("templates.noteTitlePlaceholder")} />
                    <Input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder={t("templates.descriptionPlaceholder")} />
                    <Input value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} placeholder={t("templates.tagsPlaceholder")} />
                  </div>
                  <textarea
                    className="min-h-36 w-full resize-y rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-900 outline-none focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                    value={draft.contentMarkdown}
                    onChange={(event) => setDraft((current) => ({ ...current, contentMarkdown: event.target.value }))}
                    placeholder={t("templates.contentPlaceholder")}
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={cancelEditing}><X className="mr-1 h-4 w-4" />{t("common.cancel")}</Button>
                    <Button type="button" size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => void saveEditing()} disabled={!draft.name.trim()}><Check className="mr-1 h-4 w-4" />{t("common.save")}</Button>
                  </div>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {savedTemplates.map((template) => (
                  <div key={template.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs hover:border-emerald-200 transition">
                    <button
                      className="block w-full text-left disabled:opacity-50"
                      type="button"
                      disabled={!canCreateMemo || isCreating}
                      onClick={() => onUseSavedTemplate(template)}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-sm font-bold text-slate-900 truncate">{template.name}</span>
                      </div>
                      <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-slate-500">{template.description || template.title || t("templates.savedDescription")}</span>
                    </button>
                    <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                      <div className="flex gap-2">
                        <button className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 transition" type="button" disabled={isCreating} onClick={() => startEditing(template)}>
                          <Pencil className="h-3 w-3" />{t("templates.edit")}
                        </button>
                        <button className="text-rose-600 hover:text-rose-700 transition" type="button" disabled={isCreating} onClick={() => onDeleteSavedTemplate(template)}>
                          {t("templates.delete")}
                        </button>
                      </div>
                      <button
                        type="button"
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 transition"
                        disabled={!canCreateMemo || isCreating}
                        onClick={() => onUseSavedTemplate(template)}
                      >
                        {t("templates.useThisTemplate")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <p className="text-xs text-slate-500">{t("templates.emptyMyTemplatesHint")}</p>
          )}
          {!canCreateMemo && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900">
              {t("templates.unavailable")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
