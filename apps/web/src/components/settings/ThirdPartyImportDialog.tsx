import { useRef } from "react";
import { CheckCircle2, ExternalLink, FileUp, Folder, LoaderCircle, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Notebook } from "@edgeever/shared";
import type { ImportFormat, ImportIssue } from "@edgeever/shared/note-import/types";
import type { NoteImportController, NoteImportSnapshot } from "@/lib/note-import/controller";
import { EVERNOTE_MIGRATION_BLOG_URL } from "@/lib/routes";

export const ThirdPartyImportDialog = ({ controller, state, onOpenMemo }: { controller: NoteImportController; state: NoteImportSnapshot; onOpenMemo: (memoId: string, notebookId: string) => void }) => {
  const { t } = useTranslation();
  const files = useRef<HTMLInputElement>(null);
  const directory = useRef<HTMLInputElement>(null);
  const busy = state.phase === "scanning" || state.phase === "running";
  const summary = state.summary;
  const failure = state.outcome?.failure;
  const selectFiles = (input: HTMLInputElement, folder: boolean) => {
    const selection = Array.from(input.files ?? []).map(file => ({ path: folder ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name, file, expandArchive: !folder }));
    controller.select(selection); input.value = "";
  };
  const errorText = (code: string) => t(`noteImport.errors.${code}`, { defaultValue: code });
  const issueText = (issue: ImportIssue) => t(`noteImport.issues.${issue.code}`, { defaultValue: issue.code, count: issue.code === "ignoredTags" ? Number(issue.detail) : undefined });
  const foldersByKey = new Map(state.folders.map(folder => [folder.key, folder]));
  const folderDepth = (key: string): number => {
    const parent = foldersByKey.get(key)?.parentKey;
    return parent ? 1 + folderDepth(parent) : 0;
  };
  const destinationsById = new Map(state.destinations.map(notebook => [notebook.id, notebook]));
  const destinationPath = (notebook: Notebook): string => {
    const parent = notebook.parentId ? destinationsById.get(notebook.parentId) : undefined;
    return parent ? `${destinationPath(parent)} / ${notebook.name}` : notebook.name;
  };
  const openResult = (memoId: string, notebookId: string) => { controller.hide(); onOpenMemo(memoId, notebookId); };
  return <Dialog open={state.open} onOpenChange={open => { if (!open) controller.dismiss(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-5 overflow-hidden sm:max-w-2xl" aria-describedby="note-import-target">
      <DialogHeader>
        <DialogTitle>{t("noteImport.title")}</DialogTitle>
        <DialogDescription id="note-import-target" className="break-all">{controller.target} · {controller.accountLabel}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
        {state.phase === "idle" ? <div className="space-y-4">
          <label className="grid gap-2 text-sm"><span>{t("noteImport.source")}</span>
            <Select value={state.format} onValueChange={value => controller.setFormat(value as ImportFormat)}>
              <SelectTrigger aria-label={t("noteImport.source")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="evernote">Evernote / 印象笔记</SelectItem><SelectItem value="obsidian">Obsidian</SelectItem><SelectItem value="joplin">Joplin</SelectItem></SelectContent>
            </Select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => files.current?.click()}><FileUp className="h-4 w-4" />{t("noteImport.files")}</Button>
            <Button variant="outline" onClick={() => directory.current?.click()}><Folder className="h-4 w-4" />{t("noteImport.folder")}</Button>
          </div>
          <p className="text-sm text-muted-foreground">{state.format === "evernote" ? ".enex · .zip" : state.format === "obsidian" ? "Vault · .zip" : "RAW · Markdown · .zip · .jex"}</p>
        </div> : null}
        <input ref={files} type="file" multiple className="hidden" data-testid="note-import-files" accept={state.format === "evernote" ? ".enex,.zip,.notes" : state.format === "joplin" ? ".zip,.jex" : ".zip"} onChange={event => selectFiles(event.currentTarget, false)} />
        <input ref={directory} type="file" multiple className="hidden" data-testid="note-import-directory" {...{ webkitdirectory: "", directory: "" }} onChange={event => selectFiles(event.currentTarget, true)} />
        {state.phase === "scanning" ? <div className="space-y-3 py-3" role="status"><p className="flex items-center gap-2 text-sm"><LoaderCircle className="h-4 w-4 animate-spin" />{t("noteImport.scanning")}</p><p className="break-all text-sm text-muted-foreground">{state.scanningPath}</p></div> : null}
        {summary ? <dl className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 p-4 text-center">
          {([ ["notebooks", summary.notebooks], ["notes", summary.notes], ["resources", summary.resources] ] as const).map(([label, count]) => <div key={label}><dd className="text-2xl font-semibold tabular-nums">{count.toLocaleString()}</dd><dt className="mt-1 text-sm text-muted-foreground">{t(`noteImport.${label}`)}</dt></div>)}
        </dl> : null}
        {state.phase === "ready" ? <div className="space-y-4">
          <label className="grid gap-2 text-sm"><span>{t("noteImport.destination")}</span>
            <Select value={state.parentId || "__root"} onValueChange={value => controller.setParent(value === "__root" ? "" : value)}>
              <SelectTrigger aria-label={t("noteImport.destination")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__root">{t("noteImport.topLevel")}</SelectItem>{state.destinations.map(notebook => <SelectItem value={notebook.id} key={notebook.id}>{destinationPath(notebook)}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <div className="rounded-lg border p-3"><ul className="space-y-1 text-sm" aria-label={t("noteImport.folderPreview")}>{state.folders.map(folder => <li key={folder.key} className="flex items-center gap-2 break-all" style={{ paddingInlineStart: Math.min(folderDepth(folder.key), 10) * 12 }}><Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{folder.name}</li>)}</ul>{summary && state.folders.length < summary.notebooks ? <Button variant="ghost" size="sm" className="mt-2" onClick={() => void controller.more("notebook")}>{t("noteImport.more")}</Button> : null}</div>
        </div> : null}
        {state.phase === "running" && state.progress ? <div className="space-y-2" role="status" aria-live="polite"><div className="flex items-center justify-between gap-3 text-sm"><span>{t(`noteImport.phases.${state.progress.phase}`)}</span><span className="tabular-nums">{state.progress.unit === "bytes" ? `${(state.progress.completed / 1048576).toFixed(1)} / ${(state.progress.total / 1048576).toFixed(1)} MiB` : `${state.progress.completed} / ${state.progress.total}`}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={state.progress.total} aria-valuenow={state.progress.completed}><div className="h-full bg-foreground transition-[width]" style={{ width: `${state.progress.total ? state.progress.completed / state.progress.total * 100 : 0}%` }} /></div><p className="break-all text-sm text-muted-foreground">{state.progress.path}</p></div> : null}
        {(state.phase === "ready" && state.issues.length > 0) ? <details className="rounded-lg border p-3" open={summary && summary.errors > 0}>
          <summary className="cursor-pointer text-sm">{t("noteImport.issueCounts", { errors: summary?.errors ?? 0, warnings: summary?.warnings ?? 0 })}</summary>
          <ul className="mt-3 space-y-3 text-sm">{state.issues.map(issue => <li key={issue.key} className="break-words"><p className={issue.severity === "error" ? "text-destructive" : "text-muted-foreground"}>{issueText(issue)}</p><p className="break-all text-muted-foreground">{issue.path}{issue.detail && issue.code !== "ignoredTags" ? ` · ${issue.detail}` : ""}</p></li>)}</ul>
          {summary && state.issues.length < summary.errors + summary.warnings ? <Button size="sm" variant="ghost" className="mt-2" onClick={() => void controller.more("issue")}>{t("noteImport.more")}</Button> : null}
        </details> : null}
        {state.outcome ? <div className="space-y-3" role="status">
          <p className="flex items-center gap-2 text-sm font-medium">{state.outcome.completed === summary?.notes ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <TriangleAlert className="h-4 w-4" />}{t(state.outcome.cancelled ? "noteImport.cancelled" : state.outcome.completed === summary?.notes ? "noteImport.complete" : "noteImport.incomplete", { completed: state.outcome.completed, total: summary?.notes ?? 0 })}</p>
          {state.outcome.syncPending ? <p className="text-sm text-amber-700">{t("noteImport.syncPending")}</p> : null}
          {failure && !state.results.some(result => result.key === failure.key) ? <p className="break-all text-sm text-destructive">{failure.path} · {errorText(failure.uncertain ? "uncertainResource" : failure.message)}</p> : null}
        </div> : null}
        {state.error ? <p className="break-words text-sm text-destructive" role="alert">{errorText(state.error)}</p> : null}
        {state.phase === "finished" && state.results.length ? <div className="space-y-2 text-sm">{state.results.map(result => <div key={result.key} className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-all">{result.path}</p>{!result.complete ? <p className="text-destructive">{errorText(result.uncertain ? "uncertainResource" : result.error ?? "incomplete")}</p> : null}</div><Button size="sm" variant="ghost" className="shrink-0" onClick={() => openResult(result.memo.id, result.memo.notebookId)}>{t("noteImport.openNote")}</Button></div>)}{state.results.length < state.resultCount ? <Button size="sm" variant="ghost" onClick={() => void controller.more("result")}>{t("noteImport.more")}</Button> : null}</div> : null}
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button asChild variant="ghost" size="sm" className="px-0 text-muted-foreground"><a href={EVERNOTE_MIGRATION_BLOG_URL} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" />{t("noteImport.guide")}</a></Button>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={busy ? controller.cancel : controller.dismiss}>{t(busy ? "noteImport.cancel" : "noteImport.close")}</Button>
          {state.phase === "ready" ? <Button disabled={!summary?.notes || summary.errors > 0} onClick={controller.run}>{t("noteImport.confirm")}</Button> : null}
          {state.phase === "finished" && summary && !summary.errors ? <>
            {(state.outcome?.completed ?? 0) < summary.notes ? <Button onClick={controller.run}>{t("noteImport.retry")}</Button> : null}
            <Button variant="outline" onClick={() => void controller.restart()}>{t("noteImport.another")}</Button>
          </> : null}
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
};
