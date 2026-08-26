import { afterEach, describe, expect, test } from "bun:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const { localDb } = await import("./local-db.ts");
const {
  createLocalDataScope,
  clearLocalScope,
  createLocalMemo,
  getLocalMemo,
  listLocalTemplates,
  listLocalTags,
  listLocalMemos,
  putLocalTemplate,
  putLocalMemo,
  putLocalMemoUpdate,
  applyLocalTagRename,
  applyLocalMemoMove,
  applyLocalMemoPin,
  applyLocalMemoDeleteBatch,
  applyLocalEmptyTrash,
  updateLocalNotebook,
  getLocalNotebook,
  deleteLocalNotebook,
  putLocalNotebook,
  mergeLocalMemos,
  putLocalMemoRevisions,
  listLocalMemoRevisions,
  getLocalMemoRevision,
  putLocalResource,
  createLocalResource,
  listLocalResources,
  listLocalMemoIdMappings,
  observeLocalMemoIdMappings,
  replaceLocalResources,
  remapLocalDraftMemoId,
  replaceLocalMemoId,
  hasLocalSyncCursorRewound,
  syncLocalMirror,
} = await import("./local-mirror.ts");
const { api } = await import("./api.ts");
const { getCachedLocalResourceBytes } = await import("./local-resource-cache.ts");

afterEach(async () => {
  await localDb.transaction(
    "rw",
    [localDb.drafts, localDb.syncQueue, localDb.notebooks, localDb.memos, localDb.templates, localDb.revisions, localDb.resources, localDb.syncMeta, localDb.idMappings],
    async () => {
      await Promise.all([
        localDb.drafts.clear(),
        localDb.syncQueue.clear(),
        localDb.notebooks.clear(),
        localDb.memos.clear(),
        localDb.templates.clear(),
        localDb.revisions.clear(),
        localDb.resources.clear(),
        localDb.syncMeta.clear(),
        localDb.idMappings.clear(),
      ]);
    },
  );
});

