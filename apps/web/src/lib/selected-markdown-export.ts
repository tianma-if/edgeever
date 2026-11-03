import type { Notebook } from "@edgeever/shared";
import {
  createMarkdownExport,
  downloadMarkdownExport,
  type MarkdownExportPage,
  type MarkdownExportProgress,
} from "./markdown-export";

// Keep this prefix check local so ZIP export does not import Dexie through local-mirror.
const isUnsyncedLocalMemoId = (memoId: string) => memoId.startsWith("local_");

export const MAX_SELECTED_MARKDOWN_EXPORT_MEMO_IDS = 100;

export type SelectedMarkdownExportResult =
  | { status: "ok"; exported: number; skippedLocal: number }
  | { status: "too-many"; selected: number; max: number }
  | { status: "local-only"; skippedLocal: number }
  | { status: "empty" };

export const partitionExportableMemoIds = (memoIds: string[]) => {
  const skippedLocal = memoIds.filter((memoId) => isUnsyncedLocalMemoId(memoId));
  const exportable = [...new Set(memoIds.filter((memoId) => !isUnsyncedLocalMemoId(memoId)))];
  return { exportable, skippedLocal };
};

export const exportSelectedMemosAsMarkdownZip = async ({
  memoIds,
  listNotebooks,
  getPage,
  getResourceBlob,
  onProgress,
  save = downloadMarkdownExport,
}: {
  memoIds: string[];
  listNotebooks: () => Promise<{ notebooks: Notebook[] }>;
  getPage: (offset: number, limit: number, memoIds: string[], cursor?: string) => Promise<MarkdownExportPage>;
  getResourceBlob: (resourceUrl: string) => Promise<Blob>;
  onProgress?: (progress: MarkdownExportProgress) => void;
  save?: (blob: Blob) => void;
}): Promise<SelectedMarkdownExportResult> => {
  const { exportable, skippedLocal } = partitionExportableMemoIds(memoIds);
  if (exportable.length === 0) {
    return skippedLocal.length > 0
      ? { status: "local-only", skippedLocal: skippedLocal.length }
      : { status: "empty" };
  }
  if (exportable.length > MAX_SELECTED_MARKDOWN_EXPORT_MEMO_IDS) {
    return {
      status: "too-many",
      selected: exportable.length,
      max: MAX_SELECTED_MARKDOWN_EXPORT_MEMO_IDS,
    };
  }

  let exported = 0;
  const blob = await createMarkdownExport({
    listNotebooks,
    getPage: async (offset, limit, cursor) => {
      const page = await getPage(offset, limit, exportable, cursor);
      exported += page.memos.length;
      return page;
    },
    getResourceBlob,
  }, onProgress);

  if (exported === 0) {
    return { status: "empty" };
  }

  save(blob);
  return { status: "ok", exported, skippedLocal: skippedLocal.length };
};
