import { BACKUP_TABLE_ROW_BATCH, EDGEEVER_ZIP_FORMAT, EDGEEVER_ZIP_FORMAT_VERSION, EDGEEVER_TABLE_ZIP_FORMAT_VERSION, JsonBackupManifestSchema, JsonBackupAiPromptSchema, JsonBackupMemoSchema, JsonBackupNotebookSchema, JsonBackupRevisionSchema, type BackupTableChangesPage, type BackupTablePage, type BackupTableRestoreSnapshot, type BackupTableRestoreStart, type BackupTableRow, type BackupTableSnapshot, type JsonBackupManifest, type JsonBackupAiPrompt, type JsonBackupMemo, type JsonBackupNotebook, type JsonBackupResource, type JsonBackupRevision } from "./backup";
import type { MemoDetail, Notebook, Resource } from "./types";
import { Reader, ZipReader, ZipWriter, Uint8ArrayReader, Uint8ArrayWriter, type CreateReadableOptions } from "@zip.js/zip.js/index-native.js";
import { buildMarkdownFrontMatter, buildNoteMarkdown, buildNotebookExportPaths, encodeRelativePath, getExportResourceExtension, replaceExportResourceUrl, sanitizeExportPathSegment, uniqueExportName } from "./backup-markdown";
import { createClientUuid } from "./client-id";
import { parseTableDocumentJson, tableAttachmentUrl, tableMarkdownHeader, tableMarkdownRow } from "./table";
const strToU8 = (value: string) => new TextEncoder().encode(value);
const strFromU8 = (value: Uint8Array) => new TextDecoder().decode(value);
const ZIP_MIME_TYPE = "application/zip";
const ZIP_ENTRY_CHUNK_BYTES = 1024 * 1024;

export type EdgeEverZipProgress = {
  completed: number;
  total: number;
};

export type EdgeEverZipImportErrorCode =
  | "invalidZip"
  | "missingManifest"
  | "unsupportedFormat"
  | "unsupportedVersion"
  | "invalidManifest"
  | "missingData"
  | "invalidData"
  | "incompleteData"
  | "incompleteResources";

export class EdgeEverZipImportError extends Error {
  code: EdgeEverZipImportErrorCode;

  constructor(code: EdgeEverZipImportErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = "EdgeEverZipImportError";
    this.code = code;
  }
}

type JsonBackupPage = {
  memos: MemoDetail[];
  resources: Resource[];
  revisions: JsonBackupRevision[];
  totalCount?: number;
  nextOffset: number | null;
  nextCursor?: string | null;
  tableChunks?: boolean;
  tableHistoryDeltas?: boolean;
  memosWithHistory?: string[];
};

export type JsonBackupSource = {
  listNotebooks: () => Promise<{ notebooks: Notebook[] }>;
  onManifest?: (manifest: JsonBackupManifest) => void;
  resourceOrigin?: string;
  signal?: AbortSignal;
  getPage: (offset: number, limit: number, cursor?: string) => Promise<JsonBackupPage>;
  getResourceResponse?: (resourceUrl: string) => Promise<Response>;
  getResourceBlob?: (resourceUrl: string) => Promise<Blob>;
  listPrompts: () => Promise<{ prompts: JsonBackupAiPrompt[] }>;
  readRevisions?: (memoId: string, after: string) => Promise<{ revisions: JsonBackupRevision[]; nextCursor: string | null }>;
  readTable?: (memoId: string, revisionId: string | null, after: string, versions?: [number, number][]) => Promise<BackupTablePage>;
  readTableChanges?: (memoId: string, revisionId: string, after: string) => Promise<BackupTableChangesPage>;
  verifyVersion?: () => Promise<unknown>;
};

export const createBackupTableReaders = (read: <T>(query: Record<string, string>) => Promise<T>) => ({
  readTable: (memoId: string, revisionId: string | null, after: string, versions?: [number, number][]) =>
    read<BackupTablePage>({ kind: "table", memoId, after, ...(revisionId === null ? {} : { revisionId }),
      ...(versions === undefined ? {} : { versions: JSON.stringify(versions) }) }),
  readTableChanges: (memoId: string, revisionId: string, after: string) =>
    read<BackupTableChangesPage>({ kind: "tableChanges", memoId, revisionId, after }),
});

type JsonResourceRestoreSink = {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<unknown>;
  abort: () => Promise<void>;
};

type JsonRestoreTarget = {
  restoreNotebooks: (notebooks: JsonBackupNotebook[]) => Promise<unknown>;
  restoreMemos: (memos: JsonBackupMemo[]) => Promise<unknown>;
  createResourceRestoreSink: (
    resourceId: string,
    metadata: JsonBackupResource,
  ) => Promise<JsonResourceRestoreSink>;
  restorePrompts: (prompts: JsonBackupAiPrompt[]) => Promise<unknown>;
  tableRestore?: {
    check: () => Promise<unknown>;
    start: (input: BackupTableRestoreStart) => Promise<unknown>;
    snapshot: (restoreId: string, snapshot: BackupTableRestoreSnapshot) => Promise<unknown>;
    rows: (restoreId: string, ordinal: number, rows: BackupTableRow[]) => Promise<unknown>;
    publish: (restoreId: string) => Promise<unknown>;
    cancel: (restoreId: string) => Promise<unknown>;
  };
};

