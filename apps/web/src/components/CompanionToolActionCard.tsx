import type { CompanionAction } from "@edgeever/shared";
import { ArrowUpRight, Check, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function CompanionToolActionCard({ action, busy, onApply, onDismiss, onOpenNote }: {
  action: CompanionAction; busy: boolean;
  onApply: (action: CompanionAction) => void; onDismiss: (action: CompanionAction) => void;
  onOpenNote: (id: string, notebookId: string) => void;
}) {
  const { t } = useTranslation();
  if (action.plan.kind !== "tool") return null;
  const name = action.plan.toolName;
  const title = t(`companion.actions.tools.${name}`, { defaultValue: name });
  const names = new Map([...action.notes.map(note => [note.id, note.title || t("common.untitledMemo")] as const),
    ...(action.preview?.notebooks ?? []).map(notebook => [notebook.id, notebook.name] as const)]);
  const display = (value: unknown): string => {
    if (typeof value === "string") return names.has(value) ? `${names.get(value)} (${value})` : value;
    if (Array.isArray(value)) return value.map(item => typeof item === "object" ? JSON.stringify(item, null, 2) : display(item)).join("\n");
    return JSON.stringify(value, null, 2);
  };
  const special = ["merge_memos", "trash_memos", "rename_tag", "delete_tag", "update_memo", "restore_memo_revision"].includes(name);

  return (
    <div className="space-y-3 pt-0.5" aria-label={title}>
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300">{action.plan.reason}</p>
      </div>
      {action.status === "pending" ? (
        <div className="space-y-2.5">
          {action.preview?.affectedCount ? (
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t("companion.actions.affected", { count: action.preview.affectedCount })}
            </p>
          ) : null}
          {action.notes.length > 0 ? (
            <div className="space-y-1.5 rounded-lg border border-slate-200/70 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
              {action.notes.map(note => (
                <div key={note.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onOpenNote(note.id, note.notebookId)}
                    className="inline-flex max-w-full items-center gap-1 text-xs font-medium text-slate-800 hover:text-emerald-600 hover:underline dark:text-slate-200 dark:hover:text-emerald-400"
                  >
                    <FileText className="h-3 w-3 shrink-0 text-slate-400" />
                    <span className="truncate">{note.title || t("common.untitledMemo")}</span>
                    <ArrowUpRight className="h-2.5 w-2.5 shrink-0 opacity-50" />
                  </button>
                  {note.excerpt ? (
                    <p className="line-clamp-1 break-words text-[11px] text-slate-500 dark:text-slate-400">
                      {note.excerpt}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <dl className="space-y-2 text-xs">
            {Object.entries(action.plan.arguments).map(([key, value]) => (
              <div key={key}>
                <dt className="font-medium text-slate-700 dark:text-slate-300">
                  {t(`companion.actions.fields.${key}`, { defaultValue: key })}
                </dt>
                <dd className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-slate-100/80 p-2 text-[11px] text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  {display(value)}
                </dd>
              </div>
            ))}
          </dl>
          {special ? (
            <p className="rounded-lg border border-rose-200/60 bg-rose-50/60 p-2.5 text-xs text-rose-600 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400">
              {t(`companion.actions.effects.${name}`)}
            </p>
          ) : null}
          <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            {t("companion.actions.toolHelp")}
          </p>
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
              <Check className="h-3 w-3" />
              {t("companion.actions.confirm")}
            </Button>
          </div>
        </div>
      ) : action.status === "applied" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200/50 bg-emerald-50/60 p-2.5 text-xs text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300">
            <span className="flex items-center gap-1.5 font-medium">
              <Check className="h-3.5 w-3.5" />
              {t("companion.actions.status.applied")}
            </span>
            {action.resultMemoId && action.resultNotebookId ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onOpenNote(action.resultMemoId!, action.resultNotebookId!)}
                className="h-6 px-2 text-xs"
              >
                {t("companion.actions.openResult")}
              </Button>
            ) : null}
          </div>
          {action.result ? (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer hover:text-slate-800 dark:hover:text-slate-200">
                {t("companion.actions.receipt")}
              </summary>
              <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-2 text-[11px] dark:bg-slate-800">
                {JSON.stringify(action.result, null, 2)}
              </pre>
            </details>
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
