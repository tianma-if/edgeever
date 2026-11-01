import type { createEdgeEverClient } from "@edgeever/client";
import { DEFAULT_MEMO_TITLE, type MemoDetail } from "@edgeever/shared";
import type { ImportIndex, ImportNotebook, ImportNote, ImportNoteResult, ImportReader, ImportRunResult, ImportIssue } from "@edgeever/shared/note-import/types";
import { indexItems } from "../../../../../packages/shared/src/note-import/index-store";
import { findImportReferences, rewriteImportMarkdown } from "../../../../../packages/shared/src/note-import/references";
import { resourceLinkToMarkdown } from "../../../../../packages/shared/src/resource-links";

export type ImportProgress = { phase: "folders" | "notes" | "resources" | "refresh"; path: string; completed: number; total: number; unit?: "bytes" };
type ImportClient = Pick<ReturnType<typeof createEdgeEverClient>, "getImportCapabilities" | "listNotebooks" | "createNotebook" | "importMemos" | "uploadMemoResourceParts" | "getMemo" | "createMemoEditSession" | "updateMemo">;
type FolderResult = { id?: string; uncertain?: boolean };
const statusOf = (error: unknown) => typeof error === "object" && error && "status" in error ? Number(error.status) : undefined;
const conflict = () => new Error("importConflict");
const sameBase = (a: ImportNoteResult["memo"], b: ImportNoteResult["memo"]) => a.revision === b.revision && a.contentHash === b.contentHash;
const memoBaseline = ({ id, notebookId, revision, contentHash, createdAt, updatedAt }: MemoDetail): ImportNoteResult["memo"] => ({ id, notebookId, revision, contentHash, createdAt, updatedAt });