export type ParsedEdgeEverZip = {
  manifest: JsonBackupManifest;
  notebooks: JsonBackupNotebook[];
  memos: JsonBackupMemo[];
  prompts: JsonBackupAiPrompt[];
  archive: Blob;
  tableSnapshots?: Map<string, ArchivedTableSnapshot[]>;
};

type ArchivedTableSnapshot = BackupTableSnapshot & { rowPaths: string[] };
const tablePath = (memoId: string, revisionId: string | null) =>
  `tables/${encodeURIComponent(memoId)}/${revisionId === null ? "current" : `r-${encodeURIComponent(revisionId)}`}/`;
const revisionPath = (memoId: string, revisionId: string) => `revisions/${encodeURIComponent(memoId)}/${encodeURIComponent(revisionId)}.json`;


type ZipEntryConsumer = {
  write?: (chunk: Uint8Array) => void | Promise<void>;
  close?: () => void | Promise<void>;
};


const jsonBytes = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);
const toBackupNotebook = (notebook: Notebook): JsonBackupNotebook => ({
  id: notebook.id, parentId: notebook.parentId, name: notebook.name, slug: notebook.slug,
  icon: notebook.icon, color: notebook.color, textColor: notebook.textColor ?? null,
  colorTarget: notebook.colorTarget ?? "icon", isBold: notebook.isBold ?? false,
  iconInverted: notebook.iconInverted ?? false, rowInverted: notebook.rowInverted ?? false,
  sortOrder: notebook.sortOrder,
  createdAt: notebook.createdAt, updatedAt: notebook.updatedAt,
});

const collectBackupRevisions = async (read: NonNullable<JsonBackupSource["readRevisions"]>, memoId: string) => {
  const revisions: JsonBackupRevision[] = [];
  let after: string | null = "";
  while (after !== null) {
    const page = await read(memoId, after);
    if (page.nextCursor === after) throw new EdgeEverZipImportError("incompleteData");
    revisions.push(...page.revisions);
    after = page.nextCursor;
  }
  return revisions.sort((a, b) => a.revision - b.revision || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
};

async function* readTableSnapshotPages(
  read: NonNullable<JsonBackupSource["readTable"]>,
  memoId: string, revisionId: string | null,
) {
  let rowCount: number | undefined;
  let count = 0;
  let after: string | null = "";
  while (after !== null) {
    const page = await read(memoId, revisionId, after);
    rowCount ??= page.rowCount;
    if (page.nextCursor === after || rowCount !== page.rowCount || page.rows.length > BACKUP_TABLE_ROW_BATCH) {
      throw new EdgeEverZipImportError("incompleteData");
    }
    count += page.rows.length;
    yield page;
    after = page.nextCursor;
  }
  if (count !== rowCount) throw new EdgeEverZipImportError("incompleteData");
}

async function* readTableChanges(
  read: NonNullable<JsonBackupSource["readTableChanges"]>, memoId: string, lastRevisionId: string,
) {
  let after: string | null = "";
  while (after !== null) {
    const page = await read(memoId, lastRevisionId, after);
    if (after === page.nextCursor) throw new EdgeEverZipImportError("incompleteData");
    yield* page.changes;
    after = page.nextCursor;
  }
}

function historicalTablePages(
  read: NonNullable<JsonBackupSource["readTable"]>, readChanges: NonNullable<JsonBackupSource["readTableChanges"]>,
  memoId: string, lastRevisionId: string,
) {
  const changes = readTableChanges(readChanges, memoId, lastRevisionId);
  const live = new Map<string, [number, number]>();
  let next: Awaited<ReturnType<typeof changes.next>> | undefined;
  return async function* (revision: JsonBackupRevision) {
    next ??= await changes.next();
    while (!next.done && next.value.revision <= revision.sharedTableRevision!) {
      const change = next.value;
      if (change.deleted) live.delete(change.id);
      else live.set(change.id, [change.revision, change.position]);
      next = await changes.next();
    }
    // Cache only live references. Fetch the cells for one ZIP entry at a time.
    const entries = live.entries();
    let delivered = 0;
    do {
      const ids: string[] = [];
      const versions: [number, number][] = [];
      while (versions.length < BACKUP_TABLE_ROW_BATCH) {
        const entry = entries.next();
        if (entry.done) break;
        ids.push(entry.value[0]);
        versions.push(entry.value[1]);
      }
      const page = await read(memoId, revision.id, "", versions);
      if (page.rowCount !== live.size || page.rows.length !== ids.length ||
          page.rows.some((row, index) => row.id !== ids[index] || row.position !== versions[index][1])) {
        throw new EdgeEverZipImportError("incompleteData");
      }
      delivered += page.rows.length;
      yield page;
    } while (delivered < live.size);
  };
}

const writeTableSnapshot = async (
  pages: AsyncIterable<BackupTablePage>, add: (path: string, value: unknown) => Promise<unknown>,
  memoId: string, revisionId: string | null,
) => {
  const path = tablePath(memoId, revisionId);
  let snapshot: BackupTableSnapshot | undefined;
  let index = 0;
  for await (const page of pages) {
    snapshot ??= { revisionId, header: page.header, rowCount: page.rowCount };
    if (page.rows.length) {
      await add(`${path}${String(index++).padStart(6, "0")}.json`, page.rows);
    }
  }
  await add(`${path}snapshot.json`, snapshot);
};

const streamTableMarkdown = (
  read: NonNullable<JsonBackupSource["readTable"]>, memo: MemoDetail,
  notebookPath: string, attachmentPaths: Map<string, string>,
) => {
  const pages = readTableSnapshotPages(read, memo.id, null);
  const attachmentUrl = (resourceId: string) => {
    const url = tableAttachmentUrl(resourceId);
    return attachmentPaths.get(url) ?? url;
  };
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await pages.next();
      if (next.done) {
        controller.close();
        return;
      }
      const { header, rows } = next.value;
      if (!started) {
        controller.enqueue(strToU8(buildMarkdownFrontMatter(memo, notebookPath) + tableMarkdownHeader(header)));
        started = true;
      }
      for (const row of rows) controller.enqueue(strToU8("\n" + tableMarkdownRow(header, row, attachmentUrl)));
    },
    async cancel() { await pages.return(); },
  });
};

