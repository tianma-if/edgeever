import {
  EDGEEVER_ZIP_FORMAT,
  EDGEEVER_ZIP_FORMAT_VERSION,
  JsonBackupManifestSchema,
  JsonBackupAiPromptSchema,
  JsonBackupMemoSchema,
  JsonBackupNotebookSchema,
  type JsonBackupManifest,
  type JsonBackupAiPrompt,
  type JsonBackupMemo,
  type JsonBackupNotebook,
  type JsonBackupResource,
  type JsonBackupRevision,
  type MemoDetail,
  type Notebook,
  type Resource,
} from "@edgeever/shared";
import {
  strFromU8,
  strToU8,
  Unzip,
  UnzipInflate,
  Zip,
  ZipDeflate,
  ZipPassThrough,
  type UnzipFile,
} from "fflate";
import {
  buildMarkdownFrontMatter,
  buildNotebookExportPaths,
  getExportResourceExtension,
  replaceExportResourceUrl,
  sanitizeExportPathSegment,
  uniqueExportName,
} from "./markdown-export";

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
  totalCount: number;
  nextOffset: number | null;
};

type JsonBackupSource = {
  listNotebooks: () => Promise<{ notebooks: Notebook[] }>;
  getPage: (offset: number, limit: number) => Promise<JsonBackupPage>;
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

const PAGE_SIZE = 25;
const ZIP_MIME_TYPE = "application/zip";
const MAX_BUFFERED_ZIP_BYTES = 128 * 1024 * 1024;
const jsonBytes = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);

const addJsonFile = (zip: Zip, path: string, value: unknown) => {
  const file = new ZipDeflate(path, { level: 6 });
  zip.add(file);
  file.push(jsonBytes(value), true);
};

const streamResourceIntoZip = async (
  source: JsonBackupSource,
  resourceUrl: string,
  file: ZipPassThrough,
  waitForOutputCapacity: () => Promise<void>,
) => {
  if (!source.getResourceResponse && !source.getResourceBlob) {
    throw new Error("A resource response source is required");
  }
  const response = source.getResourceResponse
    ? await source.getResourceResponse(resourceUrl)
    : new Response(await source.getResourceBlob!(resourceUrl));
  if (!response.ok) throw new Error(`Resource download failed (${response.status})`);
  if (!response.body) {
    file.push(new Uint8Array(), true);
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      file.push(next.value, false);
      await waitForOutputCapacity();
    }
    file.push(new Uint8Array(), true);
  } finally {
    reader.releaseLock();
  }
};

const toBackupNotebook = (notebook: Notebook): JsonBackupNotebook => ({
  id: notebook.id,
  parentId: notebook.parentId,
  name: notebook.name,
  slug: notebook.slug,
  icon: notebook.icon,
  color: notebook.color,
  sortOrder: notebook.sortOrder,
  createdAt: notebook.createdAt,
  updatedAt: notebook.updatedAt,
});

