import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import type { AiTargetLanguage } from "@edgeever/shared";
import { formatAiPartList } from "@edgeever/shared/ai-generation";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { copyTextToClipboard } from "@/lib/clipboard";
import { SELECTION_AI_LANGUAGES } from "@/lib/selection-ai";
import type { AiDraftSelectionSnapshot } from "@/lib/ai-body-draft-store";
import { AiSidebarMessage } from "./AiSidebarMessage";
import type { AiBodyDraft, AiBodyDraftApplyResult, AiBodyDraftConfirm } from "./useAiBodyDraft";

/**
 * A sidebar body draft (#652 PR B): the result of `/translate`, `/improve` or the selection
 * menu's Translate. Copy and insert always work; replace needs a complete draft and a target that
 * did not change since it was generated, or the user's confirmation of a new target.
 */
export function AiBodyDraftPanel({
  draft,
  onStop,
  onDiscard,
  onRegenerate,
  onApply,
}: {
  draft: AiBodyDraft;
  onStop: () => void;
  onDiscard: () => void;
  onRegenerate: (targetLanguage?: AiTargetLanguage) => void;
  onApply: (
    mode: "insert" | "replace",
    confirmed?: { noteChanged?: boolean; selection?: AiDraftSelectionSnapshot },
  ) => Promise<AiBodyDraftApplyResult>;
}) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<AiBodyDraftConfirm | null>(null);
  const [applyFailed, setApplyFailed] = useState(false);
  const selection = draft.target.kind === "selection";
  const hasText = Boolean(draft.text.trim());
  const replaceDisabled = draft.generating || !hasText || draft.incomplete !== null;

  const run = async (mode: "insert" | "replace", confirmed?: { noteChanged?: boolean; selection?: AiDraftSelectionSnapshot }) => {
    setApplyFailed(false);
    const result = await onApply(mode, confirmed);
    if (result === "applied") {
      setConfirm(null);
      return;
    }
    if (result === "failed") {
      setApplyFailed(true);
      return;
    }
    setConfirm(result);
  };

  const incompleteMessage = draft.incomplete === "truncated" && draft.incompleteParts.length
    ? t("aiAssistant.sidebar.draft.incomplete.parts", { parts: formatAiPartList(draft.incompleteParts, i18n.language) })
    : draft.incomplete
      ? t(`aiAssistant.sidebar.draft.incomplete.${draft.incomplete}`)
      : null;

  return (
    <section
      aria-label={t(`aiAssistant.sidebar.draft.title.${draft.action}`)}
      className="space-y-2 rounded-md border border-slate-200 bg-card px-3 py-2.5"
      data-ai-body-draft={draft.action}
    >
      <header className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">
          {t(`aiAssistant.sidebar.draft.title.${draft.action}`)}
          <span className="font-normal text-slate-500">
            {" · "}
            {t(selection ? "aiAssistant.sidebar.draft.scopeSelection" : "aiAssistant.sidebar.draft.scopeNote")}
          </span>
        </p>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="icon-xs" variant="ghost" aria-label={t("aiAssistant.sidebar.draft.discard")} onClick={onDiscard}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("aiAssistant.sidebar.draft.discard")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </header>
      {draft.recovered ? <p className="text-xs text-slate-500">{t("aiAssistant.sidebar.draft.recovered")}</p> : null}
      {draft.action === "translate" && !draft.generating ? (
        <div className="flex flex-wrap items-center gap-1" aria-label={t("aiAssistant.sidebar.draft.language")} role="group">
          {SELECTION_AI_LANGUAGES.map((language) => (
            <Button
              key={language}
              type="button"
              size="sm"
              variant={draft.targetLanguage === language ? "soft" : "ghost"}
              aria-pressed={draft.targetLanguage === language}
              onClick={() => onRegenerate(language)}
            >
              {t(`aiAssistant.sidebar.selection.chips.${language}`)}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="max-h-72 overflow-y-auto">
        {hasText ? (
          <AiSidebarMessage isAnimating={draft.generating}>{draft.text}</AiSidebarMessage>
        ) : draft.generating ? (
          <p role="status" className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {t("aiAssistant.sidebar.draft.generating")}
          </p>
        ) : null}
      </div>
      {draft.generating && draft.progress ? (
        <p aria-live="polite" className="text-xs text-slate-500">
          {t("aiAssistant.sidebar.draft.progress", { part: draft.progress.part, parts: draft.progress.parts })}
        </p>
      ) : null}
      {!draft.generating && hasText && incompleteMessage ? (
        <p role="alert" className="text-xs leading-5 text-rose-700">{incompleteMessage}</p>
      ) : null}
      {draft.error ? <p role="alert" className="text-xs leading-5 text-rose-700">{draft.error}</p> : null}
      {confirm?.kind === "note-changed" ? (
        <div role="alert" className="space-y-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-900">
          <p>{t("aiAssistant.sidebar.draft.noteChanged")}</p>
          <div className="flex gap-1.5">
            <Button type="button" size="sm" variant="outline" onClick={() => void run("replace", { noteChanged: true })}>
              {t("aiAssistant.sidebar.draft.replaceAnyway")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>{t("aiAssistant.sidebar.draft.cancel")}</Button>
          </div>
        </div>
      ) : null}
      {confirm?.kind === "selection-changed" ? (
        <div role="alert" className="space-y-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-900">
          <p>{t(confirm.current ? "aiAssistant.sidebar.draft.selectionChanged" : "aiAssistant.sidebar.draft.selectionMissing")}</p>
          {confirm.current ? (
            <>
              <p className="line-clamp-2 whitespace-pre-wrap break-words text-amber-800">{confirm.current.text}</p>
              <div className="flex gap-1.5">
                <Button type="button" size="sm" variant="outline" onClick={() => void run("replace", { selection: confirm.current ?? undefined })}>
                  {t("aiAssistant.sidebar.draft.replaceCurrentSelection")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>{t("aiAssistant.sidebar.draft.cancel")}</Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {applyFailed ? <p role="alert" className="text-xs text-rose-700">{t("aiAssistant.sidebar.draft.applyFailed")}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {draft.generating ? (
          <Button type="button" size="sm" variant="outline" onClick={onStop}>{t("aiAssistant.sidebar.draft.stop")}</Button>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!hasText}
              onClick={() => {
                void copyTextToClipboard(draft.text.trim()).then((ok) => {
                  if (!ok) return;
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? t("aiAssistant.sidebar.draft.copied") : t("aiAssistant.sidebar.draft.copy")}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!hasText} onClick={() => void run("insert")}>
              {t(selection ? "aiAssistant.sidebar.draft.insertAfterSelection" : "aiAssistant.sidebar.draft.appendToNote")}
            </Button>
            <Button type="button" size="sm" disabled={replaceDisabled} onClick={() => void run("replace")} data-ai-body-draft-replace="">
              {t(selection ? "aiAssistant.sidebar.draft.replaceSelection" : "aiAssistant.sidebar.draft.replaceNote")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onRegenerate()}>{t("aiAssistant.sidebar.draft.regenerate")}</Button>
          </>
        )}
      </div>
    </section>
  );
}
