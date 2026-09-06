import { expect, test } from "bun:test";
import type { ListMemosResponse } from "@edgeever/client";
import type { InfiniteData } from "@tanstack/react-query";
import { removeMobileMemosFromListCache } from "./mobile-memo-list-cache";

const createPage = (ids: string[], totalCount: number): ListMemosResponse => ({
  memos: ids.map((id) => ({ id }) as ListMemosResponse["memos"][number]),
  nextCursor: null,
  totalCount,
});

test("removes selected memos from paged mobile list caches immediately", () => {
  const current: InfiniteData<ListMemosResponse> = {
    pageParams: [0, 2],
    pages: [createPage(["memo-1", "memo-2"], 3), createPage(["memo-3"], 3)],
  };

  const next = removeMobileMemosFromListCache(current, new Set(["memo-2"]));

  expect(next?.pages.map((page) => page.memos.map((memo) => memo.id))).toEqual([
    ["memo-1"],
    ["memo-3"],
  ]);
  expect(next?.pages.map((page) => page.totalCount)).toEqual([2, 2]);
  expect(current.pages[0]?.memos.map((memo) => memo.id)).toEqual(["memo-1", "memo-2"]);
});

test("preserves cache identity when none of the memo ids are present", () => {
  const current: InfiniteData<ListMemosResponse> = {
    pageParams: [0],
    pages: [createPage(["memo-1"], 1)],
  };

  expect(removeMobileMemosFromListCache(current, new Set(["missing"]))).toBe(current);
});