export const createEdgeEverZipStream = async (
  source: JsonBackupSource,
  version: { edgeeverVersion: string; buildId: string },
  onProgress?: (progress: EdgeEverZipProgress) => void
) => {
  const [{ notebooks }, { prompts }] = await Promise.all([
    source.listNotebooks(),
    source.listPrompts(),
  ]);
  const notebookPaths = buildNotebookExportPaths(notebooks);
  const memoNamesByNotebook = new Map<string, Set<string>>();
  let zip: Zip | null = null;
  let releaseBackpressure: (() => void) | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const waitForOutputCapacity = () => {
        if ((controller.desiredSize ?? 1) > 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
          releaseBackpressure = resolve;
        });
      };
      zip = new Zip((error, data, final) => {
        if (error) {
          controller.error(error);
          return;
        }
        if (data.byteLength > 0) controller.enqueue(data);
        if (final) controller.close();
      });

      void (async () => {
        try {
        const backupNotebooks = notebooks.map(toBackupNotebook);
        addJsonFile(zip!, "notebooks.json", backupNotebooks);
        addJsonFile(zip!, "prompts.json", prompts);
        let offset = 0;
        let completed = 0;
        let total = 0;
        let revisionCount = 0;
        let resourceCount = 0;

        while (true) {
          const page = await source.getPage(offset, PAGE_SIZE);
          total = page.totalCount;
          onProgress?.({ completed, total });
          const resourcesByMemo = new Map<string, Resource[]>();
          const revisionsByMemo = new Map<string, JsonBackupRevision[]>();

          for (const resource of page.resources) {
            const items = resourcesByMemo.get(resource.memoId) ?? [];
            items.push(resource);
            resourcesByMemo.set(resource.memoId, items);
          }
          for (const revision of page.revisions) {
            const items = revisionsByMemo.get(revision.memoId) ?? [];
            items.push(revision);
            revisionsByMemo.set(revision.memoId, items);
          }

          for (const memo of page.memos) {
            const notebookPath = notebookPaths.get(memo.notebookId) ?? "Unfiled";
            const usedMemoNames = memoNamesByNotebook.get(notebookPath) ?? new Set<string>();
            memoNamesByNotebook.set(notebookPath, usedMemoNames);
            const memoStem = uniqueExportName(
              sanitizeExportPathSegment(memo.title?.trim() || "Untitled note", "Untitled note"),
              usedMemoNames
            );
            const markdownDirectory = `notes/${notebookPath}`;
            const assetDirectory = `${memoStem}.assets`;
            const usedResourceNames = new Set<string>();
            let markdown = memo.contentMarkdown;
            const backupResources: JsonBackupResource[] = [];
            for (const resource of resourcesByMemo.get(memo.id) ?? []) {
              const fallbackName = `${resource.kind}-${resource.id}.${getExportResourceExtension(resource)}`;
              const filename = uniqueExportName(
                sanitizeExportPathSegment(resource.filename || fallbackName, fallbackName),
                usedResourceNames
              );
              const relativePath = `${assetDirectory}/${filename}`;
              const archivePath = `${markdownDirectory}/${relativePath}`;
              const file = new ZipPassThrough(archivePath);
              zip!.add(file);
              await streamResourceIntoZip(source, resource.url, file, waitForOutputCapacity);
              backupResources.push({
                id: resource.id,
                memoId: resource.memoId,
                originalMemoId: resource.originalMemoId,
                kind: resource.kind,
                mimeType: resource.mimeType,
                filename: resource.filename,
                byteSize: resource.byteSize,
                sha256: resource.sha256,
                width: resource.width,
                height: resource.height,
                createdAt: resource.createdAt,
                updatedAt: resource.updatedAt,
                archivePath,
              });
              markdown = replaceExportResourceUrl(markdown, resource.url, relativePath);
              resourceCount += 1;
            }

            const revisions = revisionsByMemo.get(memo.id) ?? [];
            addJsonFile(zip!, `memos/${memo.id}.json`, { memo, revisions, resources: backupResources });
            const markdownFile = new ZipDeflate(`${markdownDirectory}/${memoStem}.md`, { level: 6 });
            zip!.add(markdownFile);
            markdownFile.push(strToU8(`${buildMarkdownFrontMatter(memo, notebookPath)}${markdown}`), true);
            revisionCount += revisions.length;
            completed += 1;
            onProgress?.({ completed, total });
          }

          if (page.nextOffset === null) {
            break;
          }
          offset = page.nextOffset;
        }

        const manifest: JsonBackupManifest = {
          format: EDGEEVER_ZIP_FORMAT,
          formatVersion: EDGEEVER_ZIP_FORMAT_VERSION,
          schemaVersion: 1,
          edgeeverVersion: version.edgeeverVersion,
          buildId: version.buildId,
          exportedAt: new Date().toISOString(),
          includesTrash: false,
          counts: {
            notebooks: backupNotebooks.length,
            memos: total,
            revisions: revisionCount,
            resources: resourceCount,
            prompts: prompts.length,
          },
        };
        addJsonFile(zip!, "manifest.json", manifest);
        zip!.end();
        } catch (error) {
          zip?.terminate();
          controller.error(error);
        }
      })();
    },
    pull() {
      releaseBackpressure?.();
      releaseBackpressure = null;
    },
    cancel() {
      releaseBackpressure?.();
      releaseBackpressure = null;
      zip?.terminate();
    },
  });
};

