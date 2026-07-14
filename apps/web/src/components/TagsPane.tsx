import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Pencil, Tags, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import { WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import type { TagSummary } from "@edgeever/shared";
import { AppConfirmDialog } from "./dialogs/ConfirmDialogs";

export const TagsPane = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editingTagName, setEditingTagName] = useState<string | null>(null);
  const [editingTagValue, setEditingTagValue] = useState("");
  const [tagDeleteConfirmation, setTagDeleteConfirmation] = useState<TagSummary | null>(null);
  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: () => api.listTags() });
  const tags = tagsQuery.data?.tags ?? [];
  const invalidateTagData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tags"] }),
      queryClient.invalidateQueries({ queryKey: ["memos"] }),
      queryClient.invalidateQueries({ queryKey: ["memo"] }),
    ]);
  };
  const renameMutation = useMutation({
    mutationFn: ({ tag, name }: { tag: string; name: string }) => api.renameTag(tag, name),
    onSuccess: async () => {
      setEditingTagName(null);
      setEditingTagValue("");
      await invalidateTagData();
    },
  });
  const deleteMutation = useMutation({ mutationFn: api.deleteTag, onSuccess: invalidateTagData });
  const cancelRename = () => {
    setEditingTagName(null);
    setEditingTagValue("");
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-white">
      <header className="flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-end border-b border-slate-200 px-6 pb-3 pt-[env(safe-area-inset-top)] lg:h-16 lg:items-center lg:pb-0 lg:pt-0">
        <div className="flex min-w-0 items-center gap-3">
          <Button size="icon" variant="ghost" title={t("common.back")} aria-label={t("common.back")} onClick={onClose} className="h-9 w-9 rounded-lg hover:bg-slate-100">
            <ChevronLeft className="h-5 w-5 text-slate-500" />
          </Button>
          <div className="min-w-0">
            <h1 className={`flex items-center gap-2 ${WORKSPACE_PAGE_TITLE_CLASSNAME}`}><Tags className="h-4 w-4 text-emerald-700" />{t("tagsDialog.title")}</h1>
            <p className="mt-0.5 text-xs text-slate-500">{t("tagsDialog.count", { count: tags.length })}</p>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6 lg:py-6">
        <div className="mx-auto w-full max-w-3xl">
          {tagsQuery.isLoading ? (
            <div className="px-2 py-8 text-center text-sm text-slate-500">{t("tagsDialog.loading")}</div>
          ) : tags.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{t("tagsDialog.empty")}</div>
          ) : (
            <div className="space-y-2">
              {tags.map((tag) => {
                const isEditing = editingTagName === tag.name;
                const nextName = editingTagValue.trim();
                return (
                  <div key={tag.name} className={cn("flex min-h-12 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2", isEditing && "border-emerald-200 bg-emerald-50/30")}>
                    <span className="min-w-0 flex-1">
                      {isEditing ? (
                        <form className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(event) => { event.preventDefault(); if (nextName && nextName !== tag.name && !renameMutation.isPending) renameMutation.mutate({ tag: tag.name, name: nextName }); }}>
                          <label className="sr-only" htmlFor={`tag-rename-${tag.name}`}>{t("tagsDialog.nameLabel")}</label>
                          <Input id={`tag-rename-${tag.name}`} className="h-9 min-w-0 flex-1 focus-visible:border-emerald-300 focus-visible:ring-emerald-500/20" value={editingTagValue} autoFocus disabled={renameMutation.isPending} maxLength={80} onChange={(event) => setEditingTagValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelRename(); } }} />
                          <div className="flex shrink-0 gap-2">
                            <Button className="justify-center" size="sm" type="submit" variant="solid" disabled={!nextName || nextName === tag.name || renameMutation.isPending}>{t("common.save")}</Button>
                            <Button size="sm" type="button" variant="outline" onClick={cancelRename} disabled={renameMutation.isPending}>{t("common.cancel")}</Button>
                          </div>
                        </form>
                      ) : (
                        <><span className="block truncate text-sm font-semibold text-slate-950">#{tag.name}</span><span className="mt-1 block text-xs text-slate-500">{t("tagsDialog.memoCount", { count: tag.memoCount })}{tag.updatedAt ? ` · ${formatDateTime(tag.updatedAt)}` : ""}</span></>
                      )}
                    </span>
                    {!isEditing && <><Button size="icon" variant="ghost" title={t("tagsDialog.renameTitle")} aria-label={t("tagsDialog.renameAria", { name: tag.name })} onClick={() => { setEditingTagName(tag.name); setEditingTagValue(tag.name); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="danger" title={t("tagsDialog.deleteTitle")} aria-label={t("tagsDialog.deleteAria", { name: tag.name })} onClick={() => setTagDeleteConfirmation(tag)}><Trash2 className="h-4 w-4" /></Button></>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {tagDeleteConfirmation && <AppConfirmDialog title={t("tagsDialog.deleteConfirmTitle", { name: tagDeleteConfirmation.name })} description={t("tagsDialog.deleteConfirmDescription", { count: tagDeleteConfirmation.memoCount })} confirmLabel={t("tagsDialog.deleteConfirmLabel")} isWorking={deleteMutation.isPending} tone="danger" onCancel={() => setTagDeleteConfirmation(null)} onConfirm={() => deleteMutation.mutate(tagDeleteConfirmation.name, { onSuccess: () => setTagDeleteConfirmation(null) })} />}
    </div>
  );
};
