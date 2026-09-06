import type { MemoSummary } from "./types";

export type MemoListTimestampField = "createdAt" | "updatedAt";

export const getMemoListTimestampField = (sortMode: string): MemoListTimestampField =>
  sortMode === "created-desc" ? "createdAt" : "updatedAt";

export const getMemoListTimestamp = (
  memo: Pick<MemoSummary, "createdAt" | "updatedAt">,
  sortMode: string,
) => {
  const field = getMemoListTimestampField(sortMode);
  return { field, value: memo[field] };
};
