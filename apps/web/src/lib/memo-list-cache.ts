import type { QueryClient } from "@tanstack/react-query";
import { DEFAULT_MEMO_TITLE, type MemoSummary } from "@edgeever/shared";

export type MemoListQueryData = {
  pages: Array<{
    memos: MemoSummary[];
    totalCount: number;
    nextCursor: string | null;
  }>;
  pageParams: unknown[];
};

const memoMatchesFilter = (memo: MemoSummary, filterMode: unknown) => {
  if (filterMode === "tagged") {
    return memo.tags.length > 0;
  }

  if (filterMode === "untagged") {
    return memo.tags.length === 0;
  }

  if (filterMode === "pinned") {
    return memo.isPinned;
  }

  return true;
};

const memoMatchesStaticListConstraints = (memo: MemoSummary, queryKey: readonly unknown[]) => {
  const [, view, notebookId, , filterMode] = queryKey;
  const notebookIds = Array.isArray(queryKey[6]) ? queryKey[6] : [];
  const tag = typeof queryKey[7] === "string" ? queryKey[7].trim().toLocaleLowerCase() : "";
  const memoView = view === "trash" ? "trash" : "notebook";

  if ((memoView === "trash") !== memo.isDeleted) {
    return false;
  }

  if (
    memoView === "notebook" &&
    typeof notebookId === "string" &&
    notebookId &&
    !(notebookIds.length > 0 ? notebookIds.includes(memo.notebookId) : memo.notebookId === notebookId)
  ) {
    return false;
  }

  if (tag && !memo.tags.some((memoTag) => memoTag.toLocaleLowerCase() === tag)) {
    return false;
  }

  return memoMatchesFilter(memo, filterMode);
};

const hasSearchConstraint = (queryKey: readonly unknown[]) =>
  typeof queryKey[3] === "string" && queryKey[3].trim().length > 0;

const sortMemoSummariesForList = (memos: MemoSummary[], queryKey: readonly unknown[]) => {
  const sortMode = queryKey[5];
  const sorted = [...memos];

  if (sortMode === "title-asc") {
    return sorted.sort((left, right) => {
      const leftTitle = left.title?.trim() || left.excerpt || DEFAULT_MEMO_TITLE;
      const rightTitle = right.title?.trim() || right.excerpt || DEFAULT_MEMO_TITLE;
      return leftTitle.localeCompare(rightTitle, "zh-CN") || left.id.localeCompare(right.id);
    });
  }

  if (sortMode === "created-desc") {
    return sorted.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id));
  }

  return sorted.sort((left, right) => {
    if (left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1;
    }

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || right.id.localeCompare(left.id);
  });
};

const deduplicateMemoSummaries = (memos: MemoSummary[]) => {
  const uniqueMemos = new Map<string, MemoSummary>();

  for (const memo of memos) {
    uniqueMemos.set(memo.id, memo);
  }

  return Array.from(uniqueMemos.values());
};

const reflowMemoListPages = (current: MemoListQueryData, memos: MemoSummary[], totalCount: number) => {
  let offset = 0;

  return {
    ...current,
    pages: current.pages.map((page) => {
      const pageSize = page.memos.length;
      const nextPageMemos = memos.slice(offset, offset + pageSize);
      offset += pageSize;

      return {
        ...page,
        memos: nextPageMemos,
        totalCount,
      };
    }),
  };
};

export const updateMemoSummaryInLists = (queryClient: QueryClient, summary: MemoSummary) => {
  for (const [queryKey, current] of queryClient.getQueriesData<MemoListQueryData>({ queryKey: ["memos"] })) {
    if (!current) {
      continue;
    }

    const flatMemos = current.pages.flatMap((page) => page.memos);
    const memoExists = flatMemos.some((item) => item.id === summary.id);
    const matchesStaticConstraints = memoMatchesStaticListConstraints(summary, queryKey);
    const currentTotalCount = current.pages[0]?.totalCount ?? flatMemos.length;

    if (memoExists) {
      const nextMemos = matchesStaticConstraints
        ? deduplicateMemoSummaries(flatMemos.map((item) => (item.id === summary.id ? { ...item, ...summary } : item)))
        : deduplicateMemoSummaries(flatMemos.filter((item) => item.id !== summary.id));
      const totalCount = matchesStaticConstraints ? currentTotalCount : Math.max(0, currentTotalCount - 1);

      queryClient.setQueryData(queryKey, reflowMemoListPages(current, sortMemoSummariesForList(nextMemos, queryKey), totalCount));
      continue;
    }

    // A summary does not contain the complete note body, so it cannot reliably
    // decide whether a newly seen note matches a server-side full-text search.
    if (!matchesStaticConstraints || hasSearchConstraint(queryKey)) {
      continue;
    }

    const [firstPage, ...restPages] = current.pages;
    const nextFirstPage = firstPage
      ? {
          ...firstPage,
          memos: sortMemoSummariesForList(deduplicateMemoSummaries([summary, ...firstPage.memos]), queryKey),
          totalCount: firstPage.totalCount + 1,
        }
      : { memos: [summary], totalCount: 1, nextCursor: null };

    queryClient.setQueryData(queryKey, { ...current, pages: [nextFirstPage, ...restPages] });
  }
};