export const createEdgeEverZip = async (
  source: JsonBackupSource,
  version: { edgeeverVersion: string; buildId: string },
  onProgress?: (progress: EdgeEverZipProgress) => void,
) => new Response(await createEdgeEverZipStream(source, version, onProgress), {
  headers: { "Content-Type": ZIP_MIME_TYPE },
}).blob();

export class EdgeEverZipMemoryLimitError extends Error {
  constructor() {
    super("This backup is too large for an in-memory export. Use a browser that supports streaming file saves.");
    this.name = "EdgeEverZipMemoryLimitError";
  }
}

const bufferedZipBlob = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const chunks: ArrayBuffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BUFFERED_ZIP_BYTES) {
        await reader.cancel();
        throw new EdgeEverZipMemoryLimitError();
      }
      const copy = new Uint8Array(next.value.byteLength);
      copy.set(next.value);
      chunks.push(copy.buffer);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: ZIP_MIME_TYPE });
};

type StreamingFileHandle = {
  createWritable: () => Promise<WritableStream<Uint8Array>>;
  getFile?: () => Promise<File>;
};

export const saveEdgeEverZip = async (
  source: JsonBackupSource,
  version: { edgeeverVersion: string; buildId: string },
  onProgress?: (progress: EdgeEverZipProgress) => void,
) => {
  const filename = `edgeever-export-${new Date().toISOString().slice(0, 10)}.zip`;
  const savePicker = (window as Window & {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<StreamingFileHandle>;
  }).showSaveFilePicker;
  if (savePicker) {
    const handle = await savePicker.call(window, { suggestedName: filename });
    const stream = await createEdgeEverZipStream(source, version, onProgress);
    await stream.pipeTo(await handle.createWritable());
    return { filename, streamed: true as const };
  }

  const stream = await createEdgeEverZipStream(source, version, onProgress);
  downloadEdgeEverZip(await bufferedZipBlob(stream), filename);
  return { filename, streamed: false as const };
};

export const createEdgeEverZipTemporaryFile = async (
  source: JsonBackupSource,
  version: { edgeeverVersion: string; buildId: string },
  onProgress?: (progress: EdgeEverZipProgress) => void,
) => {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<{
      getFileHandle: (name: string, options: { create: true }) => Promise<StreamingFileHandle>;
      removeEntry: (name: string) => Promise<void>;
    }>;
  };
  if (!storage.getDirectory) {
    const stream = await createEdgeEverZipStream(source, version, onProgress);
    return { file: await bufferedZipBlob(stream), cleanup: async () => {} };
  }

  const root = await storage.getDirectory();
  const name = `edgeever-backup-${crypto.randomUUID()}.zip`;
  const handle = await root.getFileHandle(name, { create: true });
  const stream = await createEdgeEverZipStream(source, version, onProgress);
  try {
    await stream.pipeTo(await handle.createWritable());
    if (!handle.getFile) throw new Error("The temporary backup file is unavailable");
    return {
      file: await handle.getFile(),
      cleanup: () => root.removeEntry(name).catch(() => {}),
    };
  } catch (error) {
    await root.removeEntry(name).catch(() => {});
    throw error;
  }
};

type ZipEntryConsumer = {
  write?: (chunk: Uint8Array) => void | Promise<void>;
  close?: () => void | Promise<void>;
};

