import {
  EDGEEVER_ZIP_FORMAT,
  EDGEEVER_ZIP_FORMAT_VERSION,
  JsonBackupManifestSchema,
  JsonBackupMemoSchema,
  JsonBackupNotebookSchema,
  type JsonBackupManifest,
  type JsonBackupMemo,
  type JsonBackupNotebook,
  type JsonBackupResource,
  type JsonBackupRevision,
  type MemoDetail,
  type Notebook,
  type Resource,
} from "@edgeever/shared";
import { strFromU8, strToU8, unzip, Zip, ZipDeflate, ZipPassThrough } from "fflate";
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
  getResourceBlob: (resourceUrl: string) => Promise<Blob>;
};

type JsonRestoreTarget = {
  restoreNotebooks: (notebooks: JsonBackupNotebook[]) => Promise<unknown>;
  restoreMemos: (memos: JsonBackupMemo[]) => Promise<unknown>;
  restoreResource: (resourceId: string, metadata: JsonBackupResource, file: Blob) => Promise<unknown>;
};

export type ParsedEdgeEverZip = {
  manifest: JsonBackupManifest;
  notebooks: JsonBackupNotebook[];
  memos: JsonBackupMemo[];
  files: Record<string, Uint8Array>;
};

const PAGE_SIZE = 25;
const ZIP_MIME_TYPE = "application/zip";
const jsonBytes = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);

const addJsonFile = (zip: Zip, path: string, value: unknown) => {
  const file = new ZipDeflate(path, { level: 6 });
  zip.add(file);
  file.push(jsonBytes(value), true);
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

export const createEdgeEverZip = async (
  source: JsonBackupSource,
  version: { edgeeverVersion: string; buildId: string },
  onProgress?: (progress: EdgeEverZipProgress) => void
) => {
  const { notebooks } = await source.listNotebooks();
  const notebookPaths = buildNotebookExportPaths(notebooks);
  const memoNamesByNotebook = new Map<string, Set<string>>();
  const chunks: ArrayBuffer[] = [];

  return new Promise<Blob>((resolve, reject) => {
    const zip = new Zip((error, data, final) => {
      if (error) {
        reject(error);
        return;
      }
      chunks.push(new Uint8Array(data).buffer);
      if (final) {
        resolve(new Blob(chunks, { type: ZIP_MIME_TYPE }));
      }
    });

    void (async () => {
      try {
        const backupNotebooks = notebooks.map(toBackupNotebook);
        addJsonFile(zip, "notebooks.json", backupNotebooks);
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
              const blob = await source.getResourceBlob(resource.url);
              const file = new ZipPassThrough(archivePath);
              zip.add(file);
              file.push(new Uint8Array(await blob.arrayBuffer()), true);
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
            addJsonFile(zip, `memos/${memo.id}.json`, { memo, revisions, resources: backupResources });
            const markdownFile = new ZipDeflate(`${markdownDirectory}/${memoStem}.md`, { level: 6 });
            zip.add(markdownFile);
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
          },
        };
        addJsonFile(zip, "manifest.json", manifest);
        zip.end();
      } catch (error) {
        zip.terminate();
        reject(error);
      }
    })();
  });
};

const parseJsonFile = (
  files: Record<string, Uint8Array>,
  path: string,
  missingCode: EdgeEverZipImportErrorCode = "missingData"
) => {
  const data = files[path];
  if (!data) {
    throw new EdgeEverZipImportError(missingCode);
  }
  try {
    return JSON.parse(strFromU8(data)) as unknown;
  } catch (error) {
    throw new EdgeEverZipImportError(path === "manifest.json" ? "invalidManifest" : "invalidData", error);
  }
};

const unzipBlob = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (error, files) => error ? reject(new EdgeEverZipImportError("invalidZip", error)) : resolve(files));
  });
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

export const parseEdgeEverZip = async (blob: Blob): Promise<ParsedEdgeEverZip> => {
  const files = await unzipBlob(blob);
  const manifestValue = parseJsonFile(files, "manifest.json", "missingManifest");
  if (!manifestValue || typeof manifestValue !== "object") {
    throw new EdgeEverZipImportError("invalidManifest");
  }
  const manifestRecord = manifestValue as Record<string, unknown>;
  if (manifestRecord.format !== EDGEEVER_ZIP_FORMAT) {
    throw new EdgeEverZipImportError("unsupportedFormat");
  }
  if (manifestRecord.formatVersion !== EDGEEVER_ZIP_FORMAT_VERSION) {
    throw new EdgeEverZipImportError("unsupportedVersion");
  }
  const manifestResult = JsonBackupManifestSchema.safeParse(manifestValue);
  if (!manifestResult.success) {
    throw new EdgeEverZipImportError("invalidManifest", manifestResult.error);
  }
  const manifest = manifestResult.data;
  const notebooksValue = parseJsonFile(files, "notebooks.json");
  if (!Array.isArray(notebooksValue)) {
    throw new EdgeEverZipImportError("invalidData");
  }
  const notebooksResult = JsonBackupNotebookSchema.array().safeParse(notebooksValue);
  if (!notebooksResult.success) {
    throw new EdgeEverZipImportError("invalidData", notebooksResult.error);
  }
  const notebooks = sortNotebooksForRestore(notebooksResult.data);
  const memoPaths = Object.keys(files).filter((path) => /^memos\/[^/]+\.json$/.test(path)).sort();
  const memos: JsonBackupMemo[] = [];
  for (const path of memoPaths) {
    const memoResult = JsonBackupMemoSchema.safeParse(parseJsonFile(files, path));
    if (!memoResult.success) {
      throw new EdgeEverZipImportError("invalidData", memoResult.error);
    }
    memos.push(memoResult.data as JsonBackupMemo);
  }
  const markdownCount = Object.keys(files).filter((path) => /^notes\/.+\.md$/.test(path)).length;

  if (
    manifest.counts.notebooks !== notebooks.length
    || manifest.counts.memos !== memos.length
    || manifest.counts.memos !== markdownCount
  ) {
    throw new EdgeEverZipImportError("incompleteData");
  }

  const resources = memos.flatMap((memo) => memo.resources);
  const revisionCount = memos.reduce((count, memo) => count + memo.revisions.length, 0);
  if (manifest.counts.revisions !== revisionCount) {
    throw new EdgeEverZipImportError("incompleteData");
  }
  if (
    manifest.counts.resources !== resources.length
    || resources.some((resource) => !files[resource.archivePath] || files[resource.archivePath].byteLength !== resource.byteSize)
  ) {
    throw new EdgeEverZipImportError("incompleteResources");
  }

  return { manifest, notebooks, memos, files };
};

export const restoreEdgeEverZip = async (
  backup: ParsedEdgeEverZip,
  target: JsonRestoreTarget,
  onProgress?: (progress: EdgeEverZipProgress) => void
) => {
  const total = backup.notebooks.length + backup.memos.length + backup.manifest.counts.resources;
  let completed = 0;
  onProgress?.({ completed, total });

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

  for (const memo of backup.memos) {
    for (const resource of memo.resources) {
      await target.restoreResource(
        resource.id,
        resource,
        new Blob([new Uint8Array(backup.files[resource.archivePath])], {
          type: resource.mimeType || "application/octet-stream",
        })
      );
      completed += 1;
      onProgress?.({ completed, total });
    }
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

export const downloadEdgeEverZip = (blob: Blob) => {
  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `edgeever-export-${date}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};
