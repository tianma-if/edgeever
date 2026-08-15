import type { ListMemosResponse } from "@edgeever/client";
import type { InfiniteData } from "@tanstack/react-query";

export const removeMobileMemosFromListCache = (
  current: InfiniteData<ListMemosResponse> | undefined,
  memoIds: ReadonlySet<string>
): InfiniteData<ListMemosResponse> | undefined => {
  if (!current || memoIds.size === 0) {
    return current;
  }

  const removedIds = new Set(
    current.pages.flatMap((page) => page.memos.map((memo) => memo.id)).filter((memoId) => memoIds.has(memoId))
  );
  if (removedIds.size === 0) {
    return current;
  }
  const pages = current.pages.map((page) => ({
    ...page,
    memos: page.memos.filter((memo) => !removedIds.has(memo.id)),
    totalCount: Math.max(0, page.totalCount - removedIds.size),
  }));

  return { ...current, pages };
};