export const createEdgeEverZipStream = async (
  source: JsonBackupSource,
  version: { edgeeverVersion: string; buildId: string },
  onProgress?: (progress: EdgeEverZipProgress) => void,
) => {
  const [{ notebooks }, { prompts }] = await Promise.all([source.listNotebooks(), source.listPrompts()]);
  const output = new TransformStream<Uint8Array, Uint8Array>();
  const reader = output.readable.getReader();
  const abort = new AbortController();
  const forwardAbort = () => abort.abort(source.signal?.reason);
  if (source.signal?.aborted) forwardAbort();
  else source.signal?.addEventListener("abort", forwardAbort, { once: true });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    async pull(value) {
      try {
        const chunk = await reader.read();
        if (chunk.done) value.close();
        else value.enqueue(chunk.value);
      } catch (error) { value.error(error); }
    },
    async cancel(reason) { abort.abort(reason); await reader.cancel(reason); },
  });
  const zip = new ZipWriter(output.writable, { useWebWorkers: false, level: 6 });
  const addJson = (path: string, value: unknown) => zip.add(path, new Uint8ArrayReader(jsonBytes(value)), { signal: abort.signal });
  const notebookPaths = buildNotebookExportPaths(notebooks);
  const memoNamesByNotebook = new Map<string, Set<string>>();
  void (async () => {
    try {
      const backupNotebooks = notebooks.map(toBackupNotebook);
      await addJson("notebooks.json", backupNotebooks);
      await addJson("prompts.json", prompts);
      let offset = 0;
      let cursor: string | undefined;
      let completed = 0;
      let total = 0;
      let revisionCount = 0;
      let resourceCount = 0;
      let hasTableChunks = false;
      while (true) {
        abort.signal.throwIfAborted();
        const page = await source.getPage(offset, 25, cursor);
        total = page.totalCount ?? Math.max(total, completed + page.memos.length);
        onProgress?.({ completed, total });
        for (const memo of page.memos) {
          const notebookPath = notebookPaths.get(memo.notebookId) ?? "Unfiled";
          const usedNames = memoNamesByNotebook.get(notebookPath) ?? new Set<string>();
          memoNamesByNotebook.set(notebookPath, usedNames);
          const stem = uniqueExportName(sanitizeExportPathSegment(memo.title?.trim() || "Untitled note", "Untitled note"), usedNames);
          const directory = `notes/${notebookPath}`;
          const assets = `${stem}.assets`;
          const resourceNames = new Set<string>();
          let markdown = memo.contentMarkdown;
          const revisions = page.tableChunks && source.readRevisions && (page.memosWithHistory?.includes(memo.id) ?? true)
            ? await collectBackupRevisions(source.readRevisions, memo.id)
            : page.revisions.filter((item) => item.memoId === memo.id);
          const chunked = page.tableChunks && (memo.sharedTableRevision != null || revisions.some((item) => item.sharedTableRevision != null));
          if (chunked) {
            const readTable = source.readTable;
            if (!readTable) throw new EdgeEverZipImportError("incompleteData");
            hasTableChunks = true;
            for (const revision of revisions) {
              await addJson(revisionPath(memo.id, revision.id), revision);
            }
            const history = revisions.filter(revision => revision.sharedTableRevision != null)
              .sort((a, b) => a.sharedTableRevision! - b.sharedTableRevision!);
            const last = history.at(-1);
            const historyPages = last && page.tableHistoryDeltas && source.readTableChanges
              ? historicalTablePages(readTable, source.readTableChanges, memo.id, last.id) : undefined;
            for (const revision of history) {
              const pages = historyPages ? historyPages(revision) : readTableSnapshotPages(readTable, memo.id, revision.id);
              await writeTableSnapshot(pages, addJson, memo.id, revision.id);
            }
            if (memo.sharedTableRevision != null) {
              await writeTableSnapshot(readTableSnapshotPages(readTable, memo.id, null), addJson, memo.id, null);
            }
          }
          const resources: JsonBackupResource[] = [];
          const attachmentPaths = new Map<string, string>();
          const currentTable = chunked && memo.sharedTableRevision != null;
          for (const resource of page.resources.filter((item) => item.memoId === memo.id)) {
            const fallback = `${resource.kind}-${resource.id}.${getExportResourceExtension(resource)}`;
            const filename = uniqueExportName(sanitizeExportPathSegment(resource.filename || fallback, fallback), resourceNames);
            const relative = `${assets}/${filename}`;
            const archivePath = `${directory}/${relative}`;
            const response = source.getResourceResponse
              ? await source.getResourceResponse(resource.url)
              : new Response(await source.getResourceBlob!(resource.url));
            if (!response.ok) throw new Error(`Resource download failed (${response.status})`);
            // Declaring the known size keeps small streams compatible with ordinary ZIP.
            await zip.add(archivePath, { readable: response.body ?? new Blob().stream(), size: resource.byteSize }, { level: 0, signal: abort.signal });
            const { url: _url, ...metadata } = resource;
            resources.push({ ...metadata, archivePath });
            if (currentTable) attachmentPaths.set(resource.url, encodeRelativePath(relative));
            else markdown = replaceExportResourceUrl(markdown, resource.url, relative, source.resourceOrigin);
            resourceCount++;
          }
          await addJson(`memos/${memo.id}.json`, { memo, revisions: chunked ? [] : revisions, resources });
          const readable = currentTable
            ? { readable: streamTableMarkdown(source.readTable!, memo, notebookPath, attachmentPaths) }
            : new Uint8ArrayReader(strToU8(buildNoteMarkdown(markdown, memo, notebookPath)));
          await zip.add(`${directory}/${stem}.md`, readable, { signal: abort.signal });
          revisionCount += revisions.length;
          completed++;
          onProgress?.({ completed, total });
        }
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
        cursor = page.nextCursor ?? undefined;
      }
      await source.verifyVersion?.();
      const manifest: JsonBackupManifest = {
        format: EDGEEVER_ZIP_FORMAT, formatVersion: hasTableChunks ? EDGEEVER_TABLE_ZIP_FORMAT_VERSION : EDGEEVER_ZIP_FORMAT_VERSION, schemaVersion: 1,
        ...version, exportedAt: new Date().toISOString(), includesTrash: false,
        counts: { notebooks: backupNotebooks.length, memos: source.onManifest ? completed : total, revisions: revisionCount, resources: resourceCount, prompts: prompts.length },
      };
      source.onManifest?.(manifest);
      await addJson("manifest.json", manifest);
      await zip.close();
    } catch (error) {
      controller.error(error);
      abort.abort(error);
      await reader.cancel(error).catch(() => {});
    } finally { source.signal?.removeEventListener("abort", forwardAbort); }
  })().catch(() => {});
  return readable;
};

