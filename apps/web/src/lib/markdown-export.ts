import type { MemoDetail, Notebook, Resource } from "@edgeever/shared";
import { mergeMarkdownFrontMatter } from "@edgeever/shared";
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";

export type MarkdownExportProgress = {
  completed: number;
  total: number;
};

export type MarkdownExportPage = {
  memos: MemoDetail[];
  resources: Resource[];
  totalCount: number;
  nextOffset: number | null;
};

export type MarkdownExportSource = {
  listNotebooks: () => Promise<{ notebooks: Notebook[] }>;
  getPage: (offset: number, limit: number) => Promise<MarkdownExportPage>;
  getResourceBlob: (resourceUrl: string) => Promise<Blob>;
};

const EXPORT_PAGE_SIZE = 50;
const ZIP_MIME_TYPE = "application/zip";
const MAX_BUFFERED_ZIP_BYTES = 128 * 1024 * 1024;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export class MarkdownExportMemoryLimitError extends Error {
  constructor() {
    super("This Markdown export is too large for an in-memory ZIP.");
    this.name = "MarkdownExportMemoryLimitError";
  }
}

export const sanitizeExportPathSegment = (value: string, fallback: string) => {
  const sanitized = value
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  const safeValue = sanitized || fallback;
  return WINDOWS_RESERVED_NAME.test(safeValue) ? `_${safeValue}` : safeValue;
};

