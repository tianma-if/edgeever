import { describe, expect, test } from "bun:test";
import { subscribeRepositoryMutations, withRepositoryMutationEvents } from "./repository-events.ts";

const memo = {
  id: "note-1",
  notebookId: "notebook-1",
  title: "Note",
  excerpt: "Excerpt",
  tags: [],
  isPinned: false,
  isArchived: false,
  isDeleted: false,
  revision: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  deletedAt: null,
  contentJson: { type: "doc", content: [] },
  contentMarkdown: "Note",
  contentText: "Note",
  contentHash: "hash",
  sourceMemoIds: [],
  mergeSourceCount: 0,
  mergedIntoMemoId: null,
};

describe("repository mutation events", () => {
  test("publishes successful host mutations once within the matching workspace", async () => {
    const base = {
      createMemo: async () => ({ memo }),
      updateMemo: async () => ({ memo: { ...memo, revision: 2 }, queued: true }),
      deleteMemo: async () => ({ ok: true }),
      renameTag: async () => ({ ok: true, updated: 1 }),
      deleteTag: async () => ({ ok: true, updated: 1 }),
      sync: async () => ({ bootstrapped: false, changed: 3 }),
    };
    const repository = withRepositoryMutationEvents(base, "workspace-a");
    const received = [];
    const otherWorkspace = [];
    const dispose = subscribeRepositoryMutations("workspace-a", (event) => received.push(event));
    const disposeOther = subscribeRepositoryMutations("workspace-b", (event) => otherWorkspace.push(event));

    await repository.createMemo({ notebookId: "notebook-1" });
    await repository.updateMemo(memo, {});
    await repository.deleteMemo(memo.id);
    await repository.renameTag("old", "new");
    await repository.deleteTag("new");
    await repository.sync();

    expect(received.map((event) => event.type)).toEqual([
      "note.created",
      "note.updated",
      "note.deleted",
      "tag.changed",
      "tag.changed",
      "workspace.synced",
    ]);
    expect(otherWorkspace).toEqual([]);
    dispose();
    disposeOther();
  });

  test("does not publish failed mutations", async () => {
    const repository = withRepositoryMutationEvents({
      createMemo: async () => { throw new Error("failed"); },
    }, "workspace-failed");
    const received = [];
    const dispose = subscribeRepositoryMutations("workspace-failed", (event) => received.push(event));

    await expect(repository.createMemo({ notebookId: "notebook-1" })).rejects.toThrow("failed");
    expect(received).toEqual([]);
    dispose();
  });
});