export const createEdgeEverZip = async (
  source: JsonBackupSource,
  version: { edgeeverVersion: string; buildId: string },
  onProgress?: (progress: EdgeEverZipProgress) => void,
) => new Response(await createEdgeEverZipStream(source, version, onProgress), { headers: { "Content-Type": ZIP_MIME_TYPE } }).blob();

const rejectInvalidZip = (error?: unknown): never => {
  if (error instanceof EdgeEverZipImportError) throw error;
  throw new EdgeEverZipImportError("invalidZip", error);
};

class ArchiveRangeReader extends Reader<Blob> {
  constructor(private archive: Blob) { super(archive); this.size = archive.size; }
  override createReadable(options: CreateReadableOptions = {}) {
    return super.createReadable({ ...options, chunkSize: ZIP_ENTRY_CHUNK_BYTES });
  }
  override async readUint8Array(offset: number, length: number) {
    if (offset < 0 || length < 0 || !Number.isSafeInteger(offset + length)) return rejectInvalidZip();
    const chunks: Uint8Array[] = [];
    const end = Math.min(this.size, offset + length);
    for (let start = offset; start < end; start += ZIP_ENTRY_CHUNK_BYTES) {
      chunks.push(new Uint8Array(await this.archive.slice(start, Math.min(end, start + ZIP_ENTRY_CHUNK_BYTES)).arrayBuffer()));
    }
    return concatZipChunks(chunks, end - offset);
  }
}

export const streamZipEntries = async (
  blob: Blob,
  onEntry: (file: { name: string }) => ZipEntryConsumer | undefined,
  onInputProgress?: (completedBytes: number) => void,
) => {
  const reader = new ZipReader(new ArchiveRangeReader(blob), { useWebWorkers: false, checkCrc32: true, filenameValidation: "strict" });
  try {
    const entries = await reader.getEntries().catch(rejectInvalidZip);
    const seen = new Set<string>();
    const total = entries.reduce((count, entry) => count + entry.uncompressedSize, 0);
    let completed = 0;
    for (const entry of entries) {
      if (seen.has(entry.filename) || entry.encrypted) rejectInvalidZip();
      seen.add(entry.filename);
      const consumer = onEntry({ name: entry.filename });
      if (!consumer) continue;
      if (!entry.directory) {
        let consumerFailed = false;
        let consumerError: unknown;
        try {
          await entry.getData(new WritableStream<Uint8Array>({
            async write(chunk) {
              try {
                await consumer.write?.(chunk);
                completed += chunk.byteLength;
                onInputProgress?.(total ? Math.min(blob.size, completed / total * blob.size) : blob.size);
              } catch (error) {
                consumerFailed = true; consumerError = error; throw error;
              }
            },
          }), { checkCrc32: true });
        } catch (error) {
          if (consumerFailed) throw consumerError;
          rejectInvalidZip(error);
        }
      }
      await consumer.close?.();
    }
    onInputProgress?.(blob.size);
  } finally { await reader.close(); }
};
const MAX_ZIP_METADATA_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 1024 * 1024 * 1024;
const MAX_RESTORED_IMAGE_BYTES = 100 * 1024 * 1024;
// The server builds search projections only for current rows. Smaller requests
// keep that work proportional to payload size for wide long-text tables.
const CURRENT_RESTORE_BATCH_BYTES = 256 * 1024;

