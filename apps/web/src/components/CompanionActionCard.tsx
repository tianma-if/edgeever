import type { CompanionAction } from "@edgeever/shared";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  return <Card className="shadow-none" aria-label={t(merge ? "companion.actions.merge" : "companion.actions.tag")}>
    <CardHeader className="p-3">
      <CardTitle className="text-sm">{t(merge ? "companion.actions.merge" : "companion.actions.tag")}</CardTitle>
      <CardDescription className="break-words">{action.plan.reason}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 p-3 pt-0 text-sm">
      {action.status === "pending" ? <details>
        <summary className="cursor-pointer rounded text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">{t("companion.actions.review")}</summary>
        <div className="mt-3 space-y-3">
          {action.plan.kind === "merge" ? <p className="break-words font-medium">{t("companion.actions.resultTitle", { title: action.plan.title })}</p> : null}
          <ol className="list-inside list-decimal space-y-3">
            {action.notes.map(note => <li key={note.id}>
              <Button size="sm" variant="ghost" disabled={busy} className="h-auto min-h-9 max-w-full justify-start whitespace-normal break-words py-1.5 text-left" onClick={() => onOpenNote(note.id, note.notebookId)}>{note.title || t("common.untitledMemo")}</Button>
              <p className="mt-1 break-words text-xs text-slate-500">{note.excerpt}</p>
              <p className="mt-1 break-words text-xs text-slate-500">{t("companion.actions.existingTags", { tags: note.tags.join(" · ") || "—" })}</p>
            </li>)}
          </ol>
          {action.plan.kind === "tag" ? <p className="break-words text-emerald-700">{t("companion.actions.addTags", { tags: action.plan.tags.join(" · ") })}</p> : null}
          <p className="text-xs leading-relaxed text-slate-600">{t(merge ? "companion.actions.mergeHelp" : "companion.actions.tagHelp")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => onApply(action)}>{t(merge ? "companion.actions.confirmMerge" : "companion.actions.confirmTags")}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDismiss(action)}>{t("companion.actions.dismiss")}</Button>
          </div>
        </div>
      </details> : <p role="status" className="text-xs text-slate-500">{t(`companion.actions.status.${action.status}`)}</p>}
      {action.status === "applied" && action.resultMemoId ? <Button size="sm" variant="outline" disabled={busy} onClick={() => onOpenNote(action.resultMemoId!, action.notes[0].notebookId)}>{t("companion.actions.openResult")}</Button> : null}
    </CardContent>
  </Card>;
}
