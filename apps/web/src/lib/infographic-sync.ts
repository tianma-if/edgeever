import { parseInfographicDocument, type InfographicDocument, type MemoDetail } from "@edgeever/shared";
import { shouldAcceptRemoteMemoDetail } from "./memo-detail-freshness";
import { classifyStructuredMemoSnapshot, matchesStructuredMemoReceipt } from "./structured-memo-sync";

export const infographicEditorSnapshot = (title: string, document: InfographicDocument, tags: string[]) =>
  JSON.stringify([title, document.syntax, document.history ?? [], [...tags].sort(), document.activeSessionId ?? null]);

export const infographicMemoSnapshot = (memo: MemoDetail) => {
  const document = parseInfographicDocument(memo.contentMarkdown);
  return document ? infographicEditorSnapshot(memo.title ?? "", document, memo.tags) : null;
};

export const classifyInfographicUpdate = (
  incoming: MemoDetail,
  base: MemoDetail,
  savedSnapshot: string,
  hasDraft: boolean,
  saving: boolean,
  acknowledged?: MemoDetail | null,
) => {
  if (incoming.id !== base.id || !shouldAcceptRemoteMemoDetail(base, incoming)) return "ignore";
  if (saving) return "defer";
  const incomingSnapshot = infographicMemoSnapshot(incoming);
  if (incomingSnapshot === null) return "ignore";
  // A receipt can arrive after a successor draft was already saved locally.
  // It still confirms only its own snapshot, even though that draft is clean.
  const matchesAcknowledged = matchesStructuredMemoReceipt(incoming, acknowledged,
    (receipt) => incomingSnapshot === infographicMemoSnapshot(receipt));
  return classifyStructuredMemoSnapshot(incomingSnapshot === savedSnapshot || matchesAcknowledged, hasDraft);
};