const memoEntry = /^memos\/[^/]+\.json$/;
const revisionEntry = /^revisions\/[^/]+\/[^/]+\.json$/;
const tableSnapshotEntry = /^tables\/[^/]+\/[^/]+\/snapshot\.json$/;
const tableRowsEntry = /^(tables\/[^/]+\/[^/]+\/)\d{6}\.json$/;

const isStructuredZipEntry = (path: string) => path === "manifest.json"
  || path === "notebooks.json"
  || path === "prompts.json"
  || memoEntry.test(path) || revisionEntry.test(path) || tableSnapshotEntry.test(path) || tableRowsEntry.test(path);

const parseTableRows = (bytes: Uint8Array): BackupTableRow[] => {
  try {
    const rows = JSON.parse(strFromU8(bytes)) as BackupTableRow[];
    if (!Array.isArray(rows) || !rows.length || rows.length > BACKUP_TABLE_ROW_BATCH || rows.some((row) =>
      !row || typeof row.id !== "string" || row.id.length < 1 || row.id.length > 80 || !Number.isSafeInteger(row.position) || row.position < 1 ||
      !row.cells || typeof row.cells !== "object" || Array.isArray(row.cells))) throw new Error("Invalid table row chunk");
    return rows;
  } catch (error) {
    throw new EdgeEverZipImportError("invalidData", error);
  }
};

