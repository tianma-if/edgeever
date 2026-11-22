import type { MemoDetail } from "@edgeever/shared";
import { shouldAcceptRemoteMemoDetail } from "./memo-detail-freshness";

const withSyncBase = (memo: MemoDetail, base: MemoDetail): MemoDetail => ({
  ...memo,
  revision: base.revision,
  contentHash: base.contentHash,
  updatedAt: base.updatedAt,
});

/** A receipt advances concurrency metadata and leaves the local draft intact. */
export const advanceStructuredMemoSyncBase = (
  memo: MemoDetail,
  receipt: MemoDetail,
  acceptReceipt: (memo: MemoDetail, receipt: MemoDetail) => boolean = shouldAcceptRemoteMemoDetail,
): MemoDetail => receipt.id === memo.id && acceptReceipt(memo, receipt) ? withSyncBase(memo, receipt) : memo;

/** A local save can finish after the editor has already received a newer base. */
export const retainNewerStructuredMemoSyncBase = (saved: MemoDetail, current: MemoDetail): MemoDetail =>
  current.revision > saved.revision ? withSyncBase(saved, current) : saved;

/** Distinguish an acknowledged snapshot from a different remote change at the same version. */
export const matchesStructuredMemoReceipt = (
  incoming: MemoDetail,
  receipt: MemoDetail | null | undefined,
  matchesSnapshot: (receipt: MemoDetail) => boolean,
): boolean => Boolean(receipt
  && incoming.id === receipt.id
  && incoming.notebookId === receipt.notebookId
  && incoming.revision === receipt.revision
  && incoming.contentHash === receipt.contentHash
  && matchesSnapshot(receipt));

export const classifyStructuredMemoSnapshot = (matchesSaved: boolean, hasDraft: boolean) => {
  if (matchesSaved) return "rebase";
  return hasDraft ? "defer" : "replace";
};
