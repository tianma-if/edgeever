import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, Copy, Library, Loader2, PenLine, RefreshCw, Sparkles, Square, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiRequestError } from "@/lib/api";
import {
  aiTones,
  buildAiAssistantRequest,
  getDefaultAiAction,
  getDefaultTargetLanguage,
  promptAllowsAppend,
  promptAllowsReplace,
  promptNeedsTargetLanguage,
  promptNeedsTone,
  targetLanguages,
  type AiAssistantAction,
  type AiTone,
  type TargetLanguage,
} from "@/lib/ai-assistant";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

const FREEFORM_VALUE = "custom";
const PROMPT_VALUE_PREFIX = "prompt:";

const promptSelectValue = (id: string) => `${PROMPT_VALUE_PREFIX}${id}`;

const parsePromptSelectValue = (value: string) =>
  value.startsWith(PROMPT_VALUE_PREFIX) ? value.slice(PROMPT_VALUE_PREFIX.length) : null;

export const AiAssistantDialog = ({
  open,
  title,
  contentMarkdown,
  selectionMarkdown,
  onOpenChange,
  onApply,
  onOpenPromptLibrary,
}: {
  open: boolean;
  title: string;
  contentMarkdown: string;
  selectionMarkdown?: string | null;
  onOpenChange: (open: boolean) => void;
  onApply: (text: string, mode: "append" | "replace") => void;
  onOpenPromptLibrary?: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const hasSelection = Boolean(selectionMarkdown?.trim());
  const sourceMarkdown = hasSelection ? selectionMarkdown!.trim() : contentMarkdown;
  const defaultTargetLanguage = getDefaultTargetLanguage(i18n.resolvedLanguage);
  const defaultAction = getDefaultAiAction(hasSelection);
  const [action, setAction] = useState<AiAssistantAction>(defaultAction);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>(() => defaultTargetLanguage);
  const [tone, setTone] = useState<AiTone>("professional");
  const [customInstruction, setCustomInstruction] = useState("");
  const [refinement, setRefinement] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [promptFeedback, setPromptFeedback] = useState<string | null>(null);
  const [initializedForOpen, setInitializedForOpen] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<Parameters<typeof api.streamAiGeneration>[0] | null>(null);

  const promptsQuery = useQuery({
    queryKey: ["ai-prompts", i18n.resolvedLanguage],
    queryFn: async () => (await api.listAiPrompts(i18n.resolvedLanguage)).prompts,
    enabled: open,
    retry: false,
  });
  const prompts = promptsQuery.data ?? [];
  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptId) ?? null,
    [prompts, selectedPromptId],
  );
  const effectiveActionKey = selectedPrompt?.action ?? action;
  const effectiveParameterKind = selectedPrompt?.parameterKind ?? "none";
  const effectiveResultMode = selectedPrompt?.resultMode ?? "both";

  const selectValue = selectedPromptId
    ? promptSelectValue(selectedPromptId)
    : FREEFORM_VALUE;

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    controllerRef.current?.abort();
    if (!open) {
      setInitializedForOpen(false);
      return;
    }
    setAction(defaultAction);
    setSelectedPromptId(null);
    setTargetLanguage(defaultTargetLanguage);
    setTone("professional");
    setCustomInstruction("");
    setRefinement("");
    setOutput("");
    setError(null);
    setCopied(false);
    setIsGenerating(false);
    setSaveDialogOpen(false);
    setSaveName("");
    setSaveDescription("");
    setPromptFeedback(null);
    setInitializedForOpen(false);
    lastRequestRef.current = null;
  }, [defaultAction, defaultTargetLanguage, hasSelection, open]);

  // Once prompts load, pick the library entry that matches the default action (same text as the library).
  useEffect(() => {
    if (!open || initializedForOpen || promptsQuery.isLoading) return;
    const preferred = prompts.find((prompt) => prompt.seedKey === defaultAction)
      ?? prompts[0]
      ?? null;
    if (preferred) {
      setSelectedPromptId(preferred.id);
      setAction(preferred.action);
      setCustomInstruction(preferred.instruction);
    } else {
      setAction("custom");
      setSelectedPromptId(null);
      setCustomInstruction("");
    }
    setInitializedForOpen(true);
  }, [defaultAction, initializedForOpen, open, prompts, promptsQuery.isLoading]);

  useEffect(() => {
    if (!open || !initializedForOpen || promptsQuery.isLoading || !selectedPromptId || selectedPrompt) return;
    setSelectedPromptId(null);
    setAction("custom");
    setCustomInstruction("");
    setOutput("");
    setError(t("aiAssistant.promptMissing"));
  }, [initializedForOpen, open, promptsQuery.isLoading, selectedPrompt, selectedPromptId, t]);

  const clearResult = () => {
    setOutput("");
    setError(null);
    setPromptFeedback(null);
  };

  const handleActionChange = (value: string) => {
    if (value === FREEFORM_VALUE) {
      setAction("custom");
      setSelectedPromptId(null);
      setCustomInstruction("");
      clearResult();
      return;
    }

    const promptId = parsePromptSelectValue(value);
    if (!promptId) return;
    const prompt = prompts.find((item) => item.id === promptId);
    setSelectedPromptId(promptId);
    setAction(prompt?.action ?? "custom");
    setCustomInstruction(prompt?.instruction ?? "");
    clearResult();
  };

  const runGeneration = async (request: Parameters<typeof api.streamAiGeneration>[0]) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    lastRequestRef.current = request;
    setOutput("");
    setError(null);
    setCopied(false);
    setIsGenerating(true);
    try {
      await api.streamAiGeneration(
        request,
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "text-delta") setOutput((current) => current + event.text);
            if (event.type === "error") setError(event.message);
          },
        },
      );
    } catch (caught) {
      if (controller.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError")) return;
      setError(caught instanceof ApiRequestError && caught.code === "ai_not_configured"
        ? t("aiAssistant.configure")
        : caught instanceof Error ? caught.message : t("aiModel.failed"));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setIsGenerating(false);
      }
    }
  };

  const generate = () => runGeneration(buildAiAssistantRequest({
    action: effectiveActionKey,
    contentMarkdown: sourceMarkdown,
    customInstruction,
    locale: i18n.resolvedLanguage,
    parameterKind: selectedPrompt ? effectiveParameterKind : undefined,
    promptId: selectedPrompt?.id,
    targetLanguage,
    title,
    tone,
  }));

  const refine = () => {
    const instruction = refinement.trim();
    if (!output || !instruction) return;
    setRefinement("");
    return runGeneration({
      action: "custom",
      title,
      contentMarkdown: output,
      instruction,
    });
  };

  const retry = () => {
    if (lastRequestRef.current) return runGeneration(lastRequestRef.current);
    return generate();
  };

  const copy = async () => {
    if (await copyTextToClipboard(output)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  const createPromptMutation = useMutation({
    mutationFn: () => api.createAiPrompt({
      name: saveName.trim(),
      description: saveDescription.trim() || undefined,
      instruction: customInstruction.trim(),
      parameterKind: "none",
      resultMode: "both",
    }),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ["ai-prompts"] });
      setSelectedPromptId(response.prompt.id);
      setAction(response.prompt.action);
      setCustomInstruction(response.prompt.instruction);
      setSaveDialogOpen(false);
      setSaveName("");
      setSaveDescription("");
      setPromptFeedback(t("aiAssistant.promptSaved"));
    },
  });

  const promptErrorMessage = createPromptMutation.error
    ? createPromptMutation.error instanceof Error
      ? createPromptMutation.error.message
      : t("aiAssistant.promptSaveFailed")
    : null;

  // Only freeform "自定义指令" shows the instruction editor. Library presets stay one-click.
  const isFreeformCustom = !selectedPromptId && action === "custom";
  const showInstructionEditor = isFreeformCustom;
  const canSaveAsPrompt = isFreeformCustom && customInstruction.trim().length > 0;
  const generateDisabled = isGenerating
    || (isFreeformCustom && !customInstruction.trim())
    || (!isFreeformCustom && !selectedPromptId)
    || (promptNeedsTargetLanguage(effectiveParameterKind) && !targetLanguage)
    || (promptNeedsTone(effectiveParameterKind) && !tone);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-emerald-600" />{t("aiAssistant.title")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                  {t(hasSelection ? "aiAssistant.selectedScope" : "aiAssistant.noteScope")}
                </span>
                {hasSelection ? null : t("aiAssistant.noteScopeHint")}
              </div>
              {hasSelection ? (
                <p className="mt-2 max-h-16 overflow-hidden whitespace-pre-wrap border-l-2 border-emerald-200 pl-3 text-xs leading-5 text-slate-500">
                  {selectionMarkdown}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">{t("aiAssistant.actionLabel")}</span>
                {onOpenPromptLibrary ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenPromptLibrary();
                    }}
                  >
                    <Library className="h-3.5 w-3.5" />
                    {t("aiAssistant.managePrompts")}
                  </button>
                ) : null}
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
                <Select value={selectValue} onValueChange={handleActionChange}>
                  <SelectTrigger aria-label={t("aiAssistant.actionLabel")} className="h-10 w-full min-w-0 sm:col-span-2">
                    <SelectValue placeholder={t("aiAssistant.actionLabel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {prompts.length ? (
                      <SelectGroup>
                        <SelectLabel>{t("aiAssistant.myPrompts")}</SelectLabel>
                        {prompts.map((prompt) => (
                          <SelectItem key={prompt.id} value={promptSelectValue(prompt.id)}>
                            {prompt.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                    <SelectGroup>
                      <SelectItem value={FREEFORM_VALUE}>{t("aiAssistant.actions.custom")}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={!selectedPromptId && action === "custom" ? "solid" : "outline"}
                    className="h-10 min-w-0 w-full gap-1 px-2 text-xs font-normal text-slate-600"
                    onClick={() => handleActionChange(FREEFORM_VALUE)}
                  >
                    <PenLine className="h-3.5 w-3.5" />
                    {t("aiAssistant.useCustom")}
                  </Button>
                  {isGenerating ? (
                    <Button type="button" variant="solid" className="h-10 min-w-0 w-full gap-1.5 px-2 text-sm font-semibold" onClick={() => controllerRef.current?.abort()}>
                      <Square className="h-3.5 w-3.5" />{t("aiAssistant.stop")}
                    </Button>
                  ) : (
                    <Button type="button" variant="solid" className="h-10 min-w-0 w-full gap-1.5 px-2 text-sm font-semibold" disabled={generateDisabled} onClick={() => void generate()}>
                      <Sparkles className="h-4 w-4" />{t("aiAssistant.generate")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {promptNeedsTargetLanguage(effectiveParameterKind) ? (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium text-slate-700">{t("aiAssistant.targetLanguage")}</span>
                <Select value={targetLanguage} onValueChange={(value) => {
                  setTargetLanguage(value as TargetLanguage);
                  clearResult();
                }}>
                  <SelectTrigger aria-label={t("aiAssistant.targetLanguage")} className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {targetLanguages.map((language) => (
                      <SelectItem key={language} value={language}>{t(`aiAssistant.targetLanguages.${language}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {promptNeedsTone(effectiveParameterKind) ? (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium text-slate-700">{t("aiAssistant.tone")}</span>
                <Select value={tone} onValueChange={(value) => {
                  setTone(value as AiTone);
                  clearResult();
                }}>
                  <SelectTrigger aria-label={t("aiAssistant.tone")} className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {aiTones.map((item) => <SelectItem key={item} value={item}>{t(`aiAssistant.tones.${item}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {showInstructionEditor ? (
              <div className="grid gap-2">
                <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                  {t("aiAssistant.customInstruction")}
                  <textarea
                    className="min-h-28 resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15"
                    value={customInstruction}
                    onChange={(event) => {
                      setCustomInstruction(event.target.value);
                      clearResult();
                    }}
                    placeholder={t("aiAssistant.customInstructionPlaceholder")}
                    maxLength={2_000}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {canSaveAsPrompt ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSaveName("");
                        setSaveDescription("");
                        setSaveDialogOpen(true);
                        createPromptMutation.reset();
                      }}
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" />
                      {t("aiAssistant.saveAsPrompt")}
                    </Button>
                  ) : null}
                </div>
                {promptFeedback ? <p className="text-xs font-medium text-emerald-700">{promptFeedback}</p> : null}
                {promptErrorMessage ? <p className="text-xs font-medium text-rose-600" role="alert">{promptErrorMessage}</p> : null}
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">{t("aiAssistant.result")}</span>
                {isGenerating ? (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />{t("aiAssistant.generating")}
                  </span>
                ) : null}
              </div>
              <div
                className={cn("min-h-48 whitespace-pre-wrap rounded-lg border bg-slate-50 p-4 text-sm leading-6 text-slate-800", error ? "border-rose-200" : "border-slate-200")}
                aria-busy={isGenerating}
                aria-live="polite"
              >
                {output || <span className="text-slate-400">{t("aiAssistant.resultPlaceholder")}</span>}
              </div>
              {error ? <p className="text-xs font-medium text-rose-600" role="alert">{error}</p> : null}
            </div>
            {output && !isGenerating ? (
              <div className="grid gap-1.5 rounded-lg border border-slate-200 bg-white p-3">
                <span className="text-sm font-medium text-slate-700">{t("aiAssistant.refine")}</span>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15"
                    value={refinement}
                    onChange={(event) => setRefinement(event.target.value)}
                    aria-label={t("aiAssistant.refine")}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing && refinement.trim()) {
                        event.preventDefault();
                        void refine();
                      }
                    }}
                    placeholder={t("aiAssistant.refinePlaceholder")}
                    maxLength={2_000}
                  />
                  <Button type="button" variant="outline" disabled={!refinement.trim()} onClick={() => void refine()}>{t("aiAssistant.refineAction")}</Button>
                </div>
              </div>
            ) : null}
          </div>
          {output ? (
            <DialogFooter className="flex-wrap sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={isGenerating} onClick={() => void copy()}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{t(copied ? "aiAssistant.copied" : "aiAssistant.copy")}</Button>
                <Button type="button" variant="outline" disabled={isGenerating} onClick={() => { setOutput(""); setError(null); }}><Trash2 className="h-4 w-4" />{t("aiAssistant.discard")}</Button>
                <Button type="button" variant="outline" disabled={isGenerating} onClick={() => void retry()}><RefreshCw className="h-4 w-4" />{t("aiAssistant.retry")}</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {promptAllowsReplace(effectiveResultMode) ? (
                  <Button type="button" variant={hasSelection ? "solid" : "outline"} disabled={isGenerating} onClick={() => onApply(output, "replace")}>
                    {t(hasSelection ? "aiAssistant.replaceSelection" : "aiAssistant.replace")}
                  </Button>
                ) : null}
                {promptAllowsAppend(effectiveResultMode) ? (
                  <Button type="button" variant={hasSelection && promptAllowsReplace(effectiveResultMode) ? "outline" : "solid"} disabled={isGenerating} onClick={() => onApply(output, "append")}>{t("aiAssistant.append")}</Button>
                ) : null}
              </div>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={saveDialogOpen} onOpenChange={(nextOpen) => {
        setSaveDialogOpen(nextOpen);
        if (!nextOpen) {
          setSaveName("");
          setSaveDescription("");
          createPromptMutation.reset();
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!saveName.trim() || !customInstruction.trim()) return;
              createPromptMutation.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("aiAssistant.saveAsPromptTitle")}</DialogTitle>
              <DialogDescription>{t("aiPrompts.description")}</DialogDescription>
            </DialogHeader>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              {t("aiAssistant.promptName")}
              <Input
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                placeholder={t("aiAssistant.promptNamePlaceholder")}
                maxLength={80}
                required
                autoFocus
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              {t("aiAssistant.promptDescription")}
              <Input
                value={saveDescription}
                onChange={(event) => setSaveDescription(event.target.value)}
                placeholder={t("aiPrompts.descriptionPlaceholder")}
                maxLength={200}
              />
            </label>
            {createPromptMutation.error ? (
              <p className="text-xs font-medium text-rose-600" role="alert">
                {createPromptMutation.error instanceof Error
                  ? createPromptMutation.error.message
                  : t("aiAssistant.promptSaveFailed")}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSaveDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="solid"
                disabled={!saveName.trim() || !customInstruction.trim() || createPromptMutation.isPending}
              >
                {createPromptMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />}
                {t("aiPrompts.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
