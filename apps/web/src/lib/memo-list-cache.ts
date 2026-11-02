import type { QueryClient } from "@tanstack/react-query";
import { DEFAULT_MEMO_TITLE, type MemoSummary } from "@edgeever/shared";
import { isNativeDesktopRuntime } from "./runtime";

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

// SQLite UTF-8 text follows scalar order, unlike UTF-16 for astral characters.
// NOCASE additionally folds ASCII case and stops at NUL before comparing lengths.
const compareDesktopText = (left: string, right: string, noCase = false) => {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCode = left.codePointAt(leftIndex)!;
    const rightCode = right.codePointAt(rightIndex)!;
    const leftFolded = noCase && leftCode >= 65 && leftCode <= 90 ? leftCode + 32 : leftCode;
    const rightFolded = noCase && rightCode >= 65 && rightCode <= 90 ? rightCode + 32 : rightCode;
    if (leftFolded !== rightFolded) return leftFolded - rightFolded;
    if (noCase && leftCode === 0) {
      // SQLite NOCASE stops at NUL, then compares the original UTF-8 lengths.
      const encoder = new TextEncoder();
      return encoder.encode(left).length - encoder.encode(right).length;
    }
    leftIndex += leftCode > 0xffff ? 2 : 1;
    rightIndex += rightCode > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
};

const compareDesktopTitleMemoSummaries = (left: MemoSummary, right: MemoSummary, sortMode: "title-asc" | "title-desc") => {
  const direction = sortMode === "title-desc" ? -1 : 1;
  const titleCompare = compareDesktopText(left.title ?? left.excerpt, right.title ?? right.excerpt, true);
  if (titleCompare !== 0) return titleCompare * direction;
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? -1 : 1;
  return compareDesktopText(right.id, left.id);
};

export const sortDesktopTitleMemoSummaries = (memos: MemoSummary[], sortMode: "title-asc" | "title-desc") =>
  [...memos].sort((left, right) => compareDesktopTitleMemoSummaries(left, right, sortMode));

