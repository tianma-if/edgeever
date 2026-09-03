import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AiPromptParameterKind,
  AiPromptResultMode,
  AiPromptTemplate,
  AiPromptTemplateUpdateInput,
} from "@edgeever/shared";
import {
  ChevronLeft,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppConfirmDialog } from "@/components/dialogs/ConfirmDialogs";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiRequestError } from "@/lib/api";
import { WORKSPACE_PAGE_TITLE_CLASSNAME } from "@/lib/workspace-ui";
import { formatDateTime } from "@/lib/utils";
import { ExecutionCenterButton } from "@/components/execution/ExecutionCenterButton";

const emptyForm = () => ({
  name: "",
  description: "",
  instruction: "",
  parameterKind: "none" as AiPromptParameterKind,
  resultMode: "both" as AiPromptResultMode,
});

export const AiPromptsPane = ({ onClose, onOpenExecutionCenter }: { onClose: () => void; onOpenExecutionCenter: () => void }) => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AiPromptTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<AiPromptTemplate | null>(null);
  const [preview, setPreview] = useState<AiPromptTemplate | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoreFeedback, setRestoreFeedback] = useState<string | null>(null);

  const promptsQuery = useQuery({
    queryKey: ["ai-prompts", i18n.resolvedLanguage],
    queryFn: async () => (await api.listAiPrompts(i18n.resolvedLanguage)).prompts,
  });
  const prompts = promptsQuery.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ai-prompts"] });

  const startCreating = () => {
    setEditing(null);
    setCreating(true);
    setForm(emptyForm());
  };

  const startEditing = (prompt: AiPromptTemplate) => {
    setCreating(false);
    setEditing(prompt);
    setForm({
      name: prompt.name,
      description: prompt.description ?? "",
      instruction: prompt.instruction,
      parameterKind: prompt.parameterKind,
      resultMode: prompt.resultMode,
    });
  };

  const cancelEditor = () => {
    setCreating(false);
    setEditing(null);
    setForm(emptyForm());
    saveMutation.reset();
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      const instruction = form.instruction.trim();
      const description = form.description.trim();
      if (editing) {
        const payload: AiPromptTemplateUpdateInput = {};
        if (name !== editing.name) payload.name = name;
        if ((description || null) !== editing.description) payload.description = description || null;
        if (instruction !== editing.instruction) payload.instruction = instruction;
        if (form.parameterKind !== editing.parameterKind) payload.parameterKind = form.parameterKind;
        if (form.resultMode !== editing.resultMode) payload.resultMode = form.resultMode;
        return api.updateAiPrompt(editing.id, payload);
      }
      return api.createAiPrompt({
        name,
        description: description || undefined,
        instruction,
        parameterKind: form.parameterKind,
        resultMode: form.resultMode,
      });
    },
    onSuccess: async () => {
      cancelEditor();
      await refresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (promptId: string) => api.deleteAiPrompt(promptId),
    onSuccess: async () => {
      setDeleteTarget(null);
      await refresh();
    },
    onError: () => setDeleteTarget(null),
  });

  const restoreMutation = useMutation({
    mutationFn: () => api.restoreDefaultAiPrompts(i18n.resolvedLanguage),
    onSuccess: async (result) => {
      setRestoreConfirmOpen(false);
      setRestoreFeedback(
        result.restoredCount > 0
          ? t("aiPrompts.restoreDefaultsDone", { count: result.restoredCount })
          : t("aiPrompts.restoreDefaultsNone"),
      );
      queryClient.setQueryData(["ai-prompts", i18n.resolvedLanguage], result.prompts);
      await refresh();
    },
    onError: () => setRestoreConfirmOpen(false),
  });

  const errorMessage = (error: unknown) => {
    if (error instanceof ApiRequestError) {
      if (error.code === "forbidden" || /demo/i.test(error.message)) return t("aiPrompts.demoDisabled");
      return error.message;
    }
    return error instanceof Error ? error.message : t("aiPrompts.failed");
  };

  const saveError = saveMutation.error ? errorMessage(saveMutation.error) : null;
  const listError = promptsQuery.error ? errorMessage(promptsQuery.error) : null;
  const deleteError = deleteMutation.error ? errorMessage(deleteMutation.error) : null;
  const restoreError = restoreMutation.error ? errorMessage(restoreMutation.error) : null;
  const canSubmit = form.name.trim().length > 0 && form.instruction.trim().length > 0;
  const hasChanges = !editing
    || form.name.trim() !== editing.name
    || (form.description.trim() || null) !== editing.description
    || form.instruction.trim() !== editing.instruction
    || form.parameterKind !== editing.parameterKind
    || form.resultMode !== editing.resultMode;
  const editorOpen = creating || Boolean(editing);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-slate-50/60">
      <header className="flex h-[calc(3.75rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200/80 bg-white px-6 pb-3 pt-[env(safe-area-inset-top)] shadow-2xs lg:h-16 lg:items-center lg:pb-0 lg:pt-0">
        <div className="flex min-w-0 items-center gap-3">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={t("common.back")} onClick={onClose}>
                  <ChevronLeft className="h-5 w-5 text-slate-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("common.back")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="min-w-0">
            <h1 className={`flex items-center gap-2 text-slate-900 ${WORKSPACE_PAGE_TITLE_CLASSNAME}`}>
              <Sparkles className="h-4.5 w-4.5 text-emerald-600" />
              {t("aiPrompts.title")}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">{t("aiPrompts.description")}</p>
          </div>
        </div>
        <ExecutionCenterButton onClick={onOpenExecutionCenter} />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-5xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <span>{t("aiPrompts.listTitle")}</span>
                <span className="rounded-full bg-emerald-100/70 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                  {prompts.length}
                </span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">{t("aiPrompts.listSubtitle")}</p>
            </div>
            {!editorOpen ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-slate-200 bg-white text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900"
                  onClick={() => {
                    setRestoreFeedback(null);
                    setRestoreConfirmOpen(true);
                  }}
                  disabled={restoreMutation.isPending}
                >
                  <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
                  {t("aiPrompts.restoreDefaults")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-slate-200 bg-white text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900"
                  onClick={startCreating}
                >
                  <Plus className="h-3.5 w-3.5 text-emerald-600" />
                  {t("aiPrompts.add")}
                </Button>
              </div>
            ) : null}
          </div>
          {restoreFeedback ? (
            <p className="text-xs font-medium text-emerald-700" role="status">{restoreFeedback}</p>
          ) : null}
          {restoreError ? <p className="text-xs font-medium text-rose-600" role="alert">{restoreError}</p> : null}
          <p className="text-xs text-slate-400">{t("aiPrompts.restoreDefaultsHint")}</p>

          {editorOpen ? (
            <form
              className="rounded-xl border border-emerald-200 bg-white p-5 shadow-xs"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (canSubmit && hasChanges) saveMutation.mutate();
              }}
            >
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Pencil className="h-4 w-4 text-emerald-600" />
                  {editing ? t("aiPrompts.edit") : t("aiPrompts.add")}
                </h3>
                <Button aria-label={t("common.close")} size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-slate-600" type="button" onClick={cancelEditor}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-4">
                <label className="grid gap-1.5 text-xs font-medium text-slate-700">
                  {t("aiPrompts.name")}
                  <Input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder={t("aiPrompts.namePlaceholder")}
                    maxLength={80}
                    required
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-medium text-slate-700">
                    {t("aiPrompts.parameterKind")}
                    <Select
                      value={form.parameterKind}
                      onValueChange={(value) => setForm((current) => ({
                        ...current,
                        parameterKind: value as AiPromptParameterKind,
                      }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("aiPrompts.parameterKinds.none")}</SelectItem>
                        <SelectItem value="target-language">{t("aiPrompts.parameterKinds.target-language")}</SelectItem>
                        <SelectItem value="tone">{t("aiPrompts.parameterKinds.tone")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-1.5 text-xs font-medium text-slate-700">
                    {t("aiPrompts.resultMode")}
                    <Select
                      value={form.resultMode}
                      onValueChange={(value) => setForm((current) => ({
                        ...current,
                        resultMode: value as AiPromptResultMode,
                      }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both">{t("aiPrompts.resultModes.both")}</SelectItem>
                        <SelectItem value="append">{t("aiPrompts.resultModes.append")}</SelectItem>
                        <SelectItem value="replace">{t("aiPrompts.resultModes.replace")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                <label className="grid gap-1.5 text-xs font-medium text-slate-700">
                  {t("aiPrompts.descriptionLabel")}
                  <Input
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder={t("aiPrompts.descriptionPlaceholder")}
                    maxLength={200}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-slate-700">
                  {t("aiPrompts.instruction")}
                  <textarea
                    className="min-h-36 w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                    value={form.instruction}
                    onChange={(event) => setForm((current) => ({ ...current, instruction: event.target.value }))}
                    placeholder={t("aiPrompts.instructionPlaceholder")}
                    maxLength={2_000}
                    required
                  />
                </label>
                {saveError ? <p className="text-xs font-medium text-rose-600" role="alert">{saveError}</p> : null}
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={cancelEditor}>
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit" size="sm" variant="solid" disabled={!canSubmit || !hasChanges || saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {editing ? t("aiPrompts.save") : t("aiPrompts.create")}
                  </Button>
                </div>
              </div>
            </form>
          ) : null}

          {promptsQuery.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </p>
          ) : prompts.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {prompts.map((prompt) => (
                <article
                  key={prompt.id}
                  className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-900">{prompt.name}</h3>
                      {prompt.origin === "default" ? (
                        <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          {t("aiPrompts.defaultBadge")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">
                      {prompt.description || prompt.instruction}
                    </p>
                    <p className="mt-2 text-[11px] text-slate-400">{formatDateTime(prompt.updatedAt)}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 bg-white text-xs"
                      onClick={() => setPreview(prompt)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {t("aiPrompts.preview")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 bg-white text-xs"
                      onClick={() => startEditing(prompt)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t("aiPrompts.edit")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1 text-xs text-rose-600 hover:text-rose-700"
                      onClick={() => {
                        deleteMutation.reset();
                        setDeleteTarget(prompt);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t("aiPrompts.delete")}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
              <p className="text-sm font-medium text-slate-700">{t("aiPrompts.empty")}</p>
              <p className="mt-1 text-xs text-slate-400">{t("aiPrompts.emptyHint")}</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    setRestoreFeedback(null);
                    setRestoreConfirmOpen(true);
                  }}
                  disabled={restoreMutation.isPending}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("aiPrompts.restoreDefaults")}
                </Button>
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={startCreating}>
                  <Plus className="h-3.5 w-3.5 text-emerald-600" />
                  {t("aiPrompts.add")}
                </Button>
              </div>
            </div>
          )}
          {listError ? <p className="text-xs font-medium text-rose-600" role="alert">{listError}</p> : null}
          {deleteError ? <p className="text-xs font-medium text-rose-600" role="alert">{deleteError}</p> : null}
        </div>
      </main>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
            <DialogDescription>{preview?.description || t("aiPrompts.instruction")}</DialogDescription>
          </DialogHeader>
          {preview?.instruction ? (
            <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-800">
              {preview.instruction}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {preview ? (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    startEditing(preview);
                    setPreview(null);
                  }}>
                    <Pencil className="h-3.5 w-3.5" />
                    {t("aiPrompts.edit")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="text-rose-600" onClick={() => {
                    deleteMutation.reset();
                    setDeleteTarget(preview);
                    setPreview(null);
                  }}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("aiPrompts.delete")}
                  </Button>
                </>
              ) : null}
            </div>
            <Button type="button" variant="outline" onClick={() => setPreview(null)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteTarget ? (
        <AppConfirmDialog
          title={t("aiPrompts.delete")}
          description={t("aiPrompts.deleteConfirm", { name: deleteTarget.name })}
          confirmLabel={t("aiPrompts.delete")}
          isWorking={deleteMutation.isPending}
          tone="danger"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        />
      ) : null}

      {restoreConfirmOpen ? (
        <AppConfirmDialog
          title={t("aiPrompts.restoreDefaultsConfirmTitle")}
          description={t("aiPrompts.restoreDefaultsConfirmDescription")}
          confirmLabel={t("aiPrompts.restoreDefaultsConfirm")}
          isWorking={restoreMutation.isPending}
          tone="primary"
          onCancel={() => setRestoreConfirmOpen(false)}
          onConfirm={() => restoreMutation.mutate()}
        />
      ) : null}
    </div>
  );
};