const concatZipChunks = (chunks: Uint8Array[], total: number) => {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export type ArchiveDigestFactory = () => { update: (chunk: Uint8Array) => void; digest: () => string };

const scanEdgeEverZip = async (blob: Blob, onProgress?: (percentage: number) => void, createDigest?: ArchiveDigestFactory) => {
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const signatureValue = signature.length === 4
    ? signature[0] | (signature[1] << 8) | (signature[2] << 16) | (signature[3] << 24)
    : 0;
  if (signatureValue !== 0x04034b50 && signatureValue !== 0x06054b50) {
    throw new EdgeEverZipImportError("invalidZip");
  }
  const entrySizes = new Map<string, number>();
  const structuredEntries = new Map<string, Uint8Array>();
  const rowGroups = new Map<string, { paths: string[]; ids: Set<string>; positions: Set<number> }>();
  const digests = new Map<string, string>();
  let lastPercentage = -1;

  await streamZipEntries(blob, (file) => {
    if (entrySizes.has(file.name)) {
      throw new EdgeEverZipImportError("invalidZip", new Error(`Duplicate ZIP entry: ${file.name}`));
    }
    entrySizes.set(file.name, -1);
    const structured = isStructuredZipEntry(file.name);
    const rowGroup = tableRowsEntry.exec(file.name)?.[1];
    const digest = !structured ? createDigest?.() : undefined;
    const chunks: Uint8Array[] = [];
    let byteSize = 0;
    return {
      write(chunk) {
        byteSize += chunk.byteLength;
        const limit = structured ? MAX_ZIP_METADATA_ENTRY_BYTES : MAX_ZIP_ENTRY_BYTES;
        if (byteSize > limit) {
          throw new EdgeEverZipImportError(structured ? "invalidData" : "incompleteResources");
        }
        digest?.update(chunk);
        if (structured) {
          const copy = new Uint8Array(chunk.byteLength);
          copy.set(chunk);
          chunks.push(copy);
        }
      },
      close() {
        entrySizes.set(file.name, byteSize);
        if (rowGroup) {
          const group = rowGroups.get(rowGroup) ?? { paths: [], ids: new Set<string>(), positions: new Set<number>() };
          for (const { id, position } of parseTableRows(concatZipChunks(chunks, byteSize))) {
            if (group.ids.has(id) || group.positions.has(position)) {
              throw new EdgeEverZipImportError("invalidData");
            }
            group.ids.add(id);
            group.positions.add(position);
          }
          group.paths.push(file.name);
          rowGroups.set(rowGroup, group);
        } else if (structured) structuredEntries.set(file.name, concatZipChunks(chunks, byteSize));
        if (digest) digests.set(file.name, digest.digest());
      },
    };
  }, (completedBytes) => {
    const percentage = blob.size > 0 ? Math.min(100, Math.round((completedBytes / blob.size) * 100)) : 100;
    if (percentage !== lastPercentage) {
      lastPercentage = percentage;
      onProgress?.(percentage);
    }
  });

  return { entrySizes, structuredEntries, digests, rowGroups };
};

const parseJsonEntry = (
  entries: Map<string, Uint8Array>,
  path: string,
  missingCode: EdgeEverZipImportErrorCode = "missingData",
) => {
  const data = entries.get(path);
  if (!data) throw new EdgeEverZipImportError(missingCode);
  try {
    return JSON.parse(strFromU8(data)) as unknown;
  } catch (error) {
    throw new EdgeEverZipImportError(path === "manifest.json" ? "invalidManifest" : "invalidData", error);
  }
};

const sortNotebooksForRestore = (notebooks: JsonBackupNotebook[]) => {
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  const depth = (notebook: JsonBackupNotebook, seen = new Set<string>()): number => {
    if (!notebook.parentId || !byId.has(notebook.parentId) || seen.has(notebook.id)) {
      return 0;
    }
    seen.add(notebook.id);
    return 1 + depth(byId.get(notebook.parentId)!, seen);
  };
  return [...notebooks].sort((left, right) => depth(left) - depth(right));
};

export const parseEdgeEverZip = async (
  blob: Blob,
  onProgress?: (percentage: number) => void,
  createDigest?: ArchiveDigestFactory,
): Promise<ParsedEdgeEverZip> => {
  const { entrySizes, structuredEntries, digests, rowGroups } = await scanEdgeEverZip(blob, onProgress, createDigest);
  const manifestValue = parseJsonEntry(structuredEntries, "manifest.json", "missingManifest");
  if (!manifestValue || typeof manifestValue !== "object") {
    throw new EdgeEverZipImportError("invalidManifest");
  }
  const manifestRecord = manifestValue as Record<string, unknown>;
  if (manifestRecord.format !== EDGEEVER_ZIP_FORMAT) {
    throw new EdgeEverZipImportError("unsupportedFormat");
  }
  if (manifestRecord.formatVersion !== 1 && manifestRecord.formatVersion !== EDGEEVER_ZIP_FORMAT_VERSION && manifestRecord.formatVersion !== EDGEEVER_TABLE_ZIP_FORMAT_VERSION) {
    throw new EdgeEverZipImportError("unsupportedVersion");
  }
  const manifestResult = JsonBackupManifestSchema.safeParse(manifestValue);
  if (!manifestResult.success) {
    throw new EdgeEverZipImportError("invalidManifest", manifestResult.error);
  }
  const manifest = manifestResult.data;
  const notebooksValue = parseJsonEntry(structuredEntries, "notebooks.json");
  if (!Array.isArray(notebooksValue)) {
    throw new EdgeEverZipImportError("invalidData");
  }
  const notebooksResult = JsonBackupNotebookSchema.array().safeParse(notebooksValue);
  if (!notebooksResult.success) {
    throw new EdgeEverZipImportError("invalidData", notebooksResult.error);
  }
  const notebooks = sortNotebooksForRestore(notebooksResult.data);
  const promptsValue = manifest.formatVersion >= 2
    ? parseJsonEntry(structuredEntries, "prompts.json")
    : [];
  const promptsResult = JsonBackupAiPromptSchema.array().safeParse(promptsValue);
  if (!promptsResult.success) {
    throw new EdgeEverZipImportError("invalidData", promptsResult.error);
  }
  const prompts = promptsResult.data as JsonBackupAiPrompt[];
  const memoPaths = [...structuredEntries.keys()].filter((path) => memoEntry.test(path)).sort();
  const memos: JsonBackupMemo[] = [];
  for (const path of memoPaths) {
    const memoResult = JsonBackupMemoSchema.safeParse(parseJsonEntry(structuredEntries, path));
    if (!memoResult.success) {
      throw new EdgeEverZipImportError("invalidData", memoResult.error);
    }
    memos.push(memoResult.data as JsonBackupMemo);
  }
  const tableSnapshots = new Map<string, ArchivedTableSnapshot[]>();
  if (manifest.formatVersion === EDGEEVER_TABLE_ZIP_FORMAT_VERSION) {
    const memosById = new Map(memos.map((item) => [item.memo.id, item]));
    const looseRevisions = new Map<string, JsonBackupRevision[]>();
    for (const path of structuredEntries.keys()) {
      if (!revisionEntry.test(path)) continue;
      const parsed = JsonBackupRevisionSchema.safeParse(parseJsonEntry(structuredEntries, path));
      if (!parsed.success) throw new EdgeEverZipImportError("invalidData", parsed.error);
      const revision = parsed.data as JsonBackupRevision;
      if (!memosById.has(revision.memoId) || path !== revisionPath(revision.memoId, revision.id)) throw new EdgeEverZipImportError("invalidData");
      const list = looseRevisions.get(revision.memoId) ?? [];
      list.push(revision);
      looseRevisions.set(revision.memoId, list);
    }
    const usedPaths = new Set<string>();
    for (const { memo, revisions } of memos) {
      const loose = looseRevisions.get(memo.id);
      if (loose && revisions.length) throw new EdgeEverZipImportError("invalidData");
      if (loose) revisions.push(...loose.sort((a, b) => a.revision - b.revision || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
      const refs = revisions.filter((revision) => revision.sharedTableRevision != null).map((revision) => revision.id as string | null);
      if (memo.sharedTableRevision != null) refs.push(null);
      if (!refs.length) continue;
      const snapshots = refs.map((revisionId) => {
        const base = tablePath(memo.id, revisionId);
        const path = `${base}snapshot.json`;
        if (usedPaths.has(path)) throw new EdgeEverZipImportError("invalidData");
        usedPaths.add(path);
        const value = parseJsonEntry(structuredEntries, path) as BackupTableSnapshot | null;
        const header = parseTableDocumentJson(JSON.stringify(value?.header), true);
        const group = rowGroups.get(base);
        if (!value || value.revisionId !== revisionId || !header || header.records.length || value.rowCount !== (group?.ids.size ?? 0)) {
          throw new EdgeEverZipImportError("incompleteData");
        }
        rowGroups.delete(base);
        return { revisionId, header, rowCount: value.rowCount, rowPaths: group?.paths.sort() ?? [] };
      });
      tableSnapshots.set(memo.id, snapshots);
    }
    if (rowGroups.size || [...structuredEntries.keys()].some((path) => tableSnapshotEntry.test(path) && !usedPaths.has(path)) || !tableSnapshots.size) {
      throw new EdgeEverZipImportError("invalidData");
    }
  }
  const resources = memos.flatMap((memo) => memo.resources);
  const resourcePaths = new Set(resources.map((resource) => resource.archivePath));
  // Markdown attachments live under notes/ too. Only count readable note copies,
  // excluding the exact resource paths recorded in the recovery metadata.
  const markdownCount = [...entrySizes.keys()].filter((path) => (
    /^notes\/.+\.md$/.test(path) && !resourcePaths.has(path)
  )).length;

  if (
    manifest.counts.notebooks !== notebooks.length
    || manifest.counts.memos !== memos.length
    || manifest.counts.memos !== markdownCount
    || (manifest.counts.prompts ?? 0) !== prompts.length
  ) {
    throw new EdgeEverZipImportError("incompleteData");
  }

  const revisionCount = memos.reduce((count, memo) => count + memo.revisions.length, 0);
  if (manifest.counts.revisions !== revisionCount) {
    throw new EdgeEverZipImportError("incompleteData");
  }
  if (
    manifest.counts.resources !== resources.length
    || resourcePaths.size !== resources.length
    || resources.some((resource) => (
      resource.byteSize <= 0
      || resource.byteSize > (resource.kind === "image" ? MAX_RESTORED_IMAGE_BYTES : MAX_ZIP_ENTRY_BYTES)
      || isStructuredZipEntry(resource.archivePath)
      || entrySizes.get(resource.archivePath) !== resource.byteSize
      || (createDigest && resource.sha256 !== null && resource.sha256 !== digests.get(resource.archivePath))
    ))
  ) {
    throw new EdgeEverZipImportError("incompleteResources");
  }

  return { manifest, notebooks, memos, prompts, archive: blob, ...(tableSnapshots.size ? { tableSnapshots } : {}) };
};

/** The new desktop path validates relationships before any target write. */
export const validateBackupRelationships = (backup: ParsedEdgeEverZip) => {
  const notebooks = new Map(backup.notebooks.map((item) => [item.id, item]));
  const memos = new Set(backup.memos.map((item) => item.memo.id));
  const revisions = new Set<string>();
  const resources = new Set<string>();
  const invalid = () => { throw new EdgeEverZipImportError("invalidData"); };
  if (notebooks.size !== backup.notebooks.length || memos.size !== backup.memos.length) invalid();
  for (const notebook of backup.notebooks) {
    const ancestors = new Set([notebook.id]);
    let parent = notebook.parentId;
    while (parent) {
      if (ancestors.has(parent) || !notebooks.has(parent)) invalid();
      ancestors.add(parent);
      parent = notebooks.get(parent)!.parentId;
    }
  }
  for (const item of backup.memos) {
    if (!notebooks.has(item.memo.notebookId)) invalid();
    for (const revision of item.revisions) {
      if (revision.memoId !== item.memo.id || revisions.has(revision.id)) invalid();
      revisions.add(revision.id);
    }
    for (const resource of item.resources) {
      if (resource.memoId !== item.memo.id || resources.has(resource.id)) invalid();
      resources.add(resource.id);
    }
  }
};

const restoreBackupMemos = async (backup: ParsedEdgeEverZip, target: JsonRestoreTarget, done: (count: number) => void) => {
  const reader = backup.tableSnapshots?.size
    ? new ZipReader(new ArchiveRangeReader(backup.archive), { useWebWorkers: false, checkCrc32: true, filenameValidation: "strict" })
    : null;
  try {
    const entries = new Map((await reader?.getEntries() ?? []).map((entry) => [entry.filename, entry]));
    let normal: JsonBackupMemo[] = [];
    let normalBytes = 0;
    const flush = async () => {
      if (!normal.length) return;
      await target.restoreMemos(normal);
      done(normal.length);
      normal = [];
      normalBytes = 0;
    };
    for (const item of backup.memos) {
      const tables = backup.tableSnapshots?.get(item.memo.id);
      if (!tables) {
        const bytes = strToU8(JSON.stringify(item)).length + 1;
        if (normal.length && normalBytes + bytes > MAX_ZIP_METADATA_ENTRY_BYTES) await flush();
        normal.push(item);
        normalBytes += bytes;
        if (normal.length === 10) await flush();
        continue;
      }
      await flush();
      const restore = target.tableRestore!;
      const restoreId = createClientUuid();
      const snapshots = [...item.revisions, null];
      const byRevision = new Map(tables.map((table) => [table.revisionId, table]));
      try {
        await restore.start({ restoreId, memo: item.memo, snapshots: snapshots.length });
        for (const [ordinal, revision] of snapshots.entries()) {
          const table = byRevision.get(revision?.id ?? null);
          await restore.snapshot(restoreId, { ordinal, revision, table: table ? { header: table.header, rowCount: table.rowCount } : null });
          for (const path of table?.rowPaths ?? []) {
            const entry = entries.get(path);
            if (!entry || entry.directory || entry.uncompressedSize > MAX_ZIP_METADATA_ENTRY_BYTES) throw new EdgeEverZipImportError("incompleteData");
            const bytes = await entry.getData(new Uint8ArrayWriter(), { checkCrc32: true });
              const rows = parseTableRows(bytes);
              if (revision || bytes.byteLength <= CURRENT_RESTORE_BATCH_BYTES) {
                await restore.rows(restoreId, ordinal, rows);
                continue;
              }
              let batch: BackupTableRow[] = [];
              let batchBytes = 0;
              for (const row of rows) {
                const size = strToU8(JSON.stringify(row)).byteLength + 1;
                if (batch.length && batchBytes + size > CURRENT_RESTORE_BATCH_BYTES) {
                  await restore.rows(restoreId, ordinal, batch);
                  batch = [];
                  batchBytes = 0;
                }
                batch.push(row);
                batchBytes += size;
              }
              if (batch.length) await restore.rows(restoreId, ordinal, batch);
          }
        }
        await restore.publish(restoreId);
      } catch (error) {
        await restore.cancel(restoreId).catch(() => {});
        throw error;
      }
      done(1);
    }
    await flush();
  } finally {
    await reader?.close();
  }
};

export const restoreEdgeEverZip = async (
  backup: ParsedEdgeEverZip,
  target: JsonRestoreTarget,
  onProgress?: (progress: EdgeEverZipProgress) => void
) => {
  if (backup.tableSnapshots?.size) {
    if (!target.tableRestore) throw new EdgeEverZipImportError("unsupportedVersion");
    // Check the target before restoring prompts, notebooks, or memos.
    validateBackupRelationships(backup);
    await target.tableRestore.check();
  }
  const total = backup.notebooks.length
    + backup.memos.length
    + backup.prompts.length
    + backup.manifest.counts.resources;
  let completed = 0;
  onProgress?.({ completed, total });

  for (let index = 0; index < backup.prompts.length; index += 100) {
    const batch = backup.prompts.slice(index, index + 100);
    await target.restorePrompts(batch);
    completed += batch.length;
    onProgress?.({ completed, total });
  }

  for (let index = 0; index < backup.notebooks.length; index += 100) {
    const batch = backup.notebooks.slice(index, index + 100);
    await target.restoreNotebooks(batch);
    completed += batch.length;
    onProgress?.({ completed, total });
  }

  const increment = (count: number) => { completed += count; onProgress?.({ completed, total }); };
  await restoreBackupMemos(backup, target, increment);

  const resourcesByPath = new Map(
    backup.memos.flatMap((memo) => memo.resources).map((resource) => [resource.archivePath, resource]),
  );
  if (!resourcesByPath.size) return;
  const restoredPaths = new Set<string>();
  const activeSinks = new Set<JsonResourceRestoreSink>();
  try {
    await streamZipEntries(backup.archive, (file) => {
      const resource = resourcesByPath.get(file.name);
      if (!resource) return;
      let sinkPromise: Promise<JsonResourceRestoreSink> | undefined;
      // Start only when awaited: disk reads can otherwise outlive a fast rejection.
      const getSink = () => sinkPromise ??= target.createResourceRestoreSink(resource.id, resource);
      let byteSize = 0;
      return {
        async write(chunk) {
          byteSize += chunk.byteLength;
          if (byteSize > resource.byteSize) {
            const sink = await getSink();
            await sink.abort();
            throw new EdgeEverZipImportError("incompleteResources");
          }
          const sink = await getSink();
          activeSinks.add(sink);
          await sink.write(chunk);
        },
        async close() {
          const sink = await getSink();
          activeSinks.add(sink);
          if (byteSize !== resource.byteSize) {
            await sink.abort();
            activeSinks.delete(sink);
            throw new EdgeEverZipImportError("incompleteResources");
          }
          await sink.close();
          activeSinks.delete(sink);
          restoredPaths.add(file.name);
          completed += 1;
          onProgress?.({ completed, total });
        },
      };
    });
  } catch (error) {
    await Promise.all([...activeSinks].map((sink) => sink.abort().catch(() => undefined)));
    throw error;
  }
  if (restoredPaths.size !== resourcesByPath.size) {
    throw new EdgeEverZipImportError("incompleteResources");
  }
};

export const restoreEdgeEverZipAndRefresh = async (
  backup: ParsedEdgeEverZip,
  target: JsonRestoreTarget,
  refreshWorkspace: () => Promise<void>,
  onProgress?: (progress: EdgeEverZipProgress) => void
) => {
  await restoreEdgeEverZip(backup, target, onProgress);
  await refreshWorkspace();
};
