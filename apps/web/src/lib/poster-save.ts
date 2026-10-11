import { markdownToDoc, posterFallbackMarkdown, parsePosterDocument, serializePosterDocument, type MemoDetail, type PosterDocument } from "@edgeever/shared";
import type { EdgeEverRepository } from "./repository";

// Immutable previews keep revision restores and concurrent drafts independent.
// Only artwork changes upload a new, bounded-size preview; metadata edits reuse it.
export const savePosterMemo = async (repository: EdgeEverRepository, memo: MemoDetail, document: PosterDocument, title: string, editSessionId: string, preview?: Blob, tags: string[] = memo.tags) => {
  let previewId: string | undefined;
  let committed = false;
  try {
    if (preview) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("Reconnect to save the poster preview. Your local draft is preserved.");
      const { resource } = await repository.uploadMemoResource(memo.id, new File([preview], "poster-preview.png", { type: "image/png" }));
      previewId = resource.id;
    }
    const next = { ...document, ...(previewId ? { previewResourceId: previewId } : {}) };
    const result = await repository.updateMemo(memo, {
      expectedRevision: memo.revision, expectedContentHash: memo.contentHash, editSessionId, title,
      contentMarkdown: serializePosterDocument(next), contentJson: markdownToDoc(posterFallbackMarkdown(next)), tags,
    });
    committed = true;
    return { memo: result.memo, document: next };
  } finally {
    if (previewId && !committed) {
      // A storage failure can arrive after a local commit. Keep the attachment
      // unless the current source confirms that it was never referenced.
      const latest = await repository.getMemo(memo.id).catch(() => null);
      if (latest && parsePosterDocument(latest.memo.contentMarkdown)?.previewResourceId !== previewId) {
        await repository.deleteResource(previewId).catch(() => undefined);
      }
    }
  }
};

// Sync acknowledgements can change hashes/previews without changing the artwork.
export const posterMemoContent = (memo: MemoDetail) => {
  const document = parsePosterDocument(memo.contentMarkdown);
  if (!document) return null;
  return JSON.stringify([memo.title ?? "", [...memo.tags].sort(), { ...document, previewResourceId: undefined }]);
};

export const classifyPosterUpdate = (incoming: MemoDetail, base: MemoDetail, dirty: boolean, saving: boolean, previousSaveBase?: MemoDetail | null) => {
  if (saving) return "defer";
  if (incoming.contentHash === base.contentHash && incoming.revision === base.revision) return "ignore";
  // Parent props may still show the pre-save memo after the save has completed.
  if (previousSaveBase && incoming.contentHash === previousSaveBase.contentHash && incoming.revision === previousSaveBase.revision) return "ignore";
  const content = posterMemoContent(incoming);
  if (content !== null && content === posterMemoContent(base)) return "rebase";
  return dirty ? "conflict" : "replace";
};

export const canRestorePosterDraft = (draft: { baseHash: string; baseContent?: string }, memo: MemoDetail) =>
  draft.baseHash === memo.contentHash || (typeof draft.baseContent === "string" && draft.baseContent === posterMemoContent(memo));
