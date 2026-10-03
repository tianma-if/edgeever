import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  applyMemoRemovalToCache,
  clearTrashMemoLists,
  evictIdleMemoDetails,
  restoreMemoRemovalCache,
  restoreTrashClearCache,
  snapshotMemoRemovalCache,
  snapshotTrashClearCache,
} from "./workspace-memo-cache.ts";

const memo = (id, notebookId, isDeleted = false) => ({
  id,
  notebookId,
  title: id,
  excerpt: "",
  tags: [],
  isPinned: false,
  isArchived: false,
  isDeleted,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: isDeleted ? "2026-01-02T00:00:00.000Z" : null,
});

describe("optimistic memo removal cache", () => {
  test("removes list entries and notebook counts, then restores the exact snapshot on failure", () => {
    const queryClient = new QueryClient();
    const listKey = ["memos", "notebook", "nb-1"];
    const detailKey = ["memo", "memo-1", "notebook"];
    const list = {
      pages: [{ memos: [memo("memo-1", "nb-1"), memo("memo-2", "nb-1")], totalCount: 2, nextCursor: null }],
      pageParams: [null],
    };
    const detail = { memo: memo("memo-1", "nb-1") };
    const notebooks = { notebooks: [{ id: "nb-1", memoCount: 2 }] };
    queryClient.setQueryData(listKey, list);
    queryClient.setQueryData(detailKey, detail);
    queryClient.setQueryData(["notebooks"], notebooks);

    const snapshot = snapshotMemoRemovalCache(queryClient, ["memo", "memo-1"]);
    applyMemoRemovalToCache(queryClient, new Set(["memo-1"]));

    expect(queryClient.getQueryData(listKey).pages[0].memos.map((item) => item.id)).toEqual(["memo-2"]);
    expect(queryClient.getQueryData(["notebooks"]).notebooks[0].memoCount).toBe(1);
    expect(queryClient.getQueryData(detailKey)).toEqual(detail);

    restoreMemoRemovalCache(queryClient, snapshot);
    expect(queryClient.getQueryData(listKey)).toEqual(list);
    expect(queryClient.getQueryData(detailKey)).toEqual(detail);
    expect(queryClient.getQueryData(["notebooks"])).toEqual(notebooks);
  });

  test("does not decrement notebook counts for a memo already in trash", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["memos", "trash"], {
      pages: [{ memos: [memo("memo-1", "nb-1", true)], totalCount: 1, nextCursor: null }],
      pageParams: [null],
    });
    queryClient.setQueryData(["notebooks"], { notebooks: [{ id: "nb-1", memoCount: 3 }] });

    applyMemoRemovalToCache(queryClient, new Set(["memo-1"]));

    expect(queryClient.getQueryData(["memos", "trash"]).pages[0].memos).toEqual([]);
    expect(queryClient.getQueryData(["notebooks"]).notebooks[0].memoCount).toBe(3);
  });

  test("single-note rollback restores only that note's detail cache", () => {
    const queryClient = new QueryClient();
    const firstKey = ["memo", "memo-1", "notebook"];
    const secondKey = ["memo", "memo-2", "notebook"];
    queryClient.setQueryData(firstKey, { memo: memo("memo-1", "nb-1") });
    queryClient.setQueryData(secondKey, { memo: memo("memo-2", "nb-1") });

    const snapshot = snapshotMemoRemovalCache(queryClient, ["memo", "memo-1"]);
    queryClient.setQueryData(firstKey, { memo: { ...memo("memo-1", "nb-1"), title: "changed" } });
    queryClient.setQueryData(secondKey, { memo: { ...memo("memo-2", "nb-1"), title: "newer" } });
    restoreMemoRemovalCache(queryClient, snapshot);

    expect(queryClient.getQueryData(firstKey).memo.title).toBe("memo-1");
    expect(queryClient.getQueryData(secondKey).memo.title).toBe("newer");
  });
});

describe("optimistic Trash clearing cache", () => {
  test("clears only Trash lists, retains the open detail, and restores both on failure", () => {
    const queryClient = new QueryClient();
    const trashKey = ["memos", "trash"];
    const activeKey = ["memos", "notebook"];
    const detailKey = ["memo", "memo-1", "trash"];
    const trash = {
      pages: [{ memos: [memo("memo-1", "nb-1", true)], totalCount: 1, nextCursor: "cursor" }],
      pageParams: [null],
    };
    const active = {
      pages: [{ memos: [memo("memo-2", "nb-1")], totalCount: 1, nextCursor: null }],
      pageParams: [null],
    };
    const detail = { memo: memo("memo-1", "nb-1", true) };
    queryClient.setQueryData(trashKey, trash);
    queryClient.setQueryData(activeKey, active);
    queryClient.setQueryData(detailKey, detail);

    const snapshot = snapshotTrashClearCache(queryClient);
    clearTrashMemoLists(queryClient);

    expect(queryClient.getQueryData(trashKey).pages[0]).toMatchObject({ memos: [], totalCount: 0, nextCursor: null });
    expect(queryClient.getQueryData(activeKey)).toEqual(active);
    expect(queryClient.getQueryData(detailKey)).toEqual(detail);

    restoreTrashClearCache(queryClient, snapshot);
    expect(queryClient.getQueryData(trashKey)).toEqual(trash);
    expect(queryClient.getQueryData(activeKey)).toEqual(active);
    expect(queryClient.getQueryData(detailKey)).toEqual(detail);
  });
});

describe("idle memo detail eviction", () => {
  test("drops cached memo bodies except the open note", () => {
    const removed = [];
    const queryClient = {
      removeQueries({ predicate }) {
        for (const query of [
          { queryKey: ["memo", "memo_old", "notebook"] },
          { queryKey: ["memo", "memo_open", "notebook"] },
          { queryKey: ["memos", "notebook"] },
          { queryKey: ["memo-link-search", "q"] },
        ]) {
          if (predicate(query)) removed.push(query.queryKey);
        }
      },
    };

    evictIdleMemoDetails(queryClient, "memo_open");
    expect(removed).toEqual([["memo", "memo_old", "notebook"]]);
  });
});
