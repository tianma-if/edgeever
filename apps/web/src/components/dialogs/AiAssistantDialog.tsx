import { useEffect, useRef, useState } from "react";
import type { AiAction } from "@edgeever/shared";
import { Check, Copy, Loader2, Sparkles, Square } from "lucide-react";
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
import { api, ApiRequestError } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export const AiAssistantDialog = ({
  open,
  title,
  contentMarkdown,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  title: string;
  contentMarkdown: string;
  onOpenChange: (open: boolean) => void;
  onApply: (text: string, mode: "append" | "replace") => void;
}) => {
  const { t } = useTranslation();
  const [action, setAction] = useState<AiAction>("summarize");
  const [targetLanguage, setTargetLanguage] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    if (!open) controllerRef.current?.abort();
  }, [open]);

  const generate = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setOutput("");
    setError(null);
    setCopied(false);
    setIsGenerating(true);
    try {
      await api.streamAiGeneration(
        { action, title, contentMarkdown, ...(action === "translate" ? { targetLanguage } : {}) },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "text-delta") setOutput((current) => current + event.text);
            if (event.type === "error") setError(event.message);
          },
        },
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(["summarize", "extract-key-points", "extract-todos", "rewrite-proofread", "translate"] as AiAction[]).map((item) => (
              <Button key={item} type="button" variant={action === item ? "solid" : "outline"} onClick={() => setAction(item)}>{t(`aiAssistant.actions.${item}`)}</Button>
            ))}
          </div>
          {action === "translate" ? (
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              {t("aiAssistant.targetLanguage")}
              <input className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/15" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} placeholder={t("aiAssistant.targetLanguagePlaceholder")} maxLength={80} />
            </label>
          ) : null}
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700">{t("aiAssistant.result")}</span>
            <div className={cn("min-h-48 whitespace-pre-wrap rounded-lg border bg-slate-50 p-4 text-sm leading-6 text-slate-800", error ? "border-rose-200" : "border-slate-200")}>
              {output || <span className="text-slate-400">{t("aiAssistant.resultPlaceholder")}</span>}
            </div>
            {error ? <p className="text-xs font-medium text-rose-600" role="alert">{error}</p> : null}
          </div>
        </div>
        <DialogFooter className="flex-wrap sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={!output || isGenerating} onClick={() => void copy()}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{t(copied ? "aiAssistant.copied" : "aiAssistant.copy")}</Button>
            <Button type="button" variant="outline" disabled={!output || isGenerating} onClick={() => onApply(output, "append")}>{t("aiAssistant.append")}</Button>
            <Button type="button" variant="outline" disabled={!output || isGenerating} onClick={() => onApply(output, "replace")}>{t("aiAssistant.replace")}</Button>
          </div>
          {isGenerating ? (
            <Button type="button" variant="solid" onClick={() => controllerRef.current?.abort()}><Square className="h-3.5 w-3.5" />{t("aiAssistant.stop")}</Button>
          ) : (
            <Button type="button" variant="solid" disabled={action === "translate" && !targetLanguage.trim()} onClick={() => void generate()}><Loader2 className="hidden h-4 w-4" />{t("aiAssistant.generate")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
