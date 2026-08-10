import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, Sparkles, Square, Trash2 } from "lucide-react";
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
  canReplaceAiSource,
  getDefaultAiAction,
  getDefaultTargetLanguage,
  selectedTextAiActions,
  targetLanguages,
  wholeNoteAiActions,
  type AiAssistantAction,
  type AiTone,
  type TargetLanguage,
} from "@/lib/ai-assistant";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export const AiAssistantDialog = ({
  open,
  title,
  contentMarkdown,
  selectionMarkdown,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  title: string;
  contentMarkdown: string;
  selectionMarkdown?: string | null;
  onOpenChange: (open: boolean) => void;
  onApply: (text: string, mode: "append" | "replace") => void;
}) => {
  const { t, i18n } = useTranslation();
  const hasSelection = Boolean(selectionMarkdown?.trim());
  const sourceMarkdown = hasSelection ? selectionMarkdown!.trim() : contentMarkdown;
  const defaultTargetLanguage = getDefaultTargetLanguage(i18n.resolvedLanguage);
  const [action, setAction] = useState<AiAssistantAction>(() => getDefaultAiAction(hasSelection));
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>(() => defaultTargetLanguage);
  const [tone, setTone] = useState<AiTone>("professional");
  const [customInstruction, setCustomInstruction] = useState("");
  const [refinement, setRefinement] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<Parameters<typeof api.streamAiGeneration>[0] | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    controllerRef.current?.abort();
    if (!open) return;
    setAction(getDefaultAiAction(hasSelection));
    setTargetLanguage(defaultTargetLanguage);
    setTone("professional");
    setCustomInstruction("");
    setRefinement("");
    setOutput("");
    setError(null);
    setCopied(false);
    setIsGenerating(false);
    lastRequestRef.current = null;
  }, [defaultTargetLanguage, hasSelection, open]);

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
    action,
    contentMarkdown: sourceMarkdown,
    customInstruction,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-emerald-600" />{t("aiAssistant.title")}</DialogTitle>
          <DialogDescription>{t("aiAssistant.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                {t(hasSelection ? "aiAssistant.selectedScope" : "aiAssistant.noteScope")}
              </span>
              {t(hasSelection ? "aiAssistant.selectedScopeHint" : "aiAssistant.noteScopeHint")}
            </div>
            {hasSelection ? (
              <p className="mt-2 max-h-16 overflow-hidden whitespace-pre-wrap border-l-2 border-emerald-200 pl-3 text-xs leading-5 text-slate-500">
                {selectionMarkdown}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700">{t("aiAssistant.actionLabel")}</span>
            <Select value={action} onValueChange={(value) => {
              setAction(value as AiAssistantAction);
              setOutput("");
              setError(null);
            }}>
              <SelectTrigger aria-label={t("aiAssistant.actionLabel")} className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t(hasSelection ? "aiAssistant.selectedActions" : "aiAssistant.noteActions")}</SelectLabel>
                  {(hasSelection ? selectedTextAiActions : wholeNoteAiActions).map((item) => (
                    <SelectItem key={item} value={item}>{t(`aiAssistant.actions.${item}`)}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {action === "translate" ? (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium text-slate-700">{t("aiAssistant.targetLanguage")}</span>
              <Select value={targetLanguage} onValueChange={(value) => {
                setTargetLanguage(value as TargetLanguage);
                setOutput("");
                setError(null);
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
          {action === "change-tone" ? (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium text-slate-700">{t("aiAssistant.tone")}</span>
              <Select value={tone} onValueChange={(value) => {
                setTone(value as AiTone);
                setOutput("");
                setError(null);
              }}>
                <SelectTrigger aria-label={t("aiAssistant.tone")} className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {aiTones.map((item) => <SelectItem key={item} value={item}>{t(`aiAssistant.tones.${item}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {action === "custom" ? (
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              {t("aiAssistant.customInstruction")}
              <textarea
                className="min-h-24 resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15"
                value={customInstruction}
                onChange={(event) => {
                  setCustomInstruction(event.target.value);
                  setOutput("");
                  setError(null);
                }}
                placeholder={t("aiAssistant.customInstructionPlaceholder")}
                maxLength={2_000}
              />
            </label>
          ) : null}
          <div className="flex justify-end">
            {isGenerating ? (
              <Button type="button" variant="solid" onClick={() => controllerRef.current?.abort()}>
                <Square className="h-3.5 w-3.5" />{t("aiAssistant.stop")}
              </Button>
            ) : (
              <Button type="button" variant="solid" disabled={action === "custom" && !customInstruction.trim()} onClick={() => void generate()}>
                <Sparkles className="h-4 w-4" />{t("aiAssistant.generate")}
              </Button>
            )}
          </div>
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
              {canReplaceAiSource(action) ? (
                <Button type="button" variant={hasSelection ? "solid" : "outline"} disabled={isGenerating} onClick={() => onApply(output, "replace")}>
                  {t(hasSelection ? "aiAssistant.replaceSelection" : "aiAssistant.replace")}
                </Button>
              ) : null}
              <Button type="button" variant={hasSelection && canReplaceAiSource(action) ? "outline" : "solid"} disabled={isGenerating} onClick={() => onApply(output, "append")}>{t("aiAssistant.append")}</Button>
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
