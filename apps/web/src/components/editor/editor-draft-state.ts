import {
  docToMarkdown,
  resolveMemoContentDoc,
  type MemoDetail,
  type TiptapDoc,
} from "@edgeever/shared";
import type {
  LocalDraft,
  MemoUpdateSyncPayload,
  SyncQueueItem,
} from "@/lib/local-db";
import { getEditableMemoTitle } from "@/lib/app-helpers";
import { parseTagsText } from "@/lib/utils";

export type EditorDraftSource = "draft" | "queue" | "memo";

export type EditorDraftState = {
  source: EditorDraftSource;
  sourceKey: string;
  title: string;
  tagsText: string;
  contentJson: TiptapDoc;
  contentMarkdown: string;
  hasUnsavedChanges: boolean;
};

/**
 * TipTap is created with the memo snapshot before the asynchronous local-draft
 * lookup finishes. Replacing that already-identical document during hydration
 * resets the ProseMirror view and selection, which is visible in slower desktop
 * runtimes as a second editor paint.
 */
export const shouldReplaceEditorDocument = (
  currentDocument: TiptapDoc | null,
  nextDocument: TiptapDoc,
) => currentDocument === null || JSON.stringify(currentDocument) !== JSON.stringify(nextDocument);

type ResolveEditorDraftStateInput = {
  memo: MemoDetail;
  draft?: LocalDraft | null;
  queuedUpdate?: SyncQueueItem | null;
};

const stringArraysEqual = (first: string[], second: string[]) =>
  first.length === second.length && first.every((value, index) => value === second[index]);

export const isLocalDraftEquivalentToMemo = (memo: MemoDetail, draft: LocalDraft) => {
  const memoContent = resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown);
  return draft.title === getEditableMemoTitle(memo.title) &&
    stringArraysEqual(parseTagsText(draft.tagsText), memo.tags) &&
    docToMarkdown(draft.contentJson) === docToMarkdown(memoContent);
};

/**
 * Chooses the local editor source without touching React, IndexedDB, or the
 * network. Already-applied queue entries must be removed before calling it.
 */
export const resolveEditorDraftState = ({
  memo,
  draft,
  queuedUpdate,
}: ResolveEditorDraftStateInput): EditorDraftState => {
  const draftUpdatedAt = draft ? Date.parse(draft.updatedAt) : 0;
  const remoteUpdatedAt = Date.parse(memo.updatedAt);
  const draftHasLocalChanges = Boolean(draft && !isLocalDraftEquivalentToMemo(memo, draft));
  const useDraft = Boolean(draft && draftHasLocalChanges && (queuedUpdate || draftUpdatedAt >= remoteUpdatedAt));
  const queuedPayload = queuedUpdate?.kind === "memo.update"
    ? queuedUpdate.payload as MemoUpdateSyncPayload
    : null;
  const useQueuedPayload = Boolean(queuedPayload && !useDraft);

  const source: EditorDraftSource = useDraft
    ? "draft"
    : useQueuedPayload
      ? "queue"
      : "memo";
  const title = useDraft && draft
    ? draft.title
    : useQueuedPayload && queuedPayload
      ? getEditableMemoTitle(queuedPayload.title)
      : getEditableMemoTitle(memo.title);
  const tagsText = useDraft && draft
    ? draft.tagsText
    : useQueuedPayload && queuedPayload
      ? queuedPayload.tags.join(", ")
      : memo.tags.join(", ");
  const contentJson = useDraft && draft
    ? draft.contentJson
    : useQueuedPayload && queuedPayload
      ? queuedPayload.contentJson
      : resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown);
  const contentMarkdown = docToMarkdown(contentJson);
  const sourceVersion = source === "draft" && draft
    ? draft.updatedAt
    : source === "queue" && queuedUpdate
      ? queuedUpdate.updatedAt
      : `${memo.revision}:${memo.updatedAt}:${memo.contentHash}`;

  return {
    source,
    sourceKey: `${source}:${memo.id}:${sourceVersion}:${title}:${tagsText}:${contentMarkdown}`,
    title,
    tagsText,
    contentJson,
    contentMarkdown,
    hasUnsavedChanges: Boolean(useDraft && !queuedUpdate),
  };
};
