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

type ResolveEditorDraftStateInput = {
  memo: MemoDetail;
  draft?: LocalDraft | null;
  queuedUpdate?: SyncQueueItem | null;
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
  const useDraft = Boolean(draft && (queuedUpdate || draftUpdatedAt >= remoteUpdatedAt));
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
