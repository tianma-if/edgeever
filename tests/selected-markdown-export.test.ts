import { describe, expect, test } from "bun:test";
import type { MemoDetail, Notebook, Resource } from "@edgeever/shared";
import { unzipSync } from "fflate";
import {
  exportSelectedMemosAsMarkdownZip,
  MAX_SELECTED_MARKDOWN_EXPORT_MEMO_IDS,
  partitionExportableMemoIds,
} from "../apps/web/src/lib/selected-markdown-export";

const notebook = (input: Partial<Notebook> & Pick<Notebook, "id" | "name">): Notebook => ({
  id: input.id,
  parentId: input.parentId ?? null,
  name: input.name,
  slug: null,
  icon: null,
  color: null,
  sortOrder: 0,
  memoCount: 0,
  lastMemoUpdatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const memo = (input: Partial<MemoDetail> & Pick<MemoDetail, "id" | "title">): MemoDetail => ({
  id: input.id,
  notebookId: "nb_root",
  title: input.title,
  excerpt: "",
  tags: [],
  isPinned: false,
  isArchived: false,
  isDeleted: false,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  contentJson: { type: "doc", content: [] },
  contentMarkdown: input.contentMarkdown ?? "Hello",
  contentText: "Hello",
  contentHash: "hash",
  sourceMemoIds: [],
  mergeSourceCount: 0,
  mergedIntoMemoId: null,
});

const resource: Resource = {
  id: "res_1",
  memoId: "memo_keep",
  originalMemoId: null,
  kind: "image",
  mimeType: "image/png",
  filename: "photo.png",
  byteSize: 3,
  sha256: null,
  width: null,
  height: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  url: "/api/v1/resources/res_1/blob",
};

describe("selected Markdown ZIP export", () => {
  test("retains selection IDs while forwarding continuation cursors", async () => {
    const notes = [memo({ id: "memo_cursor_a", title: "A" }), memo({ id: "memo_cursor_b", title: "B" })];
    const calls: { ids: string[]; cursor?: string }[] = [];
    const result = await exportSelectedMemosAsMarkdownZip({
      memoIds: notes.map(note => note.id),
      listNotebooks: async () => ({ notebooks: [notebook({ id: "nb_root", name: "Root" })] }),
      getPage: async (offset, _limit, ids, cursor) => {
        calls.push({ ids, cursor });
        return { memos: [notes[offset]], resources: [], ...(offset === 0 ? { totalCount: 2 } : {}),
          nextOffset: offset === 0 ? 1 : null, nextCursor: offset === 0 ? "selected-next" : null };
      },
      getResourceBlob: async () => new Blob(), save: () => {},
    });
    expect(result).toEqual({ status: "ok", exported: 2, skippedLocal: 0 });
    expect(calls).toEqual([{ ids: notes.map(note => note.id), cursor: undefined }, { ids: notes.map(note => note.id), cursor: "selected-next" }]);
  });

  test("reports the actual selected export count when continuation totals are omitted", async () => {
    const notes = [memo({ id: "memo_first", title: "First" }), memo({ id: "memo_second", title: "Second" })];
    const result = await exportSelectedMemosAsMarkdownZip({
      memoIds: notes.map((note) => note.id),
      listNotebooks: async () => ({ notebooks: [notebook({ id: "nb_root", name: "Root" })] }),
      getPage: async (offset) => ({ memos: [notes[offset]], resources: [], ...(offset === 0 ? { totalCount: 2 } : {}), nextOffset: offset === 0 ? 1 : null }),
      getResourceBlob: async () => new Blob(), save: () => {},
    });
    expect(result).toEqual({ status: "ok", exported: 2, skippedLocal: 0 });
  });

  test("drops unsynced local ids before talking to the export API", () => {
    expect(partitionExportableMemoIds(["memo_1", "local_draft", "memo_1", "local_other"])).toEqual({
      exportable: ["memo_1"],
      skippedLocal: ["local_draft", "local_other"],
    });
  });

  test("refuses selections larger than the batch limit", async () => {
    const memoIds = Array.from({ length: MAX_SELECTED_MARKDOWN_EXPORT_MEMO_IDS + 1 }, (_, index) => `memo_${index}`);
    const result = await exportSelectedMemosAsMarkdownZip({
      memoIds,
      listNotebooks: async () => ({ notebooks: [] }),
      getPage: async () => {
        throw new Error("should not fetch pages for oversized selections");
      },
      getResourceBlob: async () => new Blob(),
      save: () => {
        throw new Error("should not download an oversized selection");
      },
    });

    expect(result).toEqual({
      status: "too-many",
      selected: MAX_SELECTED_MARKDOWN_EXPORT_MEMO_IDS + 1,
      max: MAX_SELECTED_MARKDOWN_EXPORT_MEMO_IDS,
    });
  });

  test("skips download when every selected note is still local", async () => {
    const result = await exportSelectedMemosAsMarkdownZip({
      memoIds: ["local_one", "local_two"],
      listNotebooks: async () => ({ notebooks: [] }),
      getPage: async () => {
        throw new Error("should not fetch pages for local-only selections");
      },
      getResourceBlob: async () => new Blob(),
      save: () => {
        throw new Error("should not download a local-only selection");
      },
    });

    expect(result).toEqual({ status: "local-only", skippedLocal: 2 });
  });

  test("writes only the requested notes and reports skipped local drafts", async () => {
    const keep = memo({ id: "memo_keep", title: "保留笔记" });
    let requestedIds: string[] | undefined;
    const saved: Blob[] = [];
    const result = await exportSelectedMemosAsMarkdownZip({
      memoIds: ["memo_keep", "local_draft", "memo_keep"],
      listNotebooks: async () => ({ notebooks: [notebook({ id: "nb_root", name: "工作" })] }),
      getPage: async (_offset, _limit, memoIds) => {
        requestedIds = memoIds;
        return {
          memos: [keep],
          resources: [resource],
          totalCount: 1,
          nextOffset: null,
        };
      },
      getResourceBlob: async () => new Blob([new Uint8Array([1, 2, 3])]),
      save: (blob) => saved.push(blob),
    });

    expect(requestedIds).toEqual(["memo_keep"]);
    expect(result).toEqual({ status: "ok", exported: 1, skippedLocal: 1 });
    expect(saved).toHaveLength(1);
    expect(Object.keys(unzipSync(new Uint8Array(await saved[0].arrayBuffer()))).sort()).toEqual([
      "工作/保留笔记.assets/photo.png",
      "工作/保留笔记.md",
    ]);
  });

  test("does not download an empty archive when none of the ids exist", async () => {
    const result = await exportSelectedMemosAsMarkdownZip({
      memoIds: ["memo_missing"],
      listNotebooks: async () => ({ notebooks: [] }),
      getPage: async () => ({ memos: [], resources: [], totalCount: 0, nextOffset: null }),
      getResourceBlob: async () => new Blob(),
      save: () => {
        throw new Error("should not download an empty archive");
      },
    });

    expect(result).toEqual({ status: "empty" });
  });
});
