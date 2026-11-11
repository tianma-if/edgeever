import { useRef, useState, type DragEvent } from "react";
import { CheckCircle2, ExternalLink, FileUp, Folder, LoaderCircle, TriangleAlert, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import flomoLogo from "@/assets/import-logos/flomo.png?url";
import evernoteLogo from "@/assets/import-logos/evernote.svg?url";
import joplinLogo from "@/assets/import-logos/joplin.svg?url";
import obsidianLogo from "@/assets/import-logos/obsidian.svg?url";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Notebook } from "@edgeever/shared";
import type { ImportFile, ImportFormat, ImportIssue } from "@edgeever/shared/note-import/types";
import type { NoteImportController, NoteImportSnapshot } from "@/lib/note-import/controller";
import { EVERNOTE_MIGRATION_BLOG_URL } from "@/lib/routes";

const importSources = {
  notion: { label: "Notion", logo: undefined, formatHint: "Markdown & CSV · .zip" },
  siyuan: { label: "SiYuan / 思源", logo: undefined, formatHint: "Markdown · .zip" },
  flomo: { label: "flomo", logo: flomoLogo, formatHint: "HTML · .zip" },
  evernote: {
    label: "Evernote / 印象笔记",
    logo: evernoteLogo,
    formatHint: ".enex · .zip",
  },
  obsidian: {
    label: "Obsidian",
    logo: obsidianLogo,
    formatHint: "Vault 目录 · .zip",
  },
  joplin: {
    label: "Joplin",
    logo: joplinLogo,
    formatHint: ".jex · RAW · .zip",
  },
} satisfies Record<ImportFormat, { label: string; logo: string | undefined; formatHint: string }>;