describe("local mirror", () => {
  test("records a durable mapping when a new memo receives its remote id", async () => {
    const scope = createLocalDataScope("https://notes.example.org", "user-1");
    const localMemo = await createLocalMemo(scope, { notebookId: "inbox", title: "New note" });
    const remoteMemo = {
      ...localMemo,
      id: "memo-remote",
      revision: 1,
      contentHash: "remote-hash",
    };

    await replaceLocalMemoId(scope, localMemo.id, remoteMemo);

    expect(await listLocalMemoIdMappings(scope)).toEqual(new Map([[localMemo.id, remoteMemo.id]]));
  });

  test("observes a new memo id mapping so another live workspace can recover", async () => {
    const scope = createLocalDataScope("https://notes.example.org", "user-1");
    const localMemo = await createLocalMemo(scope, { notebookId: "inbox", title: "New note" });
    const remoteMemo = {
      ...localMemo,
      id: "memo-remote",
      revision: 1,
      contentHash: "remote-hash",
    };
    const observedMapping = new Promise((resolve) => {
      const unsubscribe = observeLocalMemoIdMappings(scope, (mappings) => {
        if (mappings.get(localMemo.id) !== remoteMemo.id) return;
        unsubscribe();
        resolve(mappings);
      });
    });

    await replaceLocalMemoId(scope, localMemo.id, remoteMemo);

    expect(await observedMapping).toEqual(new Map([[localMemo.id, remoteMemo.id]]));
  });

  test("clears cached data, drafts, and pending changes for a reset scope", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const otherScope = createLocalDataScope("https://notes.example.org", "user-2");
    const scopedMemo = await createLocalMemo(scope, { notebookId: "demo-notebook", title: "Changed demo note" });
    const otherMemo = await createLocalMemo(otherScope, { notebookId: "private-notebook", title: "Keep me" });
    await localDb.drafts.bulkPut([
      { memoId: scopedMemo.id, title: "Demo draft", contentJson: { type: "doc", content: [] }, tagsText: "", updatedAt: "2026-01-01T00:00:00.000Z" },
      { memoId: otherMemo.id, title: "Private draft", contentJson: { type: "doc", content: [] }, tagsText: "", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    await localDb.syncQueue.bulkPut([
      {
        id: `memo.update:${scopedMemo.id}`,
        kind: "memo.update",
        scope,
        memoId: scopedMemo.id,
        status: "pending",
        payload: {},
        attemptCount: 0,
        lastError: null,
        nextAttemptAt: null,
        claimId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: `memo.update:${otherMemo.id}`,
        kind: "memo.update",
        scope: otherScope,
        memoId: otherMemo.id,
        status: "pending",
        payload: {},
        attemptCount: 0,
        lastError: null,
        nextAttemptAt: null,
        claimId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    await clearLocalScope(scope);

    expect(await getLocalMemo(scope, scopedMemo.id)).toBeNull();
    expect(await localDb.drafts.get(scopedMemo.id)).toBeUndefined();
    expect(await localDb.syncQueue.get(`memo.update:${scopedMemo.id}`)).toBeUndefined();
    expect(await getLocalMemo(otherScope, otherMemo.id)).not.toBeNull();
    expect(await localDb.drafts.get(otherMemo.id)).toBeDefined();
    expect(await localDb.syncQueue.get(`memo.update:${otherMemo.id}`)).toBeDefined();
  });

  test("rebuilds the browser mirror when the server change cursor rewinds", () => {
    expect(hasLocalSyncCursorRewound(42, 7)).toBe(true);
    expect(hasLocalSyncCursorRewound(42, 42)).toBe(false);
    expect(hasLocalSyncCursorRewound(42, 64)).toBe(false);
    expect(hasLocalSyncCursorRewound(42)).toBe(false);
  });

  test("replaces stale IndexedDB data after the server change log is reset", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    await createLocalMemo(scope, { notebookId: "old-notebook", title: "Stale cached note" });
    await localDb.syncMeta.bulkPut([
      { scope, key: "cursor", value: "42", updatedAt: "2026-01-01T00:00:00.000Z" },
      { scope, key: "identity", value: "same-workspace", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const originalSyncChanges = api.syncChanges;
    const originalSyncBootstrap = api.syncBootstrap;
    api.syncChanges = async () => ({
      changes: [],
      cursor: 42,
      hasMore: false,
      serverCursor: 7,
      syncIdentity: "same-workspace",
    });
    api.syncBootstrap = async () => ({
      notebooks: [],
      memos: [],
      snapshotCursor: 7,
      syncIdentity: "same-workspace",
      totalCount: 0,
      nextAfterId: null,
    });

    try {
      expect(await syncLocalMirror(scope)).toEqual({ bootstrapped: true, changed: 0 });
      expect((await listLocalMemos(scope, {})).totalCount).toBe(0);
      expect((await localDb.syncMeta.get([scope, "cursor"]))?.value).toBe("7");
    } finally {
      api.syncChanges = originalSyncChanges;
      api.syncBootstrap = originalSyncBootstrap;
    }
  });

  test("keeps the newest draft when memo ids are remapped more than once", async () => {
    await localDb.drafts.put({
      memoId: "local-memo",
      title: "Older draft",
      tagsText: "",
      contentJson: { type: "doc", content: [] },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await localDb.drafts.put({
      memoId: "remote-memo",
      title: "Newer draft",
      tagsText: "",
      contentJson: { type: "doc", content: [] },
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    await remapLocalDraftMemoId("local-memo", "remote-memo");

    expect(await localDb.drafts.get("local-memo")).toBeUndefined();
    expect(await localDb.drafts.get("remote-memo")).toMatchObject({ title: "Newer draft" });
  });

  test("creates and lists a memo without a network request", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const memo = await createLocalMemo(scope, {
      notebookId: "nb-inbox",
      title: "Local note",
      contentMarkdown: "Hello local first",
      tags: ["draft"],
    });

    const result = await listLocalMemos(scope, { notebookId: "nb-inbox" });
    expect(result.totalCount).toBe(1);
    expect(result.memos[0]?.id).toBe(memo.id);
    expect(result.memos[0]?.excerpt).toContain("Hello local first");
  });

  test("filters local memos by an exact tag across notebooks", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const expected = await createLocalMemo(scope, { notebookId: "nb-a", tags: ["Demo"] });
    await createLocalMemo(scope, { notebookId: "nb-b", tags: ["demo-extra"] });
    await createLocalMemo(scope, { notebookId: "nb-b", title: "Demo without tag" });

    const result = await listLocalMemos(scope, { tag: "demo" });

    expect(result.totalCount).toBe(1);
    expect(result.memos.map((memo) => memo.id)).toEqual([expected.id]);
  });

  test("updates local content and preserves the memo identity", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const memo = await createLocalMemo(scope, { notebookId: "nb-inbox" });
    const updated = await putLocalMemoUpdate(scope, memo, {
      title: "Updated locally",
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Changed" }] }] },
      tags: ["updated"],
    });

    expect(updated.id).toBe(memo.id);
    expect((await getLocalMemo(scope, memo.id))?.title).toBe("Updated locally");
    expect((await getLocalMemo(scope, memo.id))?.tags).toEqual(["updated"]);
    expect((await getLocalMemo(scope, memo.id))?.contentMarkdown).toContain("Changed");
  });

  test("caches templates inside the same local data scope", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    await putLocalTemplate(scope, {
      id: "template-1",
      name: "Daily note",
      description: null,
      title: "Daily",
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "# Daily",
      tags: ["journal"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect((await listLocalTemplates(scope)).templates[0]?.id).toBe("template-1");
  });

  test("derives tags from the local memo mirror", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    await createLocalMemo(scope, { notebookId: "nb-inbox", tags: ["offline", "offline"] });
    expect((await listLocalTags(scope)).tags).toEqual([{ name: "offline", memoCount: 1, updatedAt: expect.any(String) }]);
  });

  test("applies batch mutations to the local mirror immediately", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const first = await createLocalMemo(scope, { notebookId: "inbox", tags: ["old"] });
    const second = await createLocalMemo(scope, { notebookId: "inbox" });
    expect(await applyLocalTagRename(scope, "old", "new")).toBe(1);
    expect(await applyLocalMemoMove(scope, [first.id, second.id], "archive")).toBe(2);
    expect(await applyLocalMemoPin(scope, [first.id], true)).toBe(1);
    expect((await getLocalMemo(scope, first.id))?.tags).toEqual(["new"]);
    expect((await getLocalMemo(scope, first.id))?.notebookId).toBe("archive");
    expect((await getLocalMemo(scope, first.id))?.isPinned).toBe(true);
  });

  test("deletes and empties trash locally without waiting for the API", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const memo = await createLocalMemo(scope, { notebookId: "inbox" });
    expect(await applyLocalMemoDeleteBatch(scope, [memo.id])).toBe(1);
    expect((await getLocalMemo(scope, memo.id))?.isDeleted).toBe(true);
    expect(await applyLocalEmptyTrash(scope)).toBe(1);
    expect(await getLocalMemo(scope, memo.id)).toBeNull();
  });

  test("updates and removes notebooks in the local mirror immediately", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    await putLocalNotebook(scope, {
      id: "notebook-1",
      parentId: null,
      name: "Inbox",
      slug: "inbox",
      icon: null,
      color: null,
      sortOrder: 0,
      memoCount: 0,
      lastMemoUpdatedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect((await updateLocalNotebook(scope, "notebook-1", { name: "Archive" }))?.name).toBe("Archive");
    expect((await getLocalNotebook(scope, "notebook-1"))?.name).toBe("Archive");
    expect(await deleteLocalNotebook(scope, "notebook-1")).toBe(true);
    expect(await getLocalNotebook(scope, "notebook-1")).toBeNull();
  });

  test("merges memos locally and marks source notes as deleted", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const first = await createLocalMemo(scope, { notebookId: "inbox", title: "First", contentMarkdown: "one", tags: ["a"] });
    const second = await createLocalMemo(scope, { notebookId: "inbox", title: "Second", contentMarkdown: "two", tags: ["b"] });
    const merged = await mergeLocalMemos(scope, { memoIds: [first.id, second.id], title: "Merged" });
    expect(merged?.title).toBe("Merged");
    expect(merged?.contentMarkdown).toContain("one");
    expect(merged?.contentMarkdown).toContain("two");
    expect(merged?.contentMarkdown).toContain("edgeever:merge-divider");
    expect(merged?.contentJson?.content?.some((node) => node.type === "edgeeverMergeDivider")).toBe(true);
    expect(merged?.sourceMemoIds).toEqual([first.id, second.id]);
    expect((await getLocalMemo(scope, first.id))?.isDeleted).toBe(true);
    expect((await getLocalMemo(scope, second.id))?.mergedIntoMemoId).toBe(merged?.id);
  });

  test("uses a custom source title when the first merged memo is untitled", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const untitled = await createLocalMemo(scope, { notebookId: "inbox", title: "无标题笔记", contentMarkdown: "one" });
    const titled = await createLocalMemo(scope, { notebookId: "inbox", title: "手动设置的标题", contentMarkdown: "two" });

    const merged = await mergeLocalMemos(scope, { memoIds: [untitled.id, titled.id] });

    expect(merged?.title).toBe("手动设置的标题");
  });

  test("recovers rich content when source Markdown copies are empty", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const first = await createLocalMemo(scope, { notebookId: "inbox", title: "First" });
    const second = await createLocalMemo(scope, { notebookId: "inbox", title: "Second" });
    first.contentJson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "第一篇真实正文" }] }] };
    first.contentText = "第一篇真实正文";
    second.contentJson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "第二篇真实正文" }] }] };
    second.contentText = "第二篇真实正文";
    await putLocalMemo(scope, first);
    await putLocalMemo(scope, second);

    const merged = await mergeLocalMemos(scope, { memoIds: [first.id, second.id] });

    expect(merged?.contentMarkdown).toContain("第一篇真实正文");
    expect(merged?.contentMarkdown).toContain("第二篇真实正文");
    expect(merged?.contentText).toContain("第一篇真实正文");
    expect((await getLocalMemo(scope, first.id))?.isDeleted).toBe(true);
  });

  test("cancels a merge before deleting sources when cached content is inconsistent", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const unsafe = await createLocalMemo(scope, { notebookId: "inbox", title: "Unsafe" });
    const second = await createLocalMemo(scope, { notebookId: "inbox", title: "Second", contentMarkdown: "正常正文" });
    unsafe.contentText = "缓存声称这里有正文";
    await putLocalMemo(scope, unsafe);

    await expect(mergeLocalMemos(scope, { memoIds: [unsafe.id, second.id] }))
      .rejects.toThrow("Merge was cancelled");
    expect((await getLocalMemo(scope, unsafe.id))?.isDeleted).toBe(false);
    expect((await getLocalMemo(scope, second.id))?.isDeleted).toBe(false);
  });

  test("caches memo revisions by account scope", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const memo = await createLocalMemo(scope, { notebookId: "inbox" });
    const revision = {
      id: "revision-local-1",
      memoId: memo.id,
      revision: 1,
      title: "Old title",
      tags: ["old"],
      contentMarkdown: "old body",
      contentText: "old body",
      contentHash: "hash",
      createdBy: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await putLocalMemoRevisions(scope, [revision]);
    expect((await listLocalMemoRevisions(scope, memo.id)).revisions[0]?.id).toBe(revision.id);
    expect((await getLocalMemoRevision(scope, memo.id, revision.id))?.contentMarkdown).toBe("old body");
  });

  test("caches resource metadata without storing resource bytes", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    await putLocalResource(scope, {
      id: "resource-1",
      memoId: "memo-1",
      originalMemoId: null,
      kind: "attachment",
      mimeType: "text/plain",
      filename: "readme.txt",
      byteSize: 12,
      sha256: "hash",
      width: null,
      height: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      url: "/api/v1/resources/resource-1/blob",
      memoTitle: "Memo",
      memoExcerpt: "Excerpt",
      memoDeleted: false,
    });
    const result = await listLocalResources(scope);
    expect(result.resources[0]?.filename).toBe("readme.txt");
    expect(result.summary).toEqual({ totalCount: 1, totalBytes: 12, imageCount: 0, attachmentCount: 1 });
  });

  test("stages resource bytes for offline upload", async () => {
    const previousCaches = globalThis.caches;
    const entries = new Map();
    globalThis.caches = {
      open: async () => ({
        put: async (key, response) => entries.set(key, response),
        match: async (key) => entries.get(key) ?? undefined,
        delete: async (key) => entries.delete(key),
      }),
    };
    try {
      const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
      const resource = await createLocalResource(scope, "memo-1", new File(["offline bytes"], "offline.txt", { type: "text/plain" }));
      const cached = await getCachedLocalResourceBytes(resource.url);
      expect(resource.id).toStartWith("local_resource_");
      expect(await cached?.text()).toBe("offline bytes");
      expect((await listLocalResources(scope)).resources[0]?.url).toBe(resource.url);
      await replaceLocalResources(scope, []);
      expect((await listLocalResources(scope)).resources[0]?.id).toBe(resource.id);
    } finally {
      globalThis.caches = previousCaches;
    }
  });
});
