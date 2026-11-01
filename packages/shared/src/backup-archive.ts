import { EDGEEVER_ZIP_FORMAT, EDGEEVER_ZIP_FORMAT_VERSION, JsonBackupManifestSchema, JsonBackupAiPromptSchema, JsonBackupMemoSchema, JsonBackupNotebookSchema, type JsonBackupManifest, type JsonBackupAiPrompt, type JsonBackupMemo, type JsonBackupNotebook, type JsonBackupResource, type JsonBackupRevision } from "./backup";
import type { MemoDetail, Notebook, Resource } from "./types";
import { Reader, ZipReader, ZipWriter, Uint8ArrayReader, type CreateReadableOptions } from "@zip.js/zip.js/index-native.js";
import { buildNoteMarkdown, buildNotebookExportPaths, getExportResourceExtension, replaceExportResourceUrl, sanitizeExportPathSegment, uniqueExportName } from "./backup-markdown";
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
};

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
};

export type ParsedEdgeEverZip = {
  manifest: JsonBackupManifest;
  notebooks: JsonBackupNotebook[];
  memos: JsonBackupMemo[];
  prompts: JsonBackupAiPrompt[];
  archive: Blob;
};


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
          const resources: JsonBackupResource[] = [];
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
            markdown = replaceExportResourceUrl(markdown, resource.url, relative, source.resourceOrigin);
            resourceCount++;
          }
          const revisions = page.revisions.filter((item) => item.memoId === memo.id);
          await addJson(`memos/${memo.id}.json`, { memo, revisions, resources });
          await zip.add(`${directory}/${stem}.md`, new Uint8ArrayReader(strToU8(buildNoteMarkdown(markdown, memo, notebookPath))), { signal: abort.signal });
          revisionCount += revisions.length;
          completed++;
          onProgress?.({ completed, total });
        }
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
        cursor = page.nextCursor ?? undefined;
      }
      const manifest: JsonBackupManifest = {
        format: EDGEEVER_ZIP_FORMAT, formatVersion: EDGEEVER_ZIP_FORMAT_VERSION, schemaVersion: 1,
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
  onEntry: (file: { name: string }) => ZipEntryConsumer,
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

const isStructuredZipEntry = (path: string) => path === "manifest.json"
  || path === "notebooks.json"
  || path === "prompts.json"
  || /^memos\/[^/]+\.json$/.test(path);

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
  const digests = new Map<string, string>();
  let lastPercentage = -1;

  await streamZipEntries(blob, (file) => {
    if (entrySizes.has(file.name)) {
      throw new EdgeEverZipImportError("invalidZip", new Error(`Duplicate ZIP entry: ${file.name}`));
    }
    entrySizes.set(file.name, -1);
    const structured = isStructuredZipEntry(file.name);
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
        if (structured) structuredEntries.set(file.name, concatZipChunks(chunks, byteSize));
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

  return { entrySizes, structuredEntries, digests };
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
  const { entrySizes, structuredEntries, digests } = await scanEdgeEverZip(blob, onProgress, createDigest);
  const manifestValue = parseJsonEntry(structuredEntries, "manifest.json", "missingManifest");
  if (!manifestValue || typeof manifestValue !== "object") {
    throw new EdgeEverZipImportError("invalidManifest");
  }
  const manifestRecord = manifestValue as Record<string, unknown>;
  if (manifestRecord.format !== EDGEEVER_ZIP_FORMAT) {
    throw new EdgeEverZipImportError("unsupportedFormat");
  }
  if (manifestRecord.formatVersion !== 1 && manifestRecord.formatVersion !== EDGEEVER_ZIP_FORMAT_VERSION) {
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
  const memoPaths = [...structuredEntries.keys()].filter((path) => /^memos\/[^/]+\.json$/.test(path)).sort();
  const memos: JsonBackupMemo[] = [];
  for (const path of memoPaths) {
    const memoResult = JsonBackupMemoSchema.safeParse(parseJsonEntry(structuredEntries, path));
    if (!memoResult.success) {
      throw new EdgeEverZipImportError("invalidData", memoResult.error);
    }
    memos.push(memoResult.data as JsonBackupMemo);
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

  return { manifest, notebooks, memos, prompts, archive: blob };
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

export const restoreEdgeEverZip = async (
  backup: ParsedEdgeEverZip,
  target: JsonRestoreTarget,
  onProgress?: (progress: EdgeEverZipProgress) => void
) => {
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

  for (let index = 0; index < backup.memos.length; index += 10) {
    const batch = backup.memos.slice(index, index + 10);
    await target.restoreMemos(batch);
    completed += batch.length;
    onProgress?.({ completed, total });
  }

  const resourcesByPath = new Map(
    backup.memos.flatMap((memo) => memo.resources).map((resource) => [resource.archivePath, resource]),
  );
  const restoredPaths = new Set<string>();
  const activeSinks = new Set<JsonResourceRestoreSink>();
  try {
    await streamZipEntries(backup.archive, (file) => {
      const resource = resourcesByPath.get(file.name);
      if (!resource) return {};
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
