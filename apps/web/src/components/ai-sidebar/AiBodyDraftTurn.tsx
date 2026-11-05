import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { getDefaultAiTargetLanguage, type AiTargetLanguage } from "@edgeever/shared";
import { formatAiPartList } from "@edgeever/shared/ai-generation";
import { Button } from "@/components/ui/button";
import { CompanionQuestionForm } from "@/components/CompanionQuestionForm";
import { parseAiTargetLanguage, suggestAiTargetLanguages } from "@/lib/ai-body-commands";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { AiDraftSelectionSnapshot } from "@/lib/ai-body-draft-store";
import { AiSidebarMessage } from "./AiSidebarMessage";
import type { AiBodyDraft, AiBodyDraftApplyResult, AiBodyDraftConfirm } from "./useAiBodyDraft";

/**
 * A sidebar body draft (#652 PR B): the result of `/translate`, `/improve` or the selection
 * menu's Translate, shown as one turn of the conversation (the request, then the result with its
 * actions). Copy and insert always work; replace needs a complete draft and a target that did not
 * change since it was generated, or the user's confirmation of a new target.
 */
export function AiBodyDraftTurn({
  draft,
  userMessageClassName,
  onStop,
  onDiscard,
  onRegenerate,
  onApply,
}: {
  draft: AiBodyDraft;
  userMessageClassName?: string;
  onStop: () => void;
  onDiscard: () => void;
  onRegenerate: (targetLanguage?: AiTargetLanguage, instruction?: string) => void;
  onApply: (
    mode: "insert" | "replace",
    confirmed?: { noteChanged?: boolean; selection?: AiDraftSelectionSnapshot },
  ) => Promise<AiBodyDraftApplyResult>;
}) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<AiBodyDraftConfirm | null>(null);
  const [applyFailed, setApplyFailed] = useState(false);
  // Ask like the Agent does: three likely languages, or type another one.
  const languageChoices = useMemo(
    () => suggestAiTargetLanguages(draft.source, i18n.language, getDefaultAiTargetLanguage(i18n.language)),
    [draft.source, i18n.language],
  );
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
    <div className="space-y-2" data-ai-body-draft={draft.action}>
      <Message from="user">
        <MessageContent className={userMessageClassName}>{draft.message}</MessageContent>
      </Message>
      <Message from="assistant">
        {draft.recovered ? <p className="text-xs text-slate-500">{t("aiAssistant.sidebar.draft.recovered")}</p> : null}
        {draft.awaitingLanguage ? (
          <div data-ai-body-draft-language="">
            <CompanionQuestionForm
              questions={[{
                id: "language",
                prompt: t("aiAssistant.sidebar.draft.chooseLanguage"),
                inputType: "single_select",
                options: languageChoices.map((item) => ({ id: item, label: t(`aiAssistant.targetLanguages.${item}`) })),
              }]}
              busy={false}
              onSubmit={(answers) => {
                const answer = answers[0];
                const typed = answer?.text?.trim() ?? "";
                // A typed language wins; one the app does not know becomes the instruction.
                const named = typed ? parseAiTargetLanguage(typed) : (answer?.optionIds?.[0] as AiTargetLanguage | undefined) ?? null;
                if (named) onRegenerate(named);
                else if (typed) onRegenerate(languageChoices[0], t("aiAssistant.sidebar.draft.translateInto", { language: typed }));
              }}
            />
            <div className="mt-1.5 flex justify-end">
              <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>{t("aiAssistant.sidebar.draft.cancel")}</Button>
            </div>
          </div>
        ) : null}
        {hasText ? (
          <AiSidebarMessage isAnimating={draft.generating}>{draft.text}</AiSidebarMessage>
        ) : draft.generating ? (
          <p role="status" className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {t("aiAssistant.sidebar.draft.generating")}
          </p>
        ) : null}
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
        {draft.awaitingLanguage ? null : <div className="flex flex-wrap items-center gap-1.5">
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
              <Button type="button" size="sm" variant="outline" disabled={replaceDisabled} onClick={() => void run("replace")} data-ai-body-draft-replace="">
                {t(selection ? "aiAssistant.sidebar.draft.replaceSelection" : "aiAssistant.sidebar.draft.replaceNote")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => onRegenerate()}>{t("aiAssistant.sidebar.draft.regenerate")}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>{t("aiAssistant.sidebar.draft.discard")}</Button>
            </>
          )}
        </div>}
      </Message>
    </div>
  );
}
