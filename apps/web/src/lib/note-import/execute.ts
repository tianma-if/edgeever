import { ApiRequestError, type createEdgeEverClient } from "@edgeever/client";
import { DEFAULT_MEMO_TITLE, createMemoLinkHref, type MemoDetail } from "@edgeever/shared";
import { IMPORT_DESTINATION_RESULT_KEY, MARKDOWN_DESTINATION_REQUIRED, type ImportIndex, type ImportNotebook, type ImportNote, type ImportNoteResult, type ImportReader, type ImportRunResult, type ImportIssue } from "@edgeever/shared/note-import/types";
import { indexItems } from "../../../../../packages/shared/src/note-import/index-store";
import { findImportReferences, rewriteImportMarkdown } from "../../../../../packages/shared/src/note-import/references";
import { resourceLinkToMarkdown } from "../../../../../packages/shared/src/resource-links";
import { escapeImportText } from "../../../../../packages/shared/src/note-import/metadata";

export type ImportProgress = { phase: "folders" | "notes" | "resources" | "links" | "refresh"; path: string; completed: number; total: number; unit?: "bytes" };
type ImportClient = Pick<ReturnType<typeof createEdgeEverClient>, "getImportCapabilities" | "listNotebooks" | "createNotebook" | "importMemos" | "uploadMemoResourceParts" | "getMemo" | "createMemoEditSession" | "updateMemo">;
type FolderResult = { id?: string; uncertain?: boolean };
const statusOf = (error: unknown) => typeof error === "object" && error && "status" in error ? Number(error.status) : undefined;
const conflict = () => new Error("importConflict");
const isMemoEditConflict = (error: unknown) => error instanceof Error && (
  error.message === "importConflict" ||
  error instanceof ApiRequestError && (error.code === "revision_conflict" || error.code === "edit_session_conflict")
);
const sameBase = (a: ImportNoteResult["memo"], b: ImportNoteResult["memo"]) => a.revision === b.revision && a.contentHash === b.contentHash;
const memoBaseline = ({ id, notebookId, revision, contentHash, createdAt, updatedAt }: MemoDetail): ImportNoteResult["memo"] => ({ id, notebookId, revision, contentHash, createdAt, updatedAt });
const intendedWriteApplied = (state: ImportNoteResult, current: MemoDetail) =>
  state.intendedMarkdown !== undefined && current.contentMarkdown === state.intendedMarkdown
  && current.createdAt === state.memo.createdAt && current.updatedAt === state.memo.updatedAt;

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
  if (capabilities.protocolVersion !== 1 || !capabilities.formats.includes(reader.format)) throw new Error("unsupportedImportServer");
  if (reader.format === "markdown" && !input.parentId && await index.get("alias", MARKDOWN_DESTINATION_REQUIRED)) throw new Error("chooseMarkdownDestination");
  if (input.parentId && !(await client.listNotebooks()).notebooks.some(nb => nb.id === input.parentId)) throw new Error("missingParent");
  let boundDestination = await index.get<{ id: string | null }>("folderResult", IMPORT_DESTINATION_RESULT_KEY);
  if (boundDestination && boundDestination.id !== (input.parentId ?? null)) throw new Error("destinationChanged");
  const bindDestination = async () => {
    if (boundDestination) return;
    const destination = { id: input.parentId ?? null };
    await index.put("folderResult", IMPORT_DESTINATION_RESULT_KEY, destination);
    boundDestination = destination;
  };
  if (reader.format !== "markdown") await bindDestination();
  const folders = await index.count("notebook");
  let foldersDone = 0;
  const ensureFolder = async (key: string): Promise<string> => {
    signal?.throwIfAborted();
    if (!key && reader.format === "markdown" && input.parentId) return input.parentId;
    const resultKey = `folder:${key}`;
    const existing = await index.get<FolderResult>("folderResult", resultKey);
    if (existing?.uncertain) throw new Error("uncertainNotebook");
    if (existing?.id) return existing.id;
    const folder = await index.get<ImportNotebook>("notebook", key);
    if (!folder) throw new Error("missingNotebook");
    const parentId = folder.parentKey ? await ensureFolder(folder.parentKey) : input.parentId;
    await bindDestination();
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
  const saveMarkdown = async (state: ImportNoteResult, current: MemoDetail, markdown: string, beforeWrite: () => void) => {
    if (markdown === current.contentMarkdown) return;
    const { editSession } = await client.createMemoEditSession(state.memo.id);
    if (editSession.baseRevision !== state.memo.revision || editSession.baseContentHash !== state.memo.contentHash) throw conflict();
    state.intendedMarkdown = markdown;
    await index.put("result", state.key, state);
    signal?.throwIfAborted();
    beforeWrite();
    const updated = await client.updateMemo(state.memo.id, {
      contentMarkdown: markdown, expectedRevision: state.memo.revision,
      expectedContentHash: state.memo.contentHash, editSessionId: editSession.id,
      createdAt: state.memo.createdAt, updatedAt: state.memo.updatedAt,
    });
    state.memo = memoBaseline(updated.memo);
  };
  const recordCompletion = async (state: ImportNoteResult, linksPending: boolean) => {
    const finishedState = {
      ...state, complete: !linksPending, linksPending: linksPending || undefined,
      error: undefined, uncertain: false, intendedMarkdown: undefined,
    };
    await index.put("result", state.key, finishedState);
    Object.assign(state, finishedState);
    if (finishedState.complete) {
      result.completed++;
      result.resources += Object.keys(state.urls).length;
    }
  };
  let notesProcessed = 0;
  try {
    release = await input.pauseSync?.();
    for await (const folder of indexItems<ImportNotebook>(index, "notebook")) {
      onProgress?.({ phase: "folders", path: folder.key || folder.name, completed: foldersDone, total: folders });
      await ensureFolder(folder.key); foldersDone++;
    }
    for await (const descriptor of indexItems<ImportNote>(index, "note")) {
      signal?.throwIfAborted();
      let state = await index.get<ImportNoteResult>("result", descriptor.key);
      if (state?.complete) { result.completed++; result.resources += Object.keys(state.urls).length; notesProcessed++; continue; }
      if (state?.linksPending) { notesProcessed++; continue; }
      let priorUncertainty = state?.uncertain ?? false;
      let note = descriptor;
      let uploadCompleting = false;
      let createAttempted = false;
      let createBodyRejected = false;
      let finalAttempted = false;
      try {
        onProgress?.({ phase: "notes", path: descriptor.path, completed: notesProcessed, total });
        signal?.throwIfAborted();
        const doc = await reader.readNote(descriptor.key, signal);
        note = doc.note;
        const linksPending = note.references?.some(ref => ref.noteKey !== undefined) ?? false;
        let original = doc.enml !== undefined ? input.convertEnml(doc.enml, note.resources) : doc.contentMarkdown;
        if (doc.enml !== undefined) {
          for (const resource of note.resources) if (!original.includes(`evernote-resource:${resource.hash}`)) {
            original += `\n\n${resourceLinkToMarkdown(resource.filename.replace(/[\r\n]+/g, " "), `evernote-resource:${resource.hash}`)}`;
          }
          for (const resource of note.skippedResources ?? []) {
            original += `\n\n${escapeImportText(`[Attachment not imported: ${resource.filename} (${resource.hash}, ${resource.byteSize} bytes)]`)}`;
          }
          if (note.originalTitle) original = `# ${escapeImportText(note.originalTitle)}\n\n${original}`;
        }
        onProgress?.({ phase: "notes", path: note.path, completed: notesProcessed, total });
        signal?.throwIfAborted();
        if (!state) {
          const notebookId = await ensureFolder(note.notebookKey);
          await bindDestination();
          createAttempted = true; writesStarted = true;
          const imported = await client.importMemos({ importId: reader.id, format: reader.format, notebookId, items: [{ externalId: note.key, title: note.title, tags: note.tags, contentMarkdown: original, createdAt: note.createdAt, updatedAt: note.updatedAt }] });
          const item = imported.results[0];
          if (!item?.memo || item.status === "failed") {
            createBodyRejected = item?.status === "failed" && /^D1_ERROR:.*\bSQLITE_TOOBIG\b/.test(item.error ?? "");
            throw new Error(createBodyRejected ? "noteBodyTooLarge" : item?.error || "createFailed");
          }
          if (item.status === "skipped" && (item.memo.contentMarkdown !== original || item.memo.title !== (note.title.trim() || DEFAULT_MEMO_TITLE) || JSON.stringify(item.memo.tags) !== JSON.stringify(note.tags))) throw conflict();
          state = { key: note.key, path: note.path, memo: memoBaseline(item.memo), urls: {}, complete: false };
          await index.put("result", note.key, state);
        }
        if (state.uncertain && !state.intendedMarkdown) throw new Error("uncertainResource");
        // Linked notes without uploads can defer the revision read to the link update.
        const current = !linksPending || note.resources.length ? (await client.getMemo(state.memo.id)).memo : undefined;
        priorUncertainty = false;
        if (current && !sameBase(current, state.memo)) {
          if (intendedWriteApplied(state, current)) {
            state.memo = memoBaseline(current);
            await recordCompletion(state, false);
            notesProcessed++;
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
        if (!linksPending && current) {
          const references = doc.enml !== undefined ? findImportReferences(original).map(ref => ({ ...ref, resourceKey: note.resources.find(resource => `evernote-resource:${resource.hash}` === ref.href)?.key })) : note.references ?? [];
          await saveMarkdown(state, current, rewriteImportMarkdown(original, references, state.urls), () => { finalAttempted = true; });
        }
        await recordCompletion(state, linksPending);
        notesProcessed++;
        onProgress?.({ phase: "notes", path: note.path, completed: notesProcessed, total });
      } catch (error) {
        if (!signal?.aborted || state || createAttempted) result.failed++;
        if (state) {
          state.error = signal?.aborted ? "incomplete" : error instanceof Error ? error.message : String(error);
          state.uncertain = priorUncertainty || (uploadCompleting || finalAttempted) && (statusOf(error) === undefined || statusOf(error)! >= 500);
          await index.put("result", note.key, state);
          result.failure = { key: note.key, path: note.path, message: state.error, uncertain: state.uncertain ?? false };
        }
        if (!state && (!signal?.aborted || createAttempted)) {
          result.failure = {
            key: note.key, path: note.path,
            message: signal?.aborted ? "incomplete" : error instanceof Error ? error.message : String(error),
            uncertain: createAttempted && !createBodyRejected && statusOf(error) === undefined,
          };
        }
        if (signal?.aborted) result.cancelled = true;
        // A failed note is not a successful import; retain the rest unstarted.
        break;
      } finally { await reader.releaseNote(note); }
    }
    if (reader.format === "markdown" && !result.cancelled) {
      for await (const note of indexItems<ImportNote>(index, "note")) {
        signal?.throwIfAborted();
        const references = note.references ?? [];
        const targets = new Set(references.flatMap(ref => ref.noteKey ? [ref.noteKey] : []));
        if (!targets.size) continue;
        const state = await index.get<ImportNoteResult>("result", note.key);
        if (!state?.linksPending) continue;
        const links = new Map<string, string>();
        for (const key of targets) {
          const target = await index.get<ImportNoteResult>("result", key);
          if (target?.complete || target?.linksPending) links.set(key, createMemoLinkHref(target.memo.id));
        }
        let writeAttempted = false;
        let uncertain = state.uncertain ?? false;
        try {
          onProgress?.({ phase: "links", path: note.path, completed: result.completed, total });
          signal?.throwIfAborted();
          const current = (await client.getMemo(state.memo.id)).memo;
          if (!sameBase(current, state.memo) && !intendedWriteApplied(state, current)) throw conflict();
          state.memo = memoBaseline(current);
          uncertain = false;
          const { contentMarkdown } = await reader.readNote(note.key, signal);
          const rewritten = rewriteImportMarkdown(contentMarkdown, references, state.urls, links);
          await saveMarkdown(state, current, rewritten, () => { writesStarted = true; writeAttempted = true; });
          await recordCompletion(state, links.size !== targets.size);
          onProgress?.({ phase: "links", path: note.path, completed: result.completed, total });
        } catch (error) {
          const editConflict = isMemoEditConflict(error);
          state.error = signal?.aborted ? "incomplete" : editConflict ? "importConflict" : error instanceof Error ? error.message : String(error);
          state.uncertain = uncertain || writeAttempted && (statusOf(error) === undefined || statusOf(error)! >= 500);
          await index.put("result", note.key, state);
          if (signal?.aborted) throw error;
          result.failed++;
          result.failure ??= { key: note.key, path: note.path, message: state.error, uncertain: state.uncertain };
          if (!editConflict) break;
        }
      }
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
