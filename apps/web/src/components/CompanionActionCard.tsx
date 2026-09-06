import type { CompanionAction } from "@edgeever/shared";
import { ArrowUpRight, Check, FileText, GitMerge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CompanionToolActionCard } from "./CompanionToolActionCard";

export function CompanionActionCard({ action, busy, onApply, onDismiss, onOpenNote }: {
  action: CompanionAction;
  busy: boolean;
  onApply: (action: CompanionAction) => void;
  onDismiss: (action: CompanionAction) => void;
  onOpenNote: (id: string, notebookId: string) => void;
}) {
  const { t } = useTranslation();
  if (action.plan.kind === "tool") return <CompanionToolActionCard {...{ action, busy, onApply, onDismiss, onOpenNote }} />;
  const merge = action.plan.kind === "merge";

  return (
    <div className="space-y-3 pt-0.5" aria-label={t(merge ? "companion.actions.merge" : "companion.actions.tag")}>
      <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600 sm:text-sm dark:text-slate-300">
        {action.plan.reason}
      </p>
      {action.status === "pending" ? (
        <div className="space-y-3">
          {action.plan.kind === "merge" ? (
            <div className="space-y-2 rounded-lg border border-slate-200/70 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
              <p className="break-words text-xs font-semibold text-slate-800 dark:text-slate-200">
                {t("companion.actions.resultTitle", { title: action.plan.title })}
              </p>
              <ol className="list-inside list-decimal space-y-2 pt-1.5 text-xs">
                {action.notes.map(note => (
                  <li key={note.id} className="text-slate-700 dark:text-slate-300">
                    <button
                      type="button"
                      disabled={busy}
                      className="inline-flex max-w-full items-center gap-1 font-medium hover:text-emerald-600 hover:underline dark:hover:text-emerald-400"
                      onClick={() => onOpenNote(note.id, note.notebookId)}
                    >
                      <FileText className="h-3 w-3 shrink-0 text-slate-400" />
                      <span className="truncate">{note.title || t("common.untitledMemo")}</span>
                      <ArrowUpRight className="h-2.5 w-2.5 shrink-0 opacity-50" />
                    </button>
                    {note.excerpt ? (
                      <p className="mt-0.5 line-clamp-1 break-words text-[11px] text-slate-500 dark:text-slate-400">
                        {note.excerpt}
                      </p>
                    ) : null}
                    <p className="mt-0.5 break-words text-[10px] text-slate-400 dark:text-slate-500">
                      {t("companion.actions.existingTags", { tags: note.tags.join(" · ") || "—" })}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-slate-200/70 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
              {action.notes[0] ? (
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onOpenNote(action.notes[0].id, action.notes[0].notebookId)}
                    className="group/note inline-flex max-w-full items-center gap-1.5 text-xs font-semibold text-slate-800 hover:text-emerald-600 dark:text-slate-200 dark:hover:text-emerald-400"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover/note:text-emerald-600 dark:group-hover/note:text-emerald-400" />
                    <span className="truncate">{action.notes[0].title || t("common.untitledMemo")}</span>
                    <ArrowUpRight className="h-3 w-3 shrink-0 opacity-40 group-hover/note:opacity-100" />
                  </button>
                  {action.notes[0].excerpt ? (
                    <p className="mt-1 line-clamp-2 break-words text-xs text-slate-500 dark:text-slate-400">
                      {action.notes[0].excerpt}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-1 border-t border-slate-200/50 pt-2 text-xs dark:border-slate-800">
                <p className="break-words font-medium text-emerald-700 dark:text-emerald-400">
                  {t("companion.actions.addTags", { tags: action.plan.tags.join(" · ") })}
                </p>
                {action.notes[0] ? (
                  <p className="break-words text-[11px] text-slate-400 dark:text-slate-500">
                    {t("companion.actions.existingTags", { tags: action.notes[0].tags.join(" · ") || "—" })}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800/80">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onDismiss(action)}
              className="h-7 px-2.5 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              {t("companion.actions.dismiss")}
            </Button>
            <Button
              size="sm"
              variant="solid"
              disabled={busy}
              onClick={() => onApply(action)}
              className="h-7 gap-1 px-3 text-xs"
            >
              {merge ? <GitMerge className="h-3 w-3" /> : <Check className="h-3 w-3" />}
              {t("companion.actions.confirm")}
            </Button>
          </div>
        </div>
      ) : action.status === "applied" ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200/50 bg-emerald-50/60 p-2.5 text-xs text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span className="flex items-center gap-1.5 font-medium">
            <Check className="h-3.5 w-3.5" />
            {t("companion.actions.status.applied")}
          </span>
          {action.resultMemoId ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenNote(action.resultMemoId!, action.notes[0]?.notebookId ?? "")}
              className="h-6 px-2 text-xs"
            >
              {t("companion.actions.openResult")}
            </Button>
          ) : null}
        </div>
      ) : (
        <p role="status" className="text-xs text-slate-400 dark:text-slate-500">
          {t(`companion.actions.status.${action.status}`)}
        </p>
      )}
    </div>
  );
}
