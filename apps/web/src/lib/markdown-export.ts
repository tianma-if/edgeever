import type { MemoDetail, Notebook, Resource } from "@edgeever/shared";
import { sanitizeExportPathSegment, uniqueExportName, buildNotebookExportPaths, buildNoteMarkdown, getExportResourceExtension, replaceExportResourceUrl } from "@edgeever/shared/backup-markdown";
export { sanitizeExportPathSegment, uniqueExportName, buildNotebookExportPaths, buildNoteMarkdown, buildMarkdownFrontMatter, getExportResourceExtension, replaceExportResourceUrl } from "@edgeever/shared/backup-markdown";
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";

export type MarkdownExportProgress = {
  completed: number;
  total: number;
};

export type MarkdownExportPage = {
  memos: MemoDetail[];
  resources: Resource[];
  totalCount?: number;
  nextOffset: number | null;
  nextCursor?: string | null;
};

export type MarkdownExportSource = {
  listNotebooks: () => Promise<{ notebooks: Notebook[] }>;
  getPage: (offset: number, limit: number, cursor?: string) => Promise<MarkdownExportPage>;
  getResourceBlob: (resourceUrl: string) => Promise<Blob>;
};

const EXPORT_PAGE_SIZE = 50;
const ZIP_MIME_TYPE = "application/zip";
const MAX_BUFFERED_ZIP_BYTES = 128 * 1024 * 1024;

export class MarkdownExportMemoryLimitError extends Error {
  constructor() {
    super("This Markdown export is too large for an in-memory ZIP.");
    this.name = "MarkdownExportMemoryLimitError";
  }
}

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
        let cursor: string | undefined;
        let completed = 0;
        let total = 0;

        while (true) {
          const page = await source.getPage(offset, EXPORT_PAGE_SIZE, cursor);
          total = page.totalCount ?? Math.max(total, completed + page.memos.length);
          onProgress?.({ completed, total });
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
            onProgress?.({ completed, total });
          }

          if (page.nextOffset === null) {
            break;
          }
          offset = page.nextOffset;
          cursor = page.nextCursor ?? undefined;
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