const sortMemoSummariesForList = (memos: MemoSummary[], queryKey: readonly unknown[]) => {
  const sortMode = queryKey[5];
  if ((sortMode === "title-asc" || sortMode === "title-desc") && isNativeDesktopRuntime()) {
    return sortDesktopTitleMemoSummaries(memos, sortMode);
  }
  const sorted = [...memos];

  if (sortMode === "title-asc" || sortMode === "title-desc") {
    const direction = sortMode === "title-desc" ? -1 : 1;
    return sorted.sort((left, right) => {
      const leftTitle = left.title?.trim() || left.excerpt || DEFAULT_MEMO_TITLE;
      const rightTitle = right.title?.trim() || right.excerpt || DEFAULT_MEMO_TITLE;
      const titleCompare = leftTitle.localeCompare(rightTitle, "zh-CN");
      if (titleCompare !== 0) return titleCompare * direction;
      return left.id.localeCompare(right.id);
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

const rewindDesktopTitleCursor = (
  next: MemoListQueryData,
  before: MemoSummary[],
  queryKey: readonly unknown[],
  replacement: (memo: MemoSummary) => MemoSummary | null,
) => {
  const sortMode = queryKey[5];
  if (!isNativeDesktopRuntime() || (sortMode !== "title-asc" && sortMode !== "title-desc")) return next;
  const cursor = next.pages.at(-1)?.nextCursor;
  const offset = Number(cursor);
  if (cursor == null || !Number.isSafeInteger(offset) || offset <= 0) return next;

  // The offset marks a conservative source prefix. Cached tail notes beyond
  // it must not rewind it again on each subsequent title edit.
  const prefix = sortDesktopTitleMemoSummaries(deduplicateMemoSummaries(before), sortMode).slice(0, offset);
  const boundary = prefix.at(-1);
  if (!boundary) return next;
  const seen = new Set<string>();
  let removed = 0;
  for (const previous of prefix) {
    const memo = replacement(previous);
    if (!memo || seen.has(memo.id)) { removed++; continue; }
    seen.add(memo.id);
    if (compareDesktopTitleMemoSummaries(memo, boundary, sortMode) > 0) removed++;
  }
  if (!removed) return next;
  return {
    ...next,
    pages: next.pages.map((page, index) => index === next.pages.length - 1
      ? { ...page, nextCursor: String(Math.max(0, offset - removed)) }
      : page),
  };
};

export const remapMemoIdsInLists = (
  queryClient: QueryClient,
  memoIdMappings: ReadonlyMap<string, string>,
) => {
  if (memoIdMappings.size === 0) {
    return;
  }

  for (const [queryKey, current] of queryClient.getQueriesData<MemoListQueryData>({ queryKey: ["memos"] })) {
    if (!current) {
      continue;
    }

    const flatMemos = current.pages.flatMap((page) => page.memos);
    let changed = false;
    const remappedMemos = flatMemos.map((memo) => {
      const nextId = memoIdMappings.get(memo.id);
      if (!nextId || nextId === memo.id) {
        return memo;
      }

      changed = true;
      return { ...memo, id: nextId };
    });

    if (!changed) {
      continue;
    }

    const nextMemos = deduplicateMemoSummaries(remappedMemos);
    const removed = remappedMemos.length - nextMemos.length;
    const currentTotalCount = current.pages[0]?.totalCount ?? flatMemos.length;
    const totalCount = Math.max(nextMemos.length, currentTotalCount - removed);

    queryClient.setQueryData(
      queryKey,
      rewindDesktopTitleCursor(
        reflowMemoListPages(current, sortMemoSummariesForList(nextMemos, queryKey), totalCount),
        flatMemos, queryKey, memo => {
          const id = memoIdMappings.get(memo.id);
          return id && id !== memo.id ? { ...memo, id } : memo;
        },
      ),
    );
  }
};

export const updateMemoSummaryInLists = (queryClient: QueryClient, summary: MemoSummary) => {
  for (const [queryKey, current] of queryClient.getQueriesData<MemoListQueryData>({ queryKey: ["memos"] })) {
    if (!current) {
      continue;
    }

    const flatMemos = current.pages.flatMap((page) => page.memos);
    const existingMemo = flatMemos.find((item) => item.id === summary.id);
    const matchesStaticConstraints = memoMatchesStaticListConstraints(summary, queryKey);
    const currentTotalCount = current.pages[0]?.totalCount ?? flatMemos.length;

    if (existingMemo) {
      const nextMemos = matchesStaticConstraints
        ? deduplicateMemoSummaries(flatMemos.map((item) => (item.id === summary.id ? { ...item, ...summary } : item)))
        : deduplicateMemoSummaries(flatMemos.filter((item) => item.id !== summary.id));
      const totalCount = matchesStaticConstraints ? currentTotalCount : Math.max(0, currentTotalCount - 1);

      const next = reflowMemoListPages(current, sortMemoSummariesForList(nextMemos, queryKey), totalCount);
      const titleChanged = (existingMemo.title ?? existingMemo.excerpt) !== (summary.title ?? summary.excerpt);
      queryClient.setQueryData(queryKey, titleChanged || summary.updatedAt < existingMemo.updatedAt || !matchesStaticConstraints
        ? rewindDesktopTitleCursor(next, flatMemos, queryKey, memo => memo.id === summary.id ? (matchesStaticConstraints ? summary : null) : memo)
        : next);
      continue;
    }

    // A summary does not contain the complete note body, so it cannot reliably
    // decide whether a newly seen note matches a server-side full-text search.
    if (!matchesStaticConstraints || hasSearchConstraint(queryKey)) {
      continue;
    }

    const [firstPage, ...restPages] = current.pages;
    const sortAcrossLoadedPages = isNativeDesktopRuntime() && restPages.length > 0
      && (queryKey[5] === "title-asc" || queryKey[5] === "title-desc");
    const firstPageMemos = deduplicateMemoSummaries([summary, ...(firstPage?.memos ?? [])]);
    const nextFirstPage = firstPage
      ? {
          ...firstPage,
          memos: sortAcrossLoadedPages ? firstPageMemos : sortMemoSummariesForList(firstPageMemos, queryKey),
          totalCount: firstPage.totalCount + 1,
        }
      : { memos: [summary], totalCount: 1, nextCursor: null };

    const next = { ...current, pages: [nextFirstPage, ...restPages] };
    queryClient.setQueryData(queryKey, sortAcrossLoadedPages
      ? reflowMemoListPages(next, sortMemoSummariesForList(deduplicateMemoSummaries([summary, ...flatMemos]), queryKey), nextFirstPage.totalCount)
      : next);
  }
};
