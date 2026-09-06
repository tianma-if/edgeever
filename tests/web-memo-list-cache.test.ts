import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { MemoSummary } from "@edgeever/shared";
import { updateMemoSummaryInLists, type MemoListQueryData } from "../apps/web/src/lib/memo-list-cache";

const memo = (overrides: Partial<MemoSummary> = {}): MemoSummary => ({
  id: "memo-apple",
  notebookId: "nb-inbox",
  title: "Apple developer enrollment",
  excerpt: "Apple Developer Program",
  tags: [],
  isPinned: false,
  isArchived: false,
  isDeleted: false,
  revision: 1,
  createdAt: "2026-07-16T12:00:00.000Z",
  updatedAt: "2026-07-16T12:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

const queryData = (pages: MemoSummary[][], totalCount = pages.flat().length): MemoListQueryData => ({
  pages: pages.map((memos) => ({ memos, totalCount, nextCursor: null })),
  pageParams: pages.map(() => null),
});

describe("memo list cache updates", () => {
  test("keeps an edited note in an active full-text search until the server refetch resolves membership", () => {
    const queryClient = new QueryClient();
    const queryKey = ["memos", "notebook", null, "Apple", "all", "updated-desc"] as const;
    queryClient.setQueryData(queryKey, queryData([[memo()]]));

    updateMemoSummaryInLists(queryClient, memo({ title: "Updated title", revision: 2 }));

    const cached = queryClient.getQueryData<MemoListQueryData>(queryKey);
    expect(cached?.pages[0]?.memos).toHaveLength(1);
    expect(cached?.pages[0]?.memos[0]?.title).toBe("Updated title");
    expect(cached?.pages[0]?.memos[0]?.revision).toBe(2);
  });

  test("does not optimistically insert an unseen note into a full-text search", () => {
    const queryClient = new QueryClient();
    const queryKey = ["memos", "notebook", null, "Apple", "all", "updated-desc"] as const;
    queryClient.setQueryData(queryKey, queryData([[]], 0));

    updateMemoSummaryInLists(queryClient, memo());

    expect(queryClient.getQueryData<MemoListQueryData>(queryKey)?.pages[0]?.memos).toEqual([]);
  });

  test("deduplicates the same note ID if overlapping infinite-query pages contain it", () => {
    const queryClient = new QueryClient();
    const queryKey = ["memos", "notebook", null, "", "all", "updated-desc"] as const;
    queryClient.setQueryData(queryKey, queryData([[memo()], [memo({ revision: 2 })]], 1));

    updateMemoSummaryInLists(queryClient, memo({ revision: 3 }));

    const cached = queryClient.getQueryData<MemoListQueryData>(queryKey);
    const flattened = cached?.pages.flatMap((page) => page.memos) ?? [];
    expect(flattened).toHaveLength(1);
    expect(flattened[0]?.revision).toBe(3);
    expect(cached?.pages[0]?.totalCount).toBe(1);
  });

  test("removes a note when an edit no longer matches the selected exact tag", () => {
    const queryClient = new QueryClient();
    const queryKey = ["memos", "notebook", null, "", "all", "updated-desc", [], "demo"] as const;
    queryClient.setQueryData(queryKey, queryData([[memo({ tags: ["Demo"] })]], 1));

    updateMemoSummaryInLists(queryClient, memo({ tags: ["demo-extra"], revision: 2 }));

    const cached = queryClient.getQueryData<MemoListQueryData>(queryKey);
    expect(cached?.pages[0]?.memos).toEqual([]);
    expect(cached?.pages[0]?.totalCount).toBe(0);
  });
});