export const ThirdPartyImportDialog = ({ controller, state, onOpenMemo }: { controller: NoteImportController; state: NoteImportSnapshot; onOpenMemo: (memoId: string, notebookId: string) => void }) => {
  const { t } = useTranslation();
  const files = useRef<HTMLInputElement>(null);
  const directory = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const busy = state.phase === "scanning" || state.phase === "running";
  const summary = state.summary;
  const failure = state.outcome?.failure;

  const selectFiles = (input: HTMLInputElement, folder: boolean) => {
    const selection = Array.from(input.files ?? []).map(file => ({
      path: folder ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name,
      file,
      expandArchive: !folder,
    }));
    controller.select(selection);
    input.value = "";
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current += 1;
    if (event.dataTransfer.items && event.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      setIsDragging(false);
      dragCounter.current = 0;
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;

    try {
      const items = Array.from(dataTransfer.items || []);
      const entries: any[] = [];
      for (const item of items) {
        if (typeof item.webkitGetAsEntry === "function") {
          const entry = item.webkitGetAsEntry();
          if (entry) entries.push(entry);
        }
      }

      if (entries.length > 0) {
        const results: ImportFile[] = [];
        const readEntry = async (entry: any, pathPrefix = ""): Promise<void> => {
          if (entry.isFile) {
            const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
            results.push({
              path: pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name,
              file,
              expandArchive: !pathPrefix,
            });
          } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            const readAll = async (): Promise<any[]> => {
              const batch: any[] = await new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));
              return batch.length > 0 ? [...batch, ...(await readAll())] : [];
            };
            const children = await readAll();
            for (const child of children) {
              await readEntry(child, pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name);
            }
          }
        };

        for (const entry of entries) {
          if (entry.isDirectory) {
            const dirReader = entry.createReader();
            const readAll = async (): Promise<any[]> => {
              const batch: any[] = await new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));
              return batch.length > 0 ? [...batch, ...(await readAll())] : [];
            };
            const children = await readAll();
            for (const child of children) {
              await readEntry(child, "");
            }
          } else {
            await readEntry(entry, "");
          }
        }

        if (results.length > 0) {
          controller.select(results);
          return;
        }
      }
    } catch {
      // Fall back to simple files if directory traversal is not supported
    }

    const filesList = Array.from(dataTransfer.files || []);
    if (filesList.length > 0) {
      controller.select(
        filesList.map(file => ({
          path: file.name,
          file,
          expandArchive: true,
        }))
      );
    }
  };

  const errorText = (code: string) => t(`noteImport.errors.${code}`, { defaultValue: code });
  const issueText = (issue: ImportIssue) =>
    t(`noteImport.issues.${issue.code}`, {
      defaultValue: issue.code,
      count: issue.code === "ignoredTags" ? Number(issue.detail) : undefined,
    });
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
  const openResult = (memoId: string, notebookId: string) => {
    controller.hide();
    onOpenMemo(memoId, notebookId);
  };

  return (
    <Dialog
      open={state.open}
      onOpenChange={open => {
        if (!open) controller.dismiss();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col gap-5 overflow-hidden sm:max-w-xl">
        <DialogHeader className="space-y-2">
          <DialogTitle className="px-8 text-lg font-semibold tracking-tight sm:pl-0">{t("noteImport.title")}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-normal">
            {t("noteImport.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
          {state.format === "obsidian" && ["idle", "scanning", "ready"].includes(state.phase) ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-1">
                <label htmlFor="import-unreferenced-attachments" className="text-xs font-medium">{t("noteImport.unreferencedAttachments")}</label>
                <p className="text-xs text-muted-foreground">{t("noteImport.unreferencedAttachmentsHint")}</p>
              </div>
              <Switch id="import-unreferenced-attachments" checked={state.includeUnreferencedAttachments} disabled={busy} onCheckedChange={controller.setIncludeUnreferencedAttachments} />
            </div>
          ) : null}
          {(state.format === "notion" || state.format === "siyuan") && <p className="text-xs text-muted-foreground">{t(`noteImport.${state.format}Hint`)}</p>}
          {state.format === "flomo" && <p className="text-xs text-muted-foreground">{t("noteImport.flomoHint")}</p>}
          {state.phase === "idle" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <span id="note-import-source" className="text-xs font-medium text-muted-foreground">
                  {t("noteImport.source")}
                </span>
                <ToggleGroup
                  type="single"
                  aria-labelledby="note-import-source"
                  className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
                  value={state.format}
                  onValueChange={value => {
                    if (value) controller.setFormat(value as ImportFormat);
                  }}
                >
                  {Object.entries(importSources).map(([format, { label, logo, formatHint }]) => {
                    const active = state.format === format;
                    return (
                      <ToggleGroupItem
                        key={format}
                        value={format}
                        variant="outline"
                        className={`flex h-auto w-full flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all ${
                          active
                            ? "border-primary/80 bg-primary/5 text-foreground ring-1 ring-primary/20 shadow-2xs"
                            : "border-border/60 bg-card hover:border-border hover:bg-muted/30 text-muted-foreground"
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            {logo && <img src={logo} alt="" className="size-4 shrink-0 object-contain" />}
                            <span className="truncate text-xs font-medium text-foreground">{label}</span>
                          </div>
                          {active ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
                        </div>
                        <span className="font-mono text-[11px] text-muted-foreground">{formatHint}</span>
                      </ToggleGroupItem>
                    );
                  })}
                </ToggleGroup>
              </div>

              {/* Dropzone Container */}
              <div
                className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all sm:p-7 ${
                  isDragging
                    ? "border-primary bg-primary/5 scale-[0.99]"
                    : "border-border/70 bg-muted/15 hover:border-border hover:bg-muted/30"
                }`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="mb-3 flex size-11 items-center justify-center rounded-full border border-border/50 bg-background text-muted-foreground shadow-2xs">
                  <Upload className="size-5" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {t("noteImport.dropzoneTitle")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("noteImport.dropzoneHint")}
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="soft"
                    size="sm"
                    className="h-8 gap-1.5 text-xs shadow-2xs cursor-pointer"
                    onClick={() => files.current?.click()}
                  >
                    <FileUp className="size-3.5" />
                    {t("noteImport.files")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs shadow-2xs cursor-pointer"
                    onClick={() => directory.current?.click()}
                  >
                    <Folder className="size-3.5" />
                    {t("noteImport.folder")}
                  </Button>
                </div>

                <div className="mt-3.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>{t("noteImport.supportedFormats")}</span>
                  <span className="font-mono rounded border border-border/50 bg-background/80 px-1.5 py-0.5 text-foreground/80">
                    {importSources[state.format].formatHint}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          <input
            ref={files}
            type="file"
            multiple
            className="hidden"
            data-testid="note-import-files"
            accept={state.format === "notion" ? ".md,.markdown,.csv,.zip" : state.format === "siyuan" ? ".md,.markdown,.zip" : state.format === "flomo" ? ".html,.htm,.zip" : state.format === "evernote" ? ".enex,.zip,.notes" : state.format === "joplin" ? ".zip,.jex" : ".zip"}
            onChange={event => selectFiles(event.currentTarget, false)}
          />
          <input
            ref={directory}
            type="file"
            multiple
            className="hidden"
            data-testid="note-import-directory"
            {...{ webkitdirectory: "", directory: "" }}
            onChange={event => selectFiles(event.currentTarget, true)}
          />

          {state.phase === "scanning" ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-muted/20 py-10 px-6 text-center" role="status">
              <LoaderCircle className="size-8 animate-spin text-primary" />
              <p className="mt-3 text-sm font-medium text-foreground">{t("noteImport.scanning")}</p>
              <p className="mt-1 max-w-md truncate font-mono text-xs text-muted-foreground" title={state.scanningPath}>
                {state.scanningPath}
              </p>
            </div>
          ) : null}

          {summary ? (
            <dl className="grid grid-cols-3 gap-3 rounded-xl border border-border/60 bg-muted/30 p-4 text-center">
              {([ ["notebooks", summary.notebooks], ["notes", summary.notes], ["resources", summary.resources] ] as const).map(([label, count]) => (
                <div key={label} className="space-y-1">
                  <dd className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">{count.toLocaleString()}</dd>
                  <dt className="text-xs text-muted-foreground">{t(`noteImport.${label}`)}</dt>
                </div>
              ))}
            </dl>
          ) : null}

          {state.phase === "ready" ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">{t("noteImport.destination")}</label>
                <Select value={state.parentId || "__root"} onValueChange={value => controller.setParent(value === "__root" ? "" : value)}>
                  <SelectTrigger aria-label={t("noteImport.destination")} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__root">{t("noteImport.topLevel")}</SelectItem>
                    {state.destinations.map(notebook => (
                      <SelectItem value={notebook.id} key={notebook.id}>
                        {destinationPath(notebook)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("noteImport.folderPreview")}</span>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border/70 bg-card p-3">
                  <ul className="space-y-1.5 text-sm" aria-label={t("noteImport.folderPreview")}>
                    {state.folders.map(folder => (
                      <li
                        key={folder.key}
                        className="flex items-center gap-2 break-all text-xs text-foreground/90"
                        style={{ paddingInlineStart: Math.min(folderDepth(folder.key), 10) * 14 }}
                      >
                        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                        {folder.name}
                      </li>
                    ))}
                  </ul>
                  {summary && state.folders.length < summary.notebooks ? (
                    <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => void controller.more("notebook")}>
                      {t("noteImport.more")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {state.phase === "running" && state.progress ? (
            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-foreground">{t(`noteImport.phases.${state.progress.phase}`)}</span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {state.progress.unit === "bytes"
                    ? `${(state.progress.completed / 1048576).toFixed(1)} / ${(state.progress.total / 1048576).toFixed(1)} MiB`
                    : `${state.progress.completed} / ${state.progress.total}`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={state.progress.total} aria-valuenow={state.progress.completed}>
                <div
                  className="h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${state.progress.total ? (state.progress.completed / state.progress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="truncate font-mono text-xs text-muted-foreground" title={state.progress.path}>
                {state.progress.path}
              </p>
            </div>
          ) : null}

          {state.phase === "ready" && state.issues.length > 0 ? (
            <details className="rounded-xl border border-border/70 bg-card p-3" open={Boolean(summary && summary.errors > 0)}>
              <summary className="cursor-pointer text-xs font-medium text-foreground/80 hover:text-foreground">
                {t("noteImport.issueCounts", { errors: summary?.errors ?? 0, warnings: summary?.warnings ?? 0 })}
              </summary>
              <ul className="mt-3 space-y-2.5 text-xs">
                {state.issues.map(issue => (
                  <li key={issue.key} className="break-words space-y-0.5">
                    <p className={issue.severity === "error" ? "font-medium text-destructive" : "text-muted-foreground"}>
                      {issueText(issue)}
                    </p>
                    <p className="break-all font-mono text-[11px] text-muted-foreground/80">
                      {issue.path}
                      {issue.detail && issue.code !== "ignoredTags" ? ` · ${issue.detail}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              {summary && state.issues.length < summary.errors + summary.warnings ? (
                <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => void controller.more("issue")}>
                  {t("noteImport.more")}
                </Button>
              ) : null}
            </details>
          ) : null}

          {state.outcome ? (
            <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-4" role="status">
              <p className="flex items-center gap-2 text-sm font-medium">
                {state.outcome.completed === summary?.notes ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <TriangleAlert className="size-4 text-amber-600" />
                )}
                {t(
                  state.outcome.cancelled
                    ? "noteImport.cancelled"
                    : state.outcome.completed === summary?.notes
                      ? "noteImport.complete"
                      : "noteImport.incomplete",
                  { completed: state.outcome.completed, total: summary?.notes ?? 0 }
                )}
              </p>
              {state.outcome.syncPending ? <p className="text-xs text-amber-700">{t("noteImport.syncPending")}</p> : null}
              {failure && !state.results.some(result => result.key === failure.key) ? (
                <p className="break-all text-xs text-destructive">
                  {failure.path} · {errorText(failure.uncertain ? "uncertainResource" : failure.message)}
                </p>
              ) : null}
            </div>
          ) : null}

          {state.error ? (
            <p className="break-words text-xs text-destructive" role="alert">
              {errorText(state.error)}
            </p>
          ) : null}

          {state.phase === "finished" && state.results.length ? (
            <div className="max-h-60 overflow-y-auto space-y-2 rounded-xl border border-border/70 bg-card p-3 text-xs">
              {state.results.map(result => (
                <div key={result.key} className="flex items-start justify-between gap-3 border-b border-border/40 pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="break-all font-medium text-foreground">{result.path}</p>
                    {!result.complete ? (
                      <p className="text-destructive">{errorText(result.uncertain ? "uncertainResource" : result.error ?? "incomplete")}</p>
                    ) : null}
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs px-2" onClick={() => openResult(result.memo.id, result.memo.notebookId)}>
                    {t("noteImport.openNote")}
                  </Button>
                </div>
              ))}
              {state.results.length < state.resultCount ? (
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => void controller.more("result")}>
                  {t("noteImport.more")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between border-t border-border/40 pt-3">
          <Button asChild variant="ghost" size="sm" className="px-0 text-muted-foreground hover:text-foreground">
            <a href={EVERNOTE_MIGRATION_BLOG_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1 size-3.5" />
              {t("noteImport.guide")}
            </a>
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={busy ? controller.cancel : controller.dismiss}>
              {t(busy ? "noteImport.cancel" : "noteImport.close")}
            </Button>
            {state.phase === "ready" ? (
              <Button size="sm" disabled={!summary?.notes || summary.errors > 0} onClick={controller.run}>
                {t("noteImport.confirm")}
              </Button>
            ) : null}
            {state.phase === "finished" && summary && !summary.errors ? (
              <>
                {(state.outcome?.completed ?? 0) < summary.notes ? (
                  <Button size="sm" onClick={controller.run}>
                    {t("noteImport.retry")}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => void controller.restart()}>
                  {t("noteImport.another")}
                </Button>
              </>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