export const uniqueExportName = (candidate: string, usedNames: Set<string>) => {
  if (!usedNames.has(candidate.toLocaleLowerCase())) {
    usedNames.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  let suffix = 2;
  while (usedNames.has(`${candidate} (${suffix})`.toLocaleLowerCase())) {
    suffix += 1;
  }

  const unique = `${candidate} (${suffix})`;
  usedNames.add(unique.toLocaleLowerCase());
  return unique;
};

export const buildNotebookExportPaths = (notebooks: Notebook[]) => {
  const notebookById = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  const siblingNames = new Map<string, Set<string>>();
  const segmentById = new Map<string, string>();

  for (const notebook of notebooks) {
    const parentKey = notebook.parentId ?? "__root__";
    const usedNames = siblingNames.get(parentKey) ?? new Set<string>();
    siblingNames.set(parentKey, usedNames);
    segmentById.set(
      notebook.id,
      uniqueExportName(sanitizeExportPathSegment(notebook.name, "Untitled notebook"), usedNames)
    );
  }

  const pathById = new Map<string, string>();
  const resolvePath = (notebookId: string, visited = new Set<string>()): string => {
    const cached = pathById.get(notebookId);
    if (cached) {
      return cached;
    }

    const notebook = notebookById.get(notebookId);
    if (!notebook || visited.has(notebookId)) {
      return "Unfiled";
    }

    visited.add(notebookId);
    const segment = segmentById.get(notebookId) ?? "Untitled notebook";
    const path = notebook.parentId && notebookById.has(notebook.parentId)
      ? `${resolvePath(notebook.parentId, visited)}/${segment}`
      : segment;
    pathById.set(notebookId, path);
    return path;
  };

  for (const notebook of notebooks) {
    resolvePath(notebook.id);
  }

  return pathById;
};

export const buildNoteMarkdown = (markdown: string, memo: MemoDetail, notebookPath: string) =>
  mergeMarkdownFrontMatter(markdown, {
    title: memo.title?.trim() || "Untitled note",
    tags: memo.tags,
    notebook: notebookPath,
    created: memo.createdAt,
    updated: memo.updatedAt,
    pinned: memo.isPinned,
    edgeever_id: memo.id,
  });

export const buildMarkdownFrontMatter = (memo: MemoDetail, notebookPath: string) =>
  buildNoteMarkdown("", memo, notebookPath);

export const getExportResourceExtension = (resource: Resource) => {
  const filenameExtension = resource.filename?.match(/\.([a-z0-9]{1,12})$/i)?.[1];
  if (filenameExtension) {
    return filenameExtension.toLowerCase();
  }

  const mimeExtension = resource.mimeType?.split("/")[1]?.split(/[;+]/)[0];
  return mimeExtension ? sanitizeExportPathSegment(mimeExtension, "bin").toLowerCase() : "bin";
};

const encodeRelativePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export const replaceExportResourceUrl = (markdown: string, resourceUrl: string, relativePath: string) => {
  const encodedPath = encodeRelativePath(relativePath);
  const absoluteUrl = typeof window === "undefined" ? null : new URL(resourceUrl, window.location.origin).toString();
  let result = markdown.split(resourceUrl).join(encodedPath);

  if (absoluteUrl) {
    result = result.split(absoluteUrl).join(encodedPath);
  }

  return result;
};

export const createMarkdownExport = async (
  source: MarkdownExportSource,
  onProgress?: (progress: MarkdownExportProgress) => void
) => {
  const { notebooks } = await source.listNotebooks();
  const notebookPaths = buildNotebookExportPaths(notebooks);
  const memoNamesByNotebook = new Map<string, Set<string>>();
  const chunks: ArrayBuffer[] = [];
  const result = new Promise<Blob>((resolve, reject) => {
    let totalBytes = 0;
    let failed = false;
    let zip!: Zip;
    zip = new Zip((error, data, final) => {
      if (failed) {
        return;
      }
      if (error) {
        failed = true;
        reject(error);
        return;
      }

      totalBytes += data.byteLength;
      if (totalBytes > MAX_BUFFERED_ZIP_BYTES) {
        failed = true;
        zip.terminate();
        reject(new MarkdownExportMemoryLimitError());
        return;
      }

      chunks.push(new Uint8Array(data).buffer);
      if (final) {
        resolve(new Blob(chunks, { type: ZIP_MIME_TYPE }));
      }
    });

    void (async () => {
      try {
        let offset = 0;
        let completed = 0;

        while (true) {
          const page = await source.getPage(offset, EXPORT_PAGE_SIZE);
          onProgress?.({ completed, total: page.totalCount });
          const resourcesByMemo = new Map<string, Resource[]>();

          for (const resource of page.resources) {
            const resources = resourcesByMemo.get(resource.memoId) ?? [];
            resources.push(resource);
            resourcesByMemo.set(resource.memoId, resources);
          }

          for (const memo of page.memos) {
            const notebookPath = notebookPaths.get(memo.notebookId) ?? "Unfiled";
            const usedMemoNames = memoNamesByNotebook.get(notebookPath) ?? new Set<string>();
            memoNamesByNotebook.set(notebookPath, usedMemoNames);
            const memoStem = uniqueExportName(
              sanitizeExportPathSegment(memo.title?.trim() || "Untitled note", "Untitled note"),
              usedMemoNames
            );
            const assetDirectory = `${memoStem}.assets`;
            const usedResourceNames = new Set<string>();
            let markdown = memo.contentMarkdown;

            for (const resource of resourcesByMemo.get(memo.id) ?? []) {
              const fallbackName = `${resource.kind}-${resource.id}.${getExportResourceExtension(resource)}`;
              const resourceName = uniqueExportName(
                sanitizeExportPathSegment(resource.filename || fallbackName, fallbackName),
                usedResourceNames
              );
              const relativePath = `${assetDirectory}/${resourceName}`;
              const blob = await source.getResourceBlob(resource.url);
              const file = new ZipPassThrough(`${notebookPath}/${relativePath}`);
              zip.add(file);
              file.push(new Uint8Array(await blob.arrayBuffer()), true);
              markdown = replaceExportResourceUrl(markdown, resource.url, relativePath);
            }

            const markdownFile = new ZipDeflate(`${notebookPath}/${memoStem}.md`, { level: 6 });
            zip.add(markdownFile);
            markdownFile.push(strToU8(buildNoteMarkdown(markdown, memo, notebookPath)), true);
            completed += 1;
            onProgress?.({ completed, total: page.totalCount });
          }

          if (page.nextOffset === null) {
            break;
          }
          offset = page.nextOffset;
        }

        zip.end();
      } catch (error) {
        zip.terminate();
        reject(error);
      }
    })();
  });

  return result;
};

export const downloadMarkdownExport = (blob: Blob) => {
  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `edgeever-markdown-${date}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};
