import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  Copy,
  Eye,
  LayoutList,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
  Tag,
  ArrowRight,
  FilePlus,
  LibraryBig
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeMarkdownPreview } from "@/lib/safe-markdown-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import { copyTextToClipboard } from "@/lib/clipboard";
import { createTemplateCards, createTemplateDraft, templateDraftToPayload } from "@/lib/template-center";
import { listMemoTemplateGallery, type MemoTemplateGalleryEntry } from "@edgeever/shared/memo-template-gallery";
import { ClipboardCopyNotice } from "@/components/ClipboardCopyNotice";
import type { MemoTemplate as SavedMemoTemplate } from "@edgeever/shared";
import { ExecutionCenterButton } from "@/components/execution/ExecutionCenterButton";

const TemplateIconAction = ({
  children,
  className,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  className: string;
  disabled?: boolean;
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        aria-label={label}
        className={className}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>
);

export const TemplatesPane = ({
  canCreateMemo,
  isCreating,
  onClose,
  onCreateSavedTemplate,
  savedTemplates,
  onUseSavedTemplate,
  onDeleteSavedTemplate,
  onUpdateSavedTemplate,
  onOpenExecutionCenter,
}: {
  canCreateMemo: boolean;
  isCreating: boolean;
  onClose: () => void;
  onCreateSavedTemplate: (payload: { name: string; description: string | null; title: string | null; contentMarkdown: string; tags: string[] }) => Promise<void>;
  savedTemplates: SavedMemoTemplate[];
  onUseSavedTemplate: (template: SavedMemoTemplate) => void;
  onDeleteSavedTemplate: (template: SavedMemoTemplate) => void;
  onUpdateSavedTemplate: (templateId: string, payload: { name: string; description: string | null; title: string | null; contentMarkdown: string; tags: string[] }) => Promise<void>;
  onOpenExecutionCenter: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const [editingTemplate, setEditingTemplate] = useState<SavedMemoTemplate | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", title: "", contentMarkdown: "", tags: "" });
  const [editorTab, setEditorTab] = useState<"raw" | "preview">("raw");

  const [previewTemplate, setPreviewTemplate] = useState<{
    title: string;
    description: string | null;
    noteTitle?: string | null;
    tags: string[];
    contentMarkdown: string;
    actionLabel: string;
    actionDisabled: boolean;
    onUse: () => void;
  } | null>(null);
  const [addingGalleryKey, setAddingGalleryKey] = useState<string | null>(null);

  const [deleteConfirmTemplate, setDeleteConfirmTemplate] = useState<SavedMemoTemplate | null>(null);
  const [templateIdCopyNotice, setTemplateIdCopyNotice] = useState<{
    id: string;
    status: "copied" | "error";
  } | null>(null);

  const copyTemplateId = async (template: SavedMemoTemplate) => {
    const copied = await copyTextToClipboard(template.id);
    setTemplateIdCopyNotice({ id: template.id, status: copied ? "copied" : "error" });
    window.setTimeout(() => setTemplateIdCopyNotice(null), copied ? 2200 : 3000);
  };

  const startEditing = (template: SavedMemoTemplate) => {
    setCreatingTemplate(false);
    setEditingTemplate(template);
    setEditorTab("raw");
    setDraft(createTemplateDraft(template));
  };

  const startCreating = () => {
    setEditingTemplate(null);
    setCreatingTemplate(true);
    setEditorTab("raw");
    setDraft({ name: "", description: "", title: "", contentMarkdown: "", tags: "" });
  };

  const cancelEditing = () => {
    setEditingTemplate(null);
    setCreatingTemplate(false);
  };

  const saveEditing = async () => {
    if (!draft.name.trim()) return;
    const payload = templateDraftToPayload(draft);
    if (creatingTemplate) {
      await onCreateSavedTemplate(payload);
      cancelEditing();
      return;
    }
    if (!editingTemplate) return;
    await onUpdateSavedTemplate(editingTemplate.id, payload);
    cancelEditing();
  };

  const templateCards = useMemo(
    () => createTemplateCards(savedTemplates, i18n.resolvedLanguage),
    [i18n.resolvedLanguage, savedTemplates],
  );

  const galleryEntries = useMemo(
    () => listMemoTemplateGallery(i18n.resolvedLanguage),
    [i18n.resolvedLanguage],
  );

  // Gallery templates are tagged with their key, so a saved template carrying
  // that tag marks the gallery entry as added.
  const addedGalleryTags = useMemo(
    () => new Set(savedTemplates.flatMap((template) => template.tags)),
    [savedTemplates],
  );

  const addGalleryTemplate = async (entry: MemoTemplateGalleryEntry) => {
    if (addingGalleryKey) return;
    setAddingGalleryKey(entry.key);
    try {
      await onCreateSavedTemplate({
        name: entry.name,
        description: entry.description,
        title: entry.title,
        contentMarkdown: entry.contentMarkdown,
        tags: entry.tags,
      });
    } finally {
      setAddingGalleryKey(null);
    }
  };

  const draftHtmlPreview = useMemo(
    () => (draft.contentMarkdown ? safeMarkdownPreview(draft.contentMarkdown) : ""),
    [draft.contentMarkdown]
  );

  const previewHtmlContent = useMemo(
    () => (previewTemplate?.contentMarkdown ? safeMarkdownPreview(previewTemplate.contentMarkdown) : ""),
    [previewTemplate?.contentMarkdown]
  );

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-workspace-canvas">
      {/* Header */}
      <header className="flex h-[calc(3.75rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200/80 bg-card px-6 pb-3 pt-[env(safe-area-inset-top)] lg:h-16 lg:items-center lg:pb-0 lg:pt-0 shadow-2xs">
        <div className="flex min-w-0 items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={t("common.back")} onClick={onClose}>
                <ChevronLeft className="h-5 w-5 text-slate-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("common.back")}</TooltipContent>
          </Tooltip>
          <div className="min-w-0">
            <h1 className={`flex items-center gap-2 text-slate-900 ${WORKSPACE_PAGE_TITLE_CLASSNAME}`}>
              <LayoutList className="h-4 w-4 text-slate-900" />
              {t("templates.title")}
            </h1>
          </div>
        </div>
        <ExecutionCenterButton onClick={onOpenExecutionCenter} />
      </header>

      {/* Main Content Area */}
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-5xl space-y-8">

          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span>{t("templates.myTemplates")}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                    {savedTemplates.length}
                  </span>
                </h2>
              </div>
              {!creatingTemplate && !editingTemplate && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-slate-200 bg-card text-slate-700 hover:bg-slate-50 hover:text-slate-900 text-xs font-semibold shadow-2xs"
                  onClick={startCreating}
                  disabled={isCreating}
                >
                  <Plus className="h-3.5 w-3.5 text-slate-700" />
                  {t("templates.create")}
                </Button>
              )}
            </div>

            {/* Form for Creating / Editing Template */}
            {(editingTemplate || creatingTemplate) && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-card p-5 shadow-xs transition-all">
                <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Pencil className="h-4 w-4 text-slate-900" />
                    {creatingTemplate ? t("templates.createTemplateTitle") : t("templates.editTemplateTitle")}
                  </h3>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-slate-600" onClick={cancelEditing}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">{t("templates.name")}</label>
                      <Input className="focus-visible:border-slate-400 focus-visible:ring-slate-400/25"
                        value={draft.name}
                        onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))}
                        placeholder={t("templates.namePlaceholder")}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">{t("templates.noteTitle")}</label>
                      <Input className="focus-visible:border-slate-400 focus-visible:ring-slate-400/25"
                        value={draft.title}
                        onChange={(e) => setDraft((c) => ({ ...c, title: e.target.value }))}
                        placeholder={t("templates.noteTitlePlaceholder")}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">{t("templates.descriptionField")}</label>
                      <Input className="focus-visible:border-slate-400 focus-visible:ring-slate-400/25"
                        value={draft.description}
                        onChange={(e) => setDraft((c) => ({ ...c, description: e.target.value }))}
                        placeholder={t("templates.descriptionPlaceholder")}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">{t("templates.tags")}</label>
                      <Input className="focus-visible:border-slate-400 focus-visible:ring-slate-400/25"
                        value={draft.tags}
                        onChange={(e) => setDraft((c) => ({ ...c, tags: e.target.value }))}
                        placeholder={t("templates.tagsPlaceholder")}
                      />
                    </div>
                  </div>

                  {/* Content Area with Editor / Preview Toggle */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-700">{t("templates.content")}</label>
                      <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium text-slate-600">
                        <button
                          type="button"
                          className={`rounded-md px-2.5 py-1 transition ${editorTab === "raw" ? "bg-card text-slate-900 shadow-2xs" : "hover:text-slate-900"}`}
                          onClick={() => setEditorTab("raw")}
                        >
                          {t("templates.rawEditor")}
                        </button>
                        <button
                          type="button"
                          className={`rounded-md px-2.5 py-1 transition ${editorTab === "preview" ? "bg-card text-slate-900 shadow-2xs" : "hover:text-slate-900"}`}
                          onClick={() => setEditorTab("preview")}
                        >
                          {t("templates.previewEditor")}
                        </button>
                      </div>
                    </div>

                    {editorTab === "raw" ? (
                      <textarea
                        className="min-h-48 w-full resize-y rounded-lg border border-slate-200 bg-card p-3.5 font-mono text-xs text-slate-900 outline-none focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-400/25"
                        value={draft.contentMarkdown}
                        onChange={(e) => setDraft((c) => ({ ...c, contentMarkdown: e.target.value }))}
                        placeholder={t("templates.contentPlaceholder")}
                      />
                    ) : (
                      <div className="min-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
                        {draftHtmlPreview ? (
                          <div className="prose prose-xs max-w-none" dangerouslySetInnerHTML={{ __html: draftHtmlPreview }} />
                        ) : (
                          <span className="italic text-slate-400">{t("templates.contentPlaceholder")}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" size="sm" variant="outline" onClick={cancelEditing}>
                      <X className="mr-1 h-3.5 w-3.5" />
                      {t("common.cancel")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="solid"
                      className="gap-1.5 font-semibold"
                      onClick={() => void saveEditing()}
                      disabled={!draft.name.trim() || isCreating}
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t("common.save")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Templates Grid */}
            {savedTemplates.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {templateCards.map(({ template: storedTemplate, display: template }) => (
                  <div
                    key={template.id}
                    className="group relative flex cursor-pointer flex-col justify-between rounded-xl border border-slate-200 bg-card p-4 transition-all duration-200 hover:border-slate-300 hover:shadow-md"
                    onClick={() =>
                      setPreviewTemplate({
                        title: template.name,
                        description: template.description,
                        noteTitle: template.title,
                        tags: template.tags,
                        contentMarkdown: template.contentMarkdown,
                        actionLabel: t("templates.useThisTemplate"),
                        actionDisabled: !canCreateMemo || isCreating,
                        onUse: () => onUseSavedTemplate(template),
                      })
                    }
                  >
                    <div>
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-800">
                            <FilePlus className="h-4 w-4" />
                          </span>
                          <h3 className="truncate text-sm font-semibold text-slate-900">{template.name}</h3>
                        </div>
                      </div>

                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 min-h-[2.25rem]">
                        {template.description || template.title || t("templates.savedDescription")}
                      </p>

                      {template.tags.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1">
                          {template.tags.map((tag) => (
                            <span key={tag} className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                              <Tag className="h-2.5 w-2.5 text-slate-400" />
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 border-t border-slate-100 pt-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 text-slate-400">
                        <TemplateIconAction
                          className="p-1 hover:text-slate-700 transition rounded-md hover:bg-slate-100"
                          label={t("templates.copyId")}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyTemplateId(template);
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </TemplateIconAction>
                        <TemplateIconAction
                          className="p-1 hover:text-slate-700 transition rounded-md hover:bg-slate-100"
                          disabled={isCreating}
                          label={t("templates.edit")}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(storedTemplate);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </TemplateIconAction>
                        <TemplateIconAction
                          className="p-1 hover:text-rose-600 transition rounded-md hover:bg-rose-50"
                          disabled={isCreating}
                          label={t("templates.delete")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmTemplate(template);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </TemplateIconAction>
                        <TemplateIconAction
                          className="p-1 hover:text-slate-700 transition rounded-md hover:bg-slate-100"
                          label={t("templates.previewTemplate")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewTemplate({
                              title: template.name,
                              description: template.description,
                              noteTitle: template.title,
                              tags: template.tags,
                              contentMarkdown: template.contentMarkdown,
                              actionLabel: t("templates.useThisTemplate"),
                              actionDisabled: !canCreateMemo || isCreating,
                              onUse: () => onUseSavedTemplate(template),
                            });
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </TemplateIconAction>
                      </div>

                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-card px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs transition-colors hover:bg-slate-50 hover:text-slate-950 disabled:opacity-50"
                        disabled={!canCreateMemo || isCreating}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUseSavedTemplate(template);
                        }}
                      >
                        {t("templates.useThisTemplate")}
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : !creatingTemplate && !editingTemplate ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-card p-7 text-center shadow-2xs">
                <div className="mb-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">{t("templates.emptyMyTemplates")}</h3>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">{t("templates.emptyMyTemplatesHint")}</p>
                <Button type="button" size="sm" variant="outline" className="mt-3.5 gap-1.5 border-slate-200 text-xs font-semibold" onClick={startCreating}>
                  <Plus className="h-3.5 w-3.5 text-slate-700" />
                  {t("templates.create")}
                </Button>
              </div>
            ) : null}
          </section>

          <section>
            <div className="mb-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span>{t("templates.gallery")}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {galleryEntries.length}
                </span>
              </h2>
              <p className="mt-1 text-xs text-slate-500">{t("templates.galleryHint")}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {galleryEntries.map((entry) => {
                const added = addedGalleryTags.has(entry.key);
                const addDisabled = isCreating || addingGalleryKey !== null;
                return (
                  <div
                    key={entry.key}
                    className="group relative flex cursor-pointer flex-col justify-between rounded-xl border border-slate-200 bg-card p-4 transition-all duration-200 hover:border-slate-300 hover:shadow-md"
                    onClick={() =>
                      setPreviewTemplate({
                        title: entry.name,
                        description: entry.description,
                        noteTitle: entry.title,
                        tags: entry.tags,
                        contentMarkdown: entry.contentMarkdown,
                        actionLabel: t("templates.addToMyTemplates"),
                        actionDisabled: addDisabled,
                        onUse: () => void addGalleryTemplate(entry),
                      })
                    }
                  >
                    <div>
                      <div className="mb-2 flex items-center gap-2 min-w-0">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-800">
                          <LibraryBig className="h-4 w-4" />
                        </span>
                        <h3 className="truncate text-sm font-semibold text-slate-900">{entry.name}</h3>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 min-h-[2.25rem]">
                        {entry.description}
                      </p>
                    </div>

                    <div className="mt-4 border-t border-slate-100 pt-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 text-slate-400">
                        <TemplateIconAction
                          className="p-1 hover:text-slate-700 transition rounded-md hover:bg-slate-100"
                          label={t("templates.previewTemplate")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewTemplate({
                              title: entry.name,
                              description: entry.description,
                              noteTitle: entry.title,
                              tags: entry.tags,
                              contentMarkdown: entry.contentMarkdown,
                              actionLabel: t("templates.addToMyTemplates"),
                              actionDisabled: addDisabled,
                              onUse: () => void addGalleryTemplate(entry),
                            });
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </TemplateIconAction>
                        {added && (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-slate-500">
                            <Check className="h-3.5 w-3.5" />
                            {t("templates.addedToMyTemplates")}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-card px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs transition-colors hover:bg-slate-50 hover:text-slate-950 disabled:opacity-50"
                        disabled={addDisabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          void addGalleryTemplate(entry);
                        }}
                      >
                        <Plus className="h-3 w-3" />
                        {t("templates.addToMyTemplates")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {!canCreateMemo && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs font-medium text-amber-900">
              {t("templates.unavailable")}
            </div>
          )}
        </div>
      </main>

      {/* Preview Dialog */}
      {previewTemplate && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setPreviewTemplate(null); }}>
          <DialogContent className="max-w-xl bg-card p-0 overflow-hidden border border-slate-200 rounded-xl shadow-xl">
            <DialogHeader className="border-b border-slate-100 px-6 py-4 text-left bg-slate-50/50">
              <DialogTitle className="font-bold text-slate-900">{previewTemplate.title}</DialogTitle>
              {previewTemplate.description && (
                <DialogDescription className="mt-1 text-xs text-slate-500 leading-relaxed">
                  {previewTemplate.description}
                </DialogDescription>
              )}
            </DialogHeader>

            <div className="max-h-[60vh] overflow-y-auto p-6 space-y-4">
              {previewTemplate.noteTitle && (
                <div className="rounded-lg bg-slate-100/70 p-2.5 text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">{t("templates.noteTitle")}: </span>
                  {previewTemplate.noteTitle}
                </div>
              )}

              <div>
                <h4 className="mb-2 text-xs font-semibold text-slate-500">{t("templates.previewTitle")}</h4>
                <div className="rounded-xl border border-slate-200 bg-card p-4 text-xs text-slate-800 shadow-2xs min-h-[120px]">
                  <div className="prose prose-xs max-w-none" dangerouslySetInnerHTML={{ __html: previewHtmlContent }} />
                </div>
              </div>
            </div>

            <DialogFooter className="border-t border-slate-100 px-6 py-3.5 bg-slate-50/50 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPreviewTemplate(null)}>
                {t("common.close")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="solid"
                className="gap-1.5 font-semibold"
                disabled={previewTemplate.actionDisabled}
                onClick={() => {
                  const onUse = previewTemplate.onUse;
                  setPreviewTemplate(null);
                  onUse();
                }}
              >
                {previewTemplate.actionLabel}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmTemplate && (
        <Dialog open={true} onOpenChange={(open) => { if (!open) setDeleteConfirmTemplate(null); }}>
          <DialogContent className="max-w-md bg-card p-6 border border-slate-200 rounded-xl shadow-xl">
            <DialogHeader className="text-left">
              <DialogTitle className="font-bold text-slate-900">
                {t("templates.deleteConfirmTitle", { name: deleteConfirmTemplate.name })}
              </DialogTitle>
              <DialogDescription className="mt-2 text-xs text-slate-500 leading-relaxed">
                {t("templates.deleteConfirmDescription")}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDeleteConfirmTemplate(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => {
                  const target = deleteConfirmTemplate;
                  setDeleteConfirmTemplate(null);
                  onDeleteSavedTemplate(target);
                }}
              >
                {t("common.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {templateIdCopyNotice && (
        <ClipboardCopyNotice status={templateIdCopyNotice.status}>
          {t(
            templateIdCopyNotice.status === "copied" ? "templates.idCopied" : "templates.idCopyFailed",
            { id: templateIdCopyNotice.id },
          )}
        </ClipboardCopyNotice>
      )}
      </div>
    </TooltipProvider>
  );
};