const streamZipEntries = async (
  blob: Blob,
  onEntry: (file: UnzipFile) => ZipEntryConsumer,
  onInputProgress?: (completedBytes: number) => void,
) => {
  let processing = Promise.resolve();
  const unzipper = new Unzip((file) => {
    const consumer = onEntry(file);
    file.ondata = (error, data, final) => {
      processing = processing.then(async () => {
        if (error) throw new EdgeEverZipImportError("invalidZip", error);
        if (data?.byteLength) await consumer.write?.(data);
        if (final) await consumer.close?.();
      });
    };
    file.start();
  });
  unzipper.register(UnzipInflate);

  const reader = blob.stream().getReader();
  let completedBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      completedBytes += next.value?.byteLength ?? 0;
      onInputProgress?.(completedBytes);
      try {
        unzipper.push(next.value ?? new Uint8Array(), next.done);
      } catch (error) {
        if (error instanceof EdgeEverZipImportError) throw error;
        throw new EdgeEverZipImportError("invalidZip", error);
      }
      await processing;
      if (next.done) break;
    }
  } finally {
    reader.releaseLock();
  }
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

const scanEdgeEverZip = async (blob: Blob, onProgress?: (percentage: number) => void) => {
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const signatureValue = signature.length === 4
    ? signature[0] | (signature[1] << 8) | (signature[2] << 16) | (signature[3] << 24)
    : 0;
  if (signatureValue !== 0x04034b50 && signatureValue !== 0x06054b50) {
    throw new EdgeEverZipImportError("invalidZip");
  }
  const entrySizes = new Map<string, number>();
  const structuredEntries = new Map<string, Uint8Array>();
  let lastPercentage = -1;

  await streamZipEntries(blob, (file) => {
    if (entrySizes.has(file.name)) {
      throw new EdgeEverZipImportError("invalidZip", new Error(`Duplicate ZIP entry: ${file.name}`));
    }
    entrySizes.set(file.name, -1);
    const structured = isStructuredZipEntry(file.name);
    const chunks: Uint8Array[] = [];
    let byteSize = 0;
    return {
      write(chunk) {
        byteSize += chunk.byteLength;
        const limit = structured ? MAX_ZIP_METADATA_ENTRY_BYTES : MAX_ZIP_ENTRY_BYTES;
        if (byteSize > limit) {
          throw new EdgeEverZipImportError(structured ? "invalidData" : "incompleteResources");
        }
        if (structured) {
          const copy = new Uint8Array(chunk.byteLength);
          copy.set(chunk);
          chunks.push(copy);
        }
      },
      close() {
        entrySizes.set(file.name, byteSize);
        if (structured) structuredEntries.set(file.name, concatZipChunks(chunks, byteSize));
      },
    };
  }, (completedBytes) => {
    const percentage = blob.size > 0 ? Math.min(100, Math.round((completedBytes / blob.size) * 100)) : 100;
    if (percentage !== lastPercentage) {
      lastPercentage = percentage;
      onProgress?.(percentage);
    }
  });

  return { entrySizes, structuredEntries };
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
): Promise<ParsedEdgeEverZip> => {
  const { entrySizes, structuredEntries } = await scanEdgeEverZip(blob, onProgress);
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
  const markdownCount = [...entrySizes.keys()].filter((path) => /^notes\/.+\.md$/.test(path)).length;

  if (
    manifest.counts.notebooks !== notebooks.length
    || manifest.counts.memos !== memos.length
    || manifest.counts.memos !== markdownCount
    || (manifest.counts.prompts ?? 0) !== prompts.length
  ) {
    throw new EdgeEverZipImportError("incompleteData");
  }

  const resources = memos.flatMap((memo) => memo.resources);
  const resourcePaths = new Set(resources.map((resource) => resource.archivePath));
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
    ))
  ) {
    throw new EdgeEverZipImportError("incompleteResources");
  }

  return { manifest, notebooks, memos, prompts, archive: blob };
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
      const sinkPromise = target.createResourceRestoreSink(resource.id, resource);
      let byteSize = 0;
      return {
        async write(chunk) {
          byteSize += chunk.byteLength;
          if (byteSize > resource.byteSize) {
            const sink = await sinkPromise;
            await sink.abort();
            throw new EdgeEverZipImportError("incompleteResources");
          }
          const sink = await sinkPromise;
          activeSinks.add(sink);
          await sink.write(chunk);
        },
        async close() {
          const sink = await sinkPromise;
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

export const downloadEdgeEverZip = (
  blob: Blob,
  filename = `edgeever-export-${new Date().toISOString().slice(0, 10)}.zip`,
) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};