export const executeNoteImport = async (input: {
  reader: ImportReader; index: ImportIndex; client: ImportClient;
  parentId?: string | null; signal?: AbortSignal;
  convertEnml: (source: string, resources?: ImportNote["resources"]) => string;
  pauseSync?: () => Promise<() => void>; refresh?: () => Promise<void>;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<ImportRunResult> => {
  const { reader, index, client, signal, onProgress } = input;
  const result: ImportRunResult = { completed: 0, failed: 0, resources: 0, cancelled: false, syncPending: false };
  let release: (() => void) | undefined;
  let writesStarted = false;
  for await (const issue of indexItems<ImportIssue>(index, "issue")) if (issue.severity === "error") throw new Error("preflightErrors");
  const total = await index.count("note");
  signal?.throwIfAborted();
  const capabilities = await client.getImportCapabilities();
  if (capabilities.protocolVersion !== 1) throw new Error("unsupportedImportServer");
  if (input.parentId && !(await client.listNotebooks()).notebooks.some(nb => nb.id === input.parentId)) throw new Error("missingParent");
  const createdParent = await index.get<{ id: string | null }>("folderResult", "__destination");
  if (createdParent && createdParent.id !== (input.parentId ?? null)) throw new Error("destinationChanged");
  await index.put("folderResult", "__destination", { id: input.parentId ?? null });
  const folders = await index.count("notebook");
  let foldersDone = 0;
  const ensureFolder = async (key: string): Promise<string> => {
    signal?.throwIfAborted();
    const resultKey = `folder:${key}`;
    const existing = await index.get<FolderResult>("folderResult", resultKey);
    if (existing?.uncertain) throw new Error("uncertainNotebook");
    if (existing?.id) return existing.id;
    const folder = await index.get<ImportNotebook>("notebook", key);
    if (!folder) throw new Error("missingNotebook");
    const parentId = folder.parentKey ? await ensureFolder(folder.parentKey) : input.parentId;
    await index.put<FolderResult>("folderResult", resultKey, { uncertain: true });
    try {
      writesStarted = true;
      const { notebook } = await client.createNotebook({ name: folder.name, parentId });
      await index.put<FolderResult>("folderResult", resultKey, { id: notebook.id });
      return notebook.id;
    } catch (error) {
      if (statusOf(error) !== undefined && statusOf(error)! < 500) await index.remove("folderResult", resultKey);
      throw error;
    }
  };
  try {
    release = await input.pauseSync?.();
    for await (const folder of indexItems<ImportNotebook>(index, "notebook")) {
      onProgress?.({ phase: "folders", path: folder.key, completed: foldersDone, total: folders });
      await ensureFolder(folder.key); foldersDone++;
    }
    for await (const descriptor of indexItems<ImportNote>(index, "note")) {
      signal?.throwIfAborted();
      let state = await index.get<ImportNoteResult>("result", descriptor.key);
      if (state?.complete) { result.completed++; result.resources += Object.keys(state.urls).length; continue; }
      let priorUncertainty = state?.uncertain ?? false;
      let note = descriptor;
      let uploadCompleting = false;
      let createAttempted = false;
      let finalAttempted = false;
      try {
        onProgress?.({ phase: "notes", path: descriptor.path, completed: result.completed, total });
        signal?.throwIfAborted();
        const doc = await reader.readNote(descriptor.key, signal);
        note = doc.note;
        let original = doc.enml !== undefined ? input.convertEnml(doc.enml, note.resources) : doc.contentMarkdown;
        if (doc.enml !== undefined) {
          for (const resource of note.resources) if (!original.includes(`evernote-resource:${resource.hash}`)) {
            original += `\n\n${resourceLinkToMarkdown(resource.filename.replace(/[\r\n]+/g, " "), `evernote-resource:${resource.hash}`)}`;
          }
        }
        onProgress?.({ phase: "notes", path: note.path, completed: result.completed, total });
        signal?.throwIfAborted();
        if (!state) {
          const notebookId = await ensureFolder(note.notebookKey);
          createAttempted = true; writesStarted = true;
          const imported = await client.importMemos({ importId: reader.id, format: reader.format, notebookId, items: [{ externalId: note.key, title: note.title, tags: note.tags, contentMarkdown: original, createdAt: note.createdAt, updatedAt: note.updatedAt }] });
          const item = imported.results[0];
          if (!item?.memo || item.status === "failed") throw new Error(item?.error || "createFailed");
          if (item.status === "skipped" && (item.memo.contentMarkdown !== original || item.memo.title !== (note.title.trim() || DEFAULT_MEMO_TITLE) || JSON.stringify(item.memo.tags) !== JSON.stringify(note.tags))) throw conflict();
          state = { key: note.key, path: note.path, memo: memoBaseline(item.memo), urls: {}, complete: false };
          await index.put("result", note.key, state);
        }
        if (state.uncertain && !state.intendedMarkdown) throw new Error("uncertainResource");
        const current = (await client.getMemo(state.memo.id)).memo;
        priorUncertainty = false;
        if (!sameBase(current, state.memo)) {
          if (state.intendedMarkdown !== undefined && current.contentMarkdown === state.intendedMarkdown && current.createdAt === state.memo.createdAt && current.updatedAt === state.memo.updatedAt) {
            state.memo = memoBaseline(current); state.complete = true; state.error = undefined; state.uncertain = false; state.intendedMarkdown = undefined;
            await index.put("result", note.key, state); result.completed++; result.resources += Object.keys(state.urls).length;
            continue;
          }
          throw conflict();
        }
        for (const resource of note.resources) {
          signal?.throwIfAborted();
          if (Object.hasOwn(state.urls, resource.key)) continue;
          onProgress?.({ phase: "resources", path: `${note.path} / ${resource.filename}`, completed: Object.keys(state.urls).length, total: note.resources.length });
          uploadCompleting = false;
          const resourceState = state;
          const uploaded = await client.uploadMemoResourceParts(state.memo.id, {
            filename: resource.filename, mimeType: resource.mimeType, byteSize: resource.byteSize,
            readPart: (start, end) => reader.readResourcePart(resource, start, end, signal),
            onBeforeComplete: async () => {
              resourceState.uncertain = true;
              await index.put("result", note.key, resourceState);
              uploadCompleting = true;
            },
            onPartUploaded: bytes => onProgress?.({ phase: "resources", path: `${note.path} / ${resource.filename}`, completed: bytes, total: resource.byteSize, unit: "bytes" }),
          });
          Object.defineProperty(state.urls, resource.key, { value: uploaded.resource.url, enumerable: true, configurable: true, writable: true });
          state.uncertain = false;
          await index.put("result", note.key, state); uploadCompleting = false;
        }
        signal?.throwIfAborted();
        const references = doc.enml !== undefined ? findImportReferences(original).map(ref => ({ ...ref, resourceKey: note.resources.find(resource => `evernote-resource:${resource.hash}` === ref.href)?.key })) : note.references ?? [];
        const markdown = rewriteImportMarkdown(original, references, state.urls);
        if (markdown !== current.contentMarkdown) {
          const { editSession } = await client.createMemoEditSession(state.memo.id);
          if (editSession.baseRevision !== state.memo.revision || editSession.baseContentHash !== state.memo.contentHash) throw conflict();
          state.intendedMarkdown = markdown;
          await index.put("result", note.key, state);
          finalAttempted = true;
          const updated = await client.updateMemo(state.memo.id, { contentMarkdown: markdown, expectedRevision: state.memo.revision, expectedContentHash: state.memo.contentHash, editSessionId: editSession.id, createdAt: state.memo.createdAt, updatedAt: state.memo.updatedAt });
          state.memo = memoBaseline(updated.memo);
        }
        state.complete = true; state.error = undefined; state.uncertain = false; state.intendedMarkdown = undefined;
        await index.put("result", note.key, state);
        result.completed++; result.resources += Object.keys(state.urls).length;
        onProgress?.({ phase: "notes", path: note.path, completed: result.completed, total });
      } catch (error) {
        if (!signal?.aborted || state || createAttempted) result.failed++;
        if (state) {
          state.error = signal?.aborted ? "incomplete" : error instanceof Error ? error.message : String(error);
          state.uncertain = priorUncertainty || (uploadCompleting || finalAttempted) && (statusOf(error) === undefined || statusOf(error)! >= 500);
          await index.put("result", note.key, state);
          result.failure = { key: note.key, path: note.path, message: state.error, uncertain: state.uncertain ?? false };
        }
        if (!state && (!signal?.aborted || createAttempted)) result.failure = { key: note.key, path: note.path, message: signal?.aborted ? "incomplete" : error instanceof Error ? error.message : String(error), uncertain: createAttempted && statusOf(error) === undefined };
        if (signal?.aborted) result.cancelled = true;
        // A failed note is not a successful import; retain the rest unstarted.
        break;
      } finally { await reader.releaseNote(note); }
    }
  } catch (error) {
    if (signal?.aborted) result.cancelled = true;
    else throw error;
  } finally {
    release?.();
    try { await reader.finishReading?.(); }
    finally {
      if (writesStarted || result.completed || result.failed) {
        onProgress?.({ phase: "refresh", path: "", completed: result.completed, total });
        try { await input.refresh?.(); } catch { result.syncPending = true; }
      }
    }
  }
  return result;
};
