import { describe, expect, test } from "bun:test";
import {
  resolveEditorDraftState,
  shouldReplaceEditorDocument,
} from "./editor-draft-state.ts";

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const memo = {
  id: "memo-1",
  notebookId: "inbox",
  title: "Remote",
  tags: ["remote"],
  contentJson: doc("remote body"),
  contentMarkdown: "remote body",
  contentHash: "remote-hash",
  revision: 4,
  isDeleted: false,
  isPinned: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const queue = {
  id: "memo.update:memo-1",
  kind: "memo.update",
  memoId: "memo-1",
  status: "pending",
  payload: {
    memoId: "memo-1",
    expectedRevision: 4,
    expectedContentHash: "remote-hash",
    editSessionId: "session",
    title: "Queued",
    tags: ["queued"],
    contentJson: doc("queued body"),
  },
  attemptCount: 0,
  lastError: null,
  nextAttemptAt: null,
  claimId: null,
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
};

describe("editor draft source resolution", () => {
  test("uses the remote memo when there is no local work", () => {
    const state = resolveEditorDraftState({ memo });

    expect(state.source).toBe("memo");
    expect(state.title).toBe("Remote");
    expect(state.contentMarkdown).toBe("remote body");
    expect(state.hasUnsavedChanges).toBe(false);
  });

  test("repairs invalid saved gallery images and marks the memo for autosave", () => {
    const state = resolveEditorDraftState({
      memo: {
        ...memo,
        contentJson: {
          type: "doc",
          content: [
            {
              type: "edgeeverImageGallery",
              attrs: { layout: "3" },
              content: [{ type: "image", attrs: { src: null } }],
            },
            {
              type: "edgeeverImageGallery",
              attrs: { layout: "1" },
              content: [
                { type: "image", attrs: { src: "/one.png" } },
                { type: "image", attrs: { src: "/two.png" } },
              ],
            },
          ],
        },
      },
    });

    expect(state.contentJson.content).toHaveLength(1);
    expect(state.contentJson.content[0].content).toHaveLength(2);
    expect(state.hasUnsavedChanges).toBe(true);
  });

  test("uses a newer draft and marks it dirty without a queue entry", () => {
    const state = resolveEditorDraftState({
      memo,
      draft: {
        memoId: memo.id,
        title: "Draft",
        tagsText: "draft",
        contentJson: doc("draft body"),
        updatedAt: "2026-01-04T00:00:00.000Z",
      },
    });

    expect(state.source).toBe("draft");
    expect(state.title).toBe("Draft");
    expect(state.hasUnsavedChanges).toBe(true);
  });

  test("discards a newer draft that is identical to the saved memo", () => {
    const state = resolveEditorDraftState({
      memo,
      draft: {
        memoId: memo.id,
        title: memo.title,
        tagsText: "remote",
        contentJson: memo.contentJson,
        updatedAt: "2026-01-04T00:00:00.000Z",
      },
    });

    expect(state.source).toBe("memo");
    expect(state.hasUnsavedChanges).toBe(false);
  });

  test("ignores an older draft when no update is queued", () => {
    const state = resolveEditorDraftState({
      memo,
      draft: {
        memoId: memo.id,
        title: "Old draft",
        tagsText: "old",
        contentJson: doc("old body"),
        updatedAt: "2026-01-01T12:00:00.000Z",
      },
    });

    expect(state.source).toBe("memo");
  });

  test("uses the queued payload when its draft was already cleared", () => {
    const state = resolveEditorDraftState({ memo, queuedUpdate: queue });

    expect(state.source).toBe("queue");
    expect(state.title).toBe("Queued");
    expect(state.tagsText).toBe("queued");
    expect(state.contentMarkdown).toBe("queued body");
    expect(state.hasUnsavedChanges).toBe(false);
  });

  test("keeps the draft authoritative while its update remains queued", () => {
    const state = resolveEditorDraftState({
      memo,
      queuedUpdate: queue,
      draft: {
        memoId: memo.id,
        title: "Draft",
        tagsText: "draft",
        contentJson: doc("draft body"),
        updatedAt: "2025-12-01T00:00:00.000Z",
      },
    });

    expect(state.source).toBe("draft");
    expect(state.hasUnsavedChanges).toBe(false);
  });
});

describe("editor document hydration", () => {
  test("does not replace a newly mounted empty note with the same empty document", () => {
    const emptyDocument = { type: "doc", content: [{ type: "paragraph" }] };
    expect(shouldReplaceEditorDocument(emptyDocument, emptyDocument)).toBe(false);
  });

  test("replaces the mounted memo when a recovered local draft has different content", () => {
    expect(shouldReplaceEditorDocument(doc("remote body"), doc("recovered draft"))).toBe(true);
  });

  test("does not treat rich documents with the same markdown text as identical", () => {
    const plainDocument = doc("same body");
    const themedDocument = {
      type: "doc",
      content: [{ type: "edgeeverThemeBlock", attrs: { theme: "paper" }, content: plainDocument.content }],
    };

    expect(shouldReplaceEditorDocument(plainDocument, themedDocument)).toBe(true);
  });

  test("hydrates when the current editor document cannot be read", () => {
    expect(shouldReplaceEditorDocument(null, doc("remote body"))).toBe(true);
  });
});
