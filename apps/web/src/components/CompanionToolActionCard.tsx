import type { CompanionAction } from "@edgeever/shared";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
  return <Card className="shadow-none" aria-label={title}>
    <CardHeader className="p-3"><CardTitle className="text-sm">{title}</CardTitle>
      <CardDescription className="break-words">{action.plan.reason}</CardDescription></CardHeader>
    <CardContent className="space-y-3 p-3 pt-0 text-sm">
      {action.status === "pending" ? <details>
        <summary className="cursor-pointer rounded text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("companion.actions.review")}</summary>
        <div className="mt-3 space-y-3">
          {action.preview?.affectedCount ? <p>{t("companion.actions.affected", { count: action.preview.affectedCount })}</p> : null}
          {action.notes.map(note => <div key={note.id}>
            <Button variant="ghost" size="sm" className="h-auto max-w-full whitespace-normal break-words text-left" disabled={busy}
              onClick={() => onOpenNote(note.id, note.notebookId)}>{note.title || t("common.untitledMemo")}</Button>
            <p className="break-words text-xs text-muted-foreground">{note.excerpt}</p>
          </div>)}
          <dl className="space-y-2">{Object.entries(action.plan.arguments).map(([key, value]) => <div key={key}>
            <dt className="font-medium">{t(`companion.actions.fields.${key}`, { defaultValue: key })}</dt>
            <dd className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{display(value)}</dd>
          </div>)}</dl>
          {special ? <p className="text-xs text-destructive">{t(`companion.actions.effects.${name}`)}</p> : null}
          <p className="text-xs text-muted-foreground">{t("companion.actions.toolHelp")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => onApply(action)}>{t("companion.actions.confirmTool")}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDismiss(action)}>{t("companion.actions.dismiss")}</Button>
          </div>
        </div>
      </details> : <p role="status" className="text-xs text-muted-foreground">{t(`companion.actions.status.${action.status}`)}</p>}
      {action.status === "applied" && action.resultMemoId && action.resultNotebookId ? <Button variant="outline" size="sm" disabled={busy}
        onClick={() => onOpenNote(action.resultMemoId!, action.resultNotebookId!)}>{t("companion.actions.openResult")}</Button> : null}
      {action.status === "applied" && action.result ? <details><summary className="cursor-pointer">{t("companion.actions.receipt")}</summary>
        <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(action.result, null, 2)}</pre></details> : null}
    </CardContent>
  </Card>;
}
