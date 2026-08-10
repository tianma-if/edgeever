import { afterEach, describe, expect, test } from "bun:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const { localDb } = await import("./local-db.ts");
const { api } = await import("./api.ts");
const { createLocalDataScope, createLocalMemo, getLocalMemo, putLocalMemo, replaceLocalMemoId, createLocalResource, listLocalResources } = await import("./local-mirror.ts");
const { discardWebConflicts, getMemoUpdateQueueId, queueLocalAction, queueMemoCreate, queueMemoUpdate, syncQueuedChanges } = await import("./sync-queue.ts");

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

describe("web sync conflict recovery", () => {
  test("preserves a newer draft written while a memo update is in flight", async () => {
    const previousOnline = globalThis.navigator?.onLine;
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const createdMemo = await createLocalMemo(scope, { notebookId: "inbox" });
    const remoteMemo = {
      ...createdMemo,
      id: "memo-draft-in-flight",
      revision: 1,
      contentHash: "hash-1",
    };
    const syncedContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "synced snapshot" }] }] };
    const newerContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "still typing" }] }] };
    await putLocalMemo(scope, remoteMemo);
    await queueMemoUpdate({
      memoId: remoteMemo.id,
      expectedRevision: 1,
      expectedContentHash: "hash-1",
      editSessionId: "edit-a",
      title: "Synced snapshot",
      contentJson: syncedContent,
      tags: [],
    }, scope);

    let updateStarted;
    let releaseUpdate;
    const updateStartedPromise = new Promise((resolve) => { updateStarted = resolve; });
    const releaseUpdatePromise = new Promise((resolve) => { releaseUpdate = resolve; });
    const original = {
      createMemoEditSession: api.createMemoEditSession,
      updateMemo: api.updateMemo,
    };
    api.createMemoEditSession = async () => ({ editSession: { id: "fresh-edit", baseRevision: 1, baseContentHash: "hash-1" } });
    api.updateMemo = async (_memoId, payload) => {
      updateStarted();
      await releaseUpdatePromise;
      return { memo: { ...remoteMemo, ...payload, revision: 2, contentHash: "hash-2" } };
    };

    try {
      const callbackOrder = [];
      const syncing = syncQueuedChanges({
        scope,
        onMemoAcknowledged: () => callbackOrder.push("acknowledged"),
        onSynced: () => callbackOrder.push("synced"),
      });
      await updateStartedPromise;
      await localDb.drafts.put({
        memoId: remoteMemo.id,
        title: "Still typing",
        tagsText: "",
        contentJson: newerContent,
        updatedAt: "2099-01-01T00:00:00.000Z",
      });
      releaseUpdate();

      expect(await syncing).toMatchObject({ synced: 1, conflicted: 0 });
      expect(callbackOrder).toEqual(["acknowledged", "synced"]);
      expect(await localDb.drafts.get(remoteMemo.id)).toMatchObject({
        title: "Still typing",
        contentJson: newerContent,
      });
    } finally {
      api.createMemoEditSession = original.createMemoEditSession;
      api.updateMemo = original.updateMemo;
      if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: previousOnline });
    }
  });

  test("preserves a draft written while a new memo create request is in flight", async () => {
    const previousOnline = globalThis.navigator?.onLine;
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const localMemo = await createLocalMemo(scope, { notebookId: "inbox" });
    await queueMemoCreate(scope, {
      temporaryId: localMemo.id,
      notebookId: localMemo.notebookId,
      title: "",
      contentMarkdown: "",
      tags: [],
      createdAt: localMemo.createdAt,
      updatedAt: localMemo.updatedAt,
    });

    let createStarted;
    let releaseCreate;
    const createStartedPromise = new Promise((resolve) => { createStarted = resolve; });
    const releaseCreatePromise = new Promise((resolve) => { releaseCreate = resolve; });
    const remoteMemo = {
      ...localMemo,
      id: "memo-remote",
      revision: 1,
      contentHash: "remote-empty-hash",
    };
    const originalCreateMemo = api.createMemo;
    api.createMemo = async () => {
      createStarted();
      await releaseCreatePromise;
      return { memo: remoteMemo };
    };

    try {
      const syncing = syncQueuedChanges({
        scope,
        onSynced: async (memo, item) => {
          if (item.kind === "memo.create") await replaceLocalMemoId(scope, item.memoId, memo);
        },
      });
      await createStartedPromise;
      await localDb.drafts.put({
        memoId: localMemo.id,
        title: "Pasted while syncing",
        tagsText: "important",
        contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "must survive" }] }] },
        updatedAt: "2099-01-01T00:00:00.000Z",
      });
      releaseCreate();

      expect(await syncing).toMatchObject({ synced: 1, failed: 0 });
      expect(await localDb.drafts.get(localMemo.id)).toBeUndefined();
      expect(await localDb.drafts.get(remoteMemo.id)).toMatchObject({ title: "Pasted while syncing" });
      expect(await getLocalMemo(scope, remoteMemo.id)).toMatchObject({
        title: "Pasted while syncing",
        contentText: "must survive",
        revision: remoteMemo.revision,
        contentHash: remoteMemo.contentHash,
      });
    } finally {
      api.createMemo = originalCreateMemo;
      if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: previousOnline });
    }
  });

  test("rebases an edit queued before a new memo receives its remote id", async () => {
    const previousOnline = globalThis.navigator?.onLine;
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const localMemo = await createLocalMemo(scope, { notebookId: "inbox" });
    await queueMemoCreate(scope, {
      temporaryId: localMemo.id,
      notebookId: localMemo.notebookId,
      title: "",
      contentMarkdown: "",
      tags: [],
      createdAt: localMemo.createdAt,
      updatedAt: localMemo.updatedAt,
    });
    await queueMemoUpdate({
      memoId: localMemo.id,
      expectedRevision: 0,
      expectedContentHash: localMemo.contentHash,
      editSessionId: `local-edit:${localMemo.id}`,
      title: "Queued edit",
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "queued body" }] }] },
      tags: [],
    }, scope);
    const remoteMemo = { ...localMemo, id: "memo-remote-rebased", revision: 3, contentHash: "remote-base-hash" };
    const original = {
      createMemo: api.createMemo,
      createMemoEditSession: api.createMemoEditSession,
      updateMemo: api.updateMemo,
    };
    let receivedUpdate = null;
    api.createMemo = async () => ({ memo: remoteMemo });
    api.createMemoEditSession = async () => ({
      editSession: {
        id: "fresh-remote-session",
        baseRevision: remoteMemo.revision,
        baseContentHash: remoteMemo.contentHash,
      },
    });
    api.updateMemo = async (_memoId, payload) => {
      receivedUpdate = payload;
      return { memo: { ...remoteMemo, ...payload, revision: remoteMemo.revision + 1, contentHash: "updated-hash" } };
    };

    try {
      await syncQueuedChanges({ scope });
      const update = await localDb.syncQueue.get(getMemoUpdateQueueId(remoteMemo.id));
      expect(update).toMatchObject({
        memoId: remoteMemo.id,
        payload: {
          memoId: remoteMemo.id,
          expectedRevision: remoteMemo.revision,
          expectedContentHash: remoteMemo.contentHash,
          title: "Queued edit",
        },
      });
      expect(await localDb.syncQueue.get(getMemoUpdateQueueId(localMemo.id))).toBeUndefined();

      expect(await syncQueuedChanges({ scope })).toMatchObject({ synced: 1, conflicted: 0 });
      expect(receivedUpdate).toMatchObject({
        expectedRevision: remoteMemo.revision,
        expectedContentHash: remoteMemo.contentHash,
        editSessionId: "fresh-remote-session",
        title: "Queued edit",
      });
      expect(await localDb.syncQueue.get(getMemoUpdateQueueId(remoteMemo.id))).toBeUndefined();
    } finally {
      api.createMemo = original.createMemo;
      api.createMemoEditSession = original.createMemoEditSession;
      api.updateMemo = original.updateMemo;
      if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: previousOnline });
    }
  });

  test("restores the authoritative remote memo and removes the conflict", async () => {
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const memo = await createLocalMemo(scope, { notebookId: "inbox", title: "Local draft" });
    const remote = { ...memo, title: "Remote version", revision: 4 };
    const originalGetMemo = api.getMemo;
    api.getMemo = async () => ({ memo: remote });
    await localDb.syncQueue.put({
      id: "memo.update:conflict",
      kind: "memo.update",
      scope,
      memoId: memo.id,
      status: "conflict",
      payload: { memoId: memo.id, expectedRevision: 0, expectedContentHash: memo.contentHash, editSessionId: "session", title: "Local draft", contentJson: memo.contentJson, tags: [] },
      attemptCount: 1,
      lastError: "conflict",
      nextAttemptAt: null,
      claimId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(await discardWebConflicts(scope)).toBe(1);
    expect((await getLocalMemo(scope, memo.id))?.title).toBe("Remote version");
    expect(await localDb.syncQueue.get("memo.update:conflict")).toBeUndefined();
    api.getMemo = originalGetMemo;
  });

  test("uploads an offline resource and rewrites its memo reference", async () => {
    const previousCaches = globalThis.caches;
    const previousOnline = globalThis.navigator?.onLine;
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const entries = new Map();
    globalThis.caches = {
      open: async () => ({
        put: async (key, response) => entries.set(key, response),
        match: async (key) => entries.get(key) ?? undefined,
        delete: async (key) => entries.delete(key),
      }),
    };
    const scope = createLocalDataScope("https://demo.edgeever.org", "user-1");
    const memo = await createLocalMemo(scope, { notebookId: "inbox", title: "With file" });
    const staged = await createLocalResource(scope, memo.id, new File(["offline"], "offline.txt", { type: "text/plain" }));
    const localMemo = await getLocalMemo(scope, memo.id);
    const placeholderMemo = {
      ...localMemo,
      contentMarkdown: `[offline](${staged.url})`,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: staged.url }] }] },
    };
    await putLocalMemo(scope, placeholderMemo);
    await queueLocalAction(scope, "resource.create", staged.id, {
      resourceId: staged.id,
      memoId: memo.id,
      filename: staged.filename,
      mimeType: staged.mimeType,
      url: staged.url,
    }, memo.id);

    const original = {
      uploadMemoResource: api.uploadMemoResource,
      getMemo: api.getMemo,
      createMemoEditSession: api.createMemoEditSession,
      updateMemo: api.updateMemo,
    };
    const remoteResource = { ...staged, id: "resource-remote", url: "/api/v1/resources/resource-remote/blob" };
    const remoteMemo = { ...placeholderMemo, contentMarkdown: `[offline](${staged.url})` };
    api.uploadMemoResource = async () => ({ resource: remoteResource });
    api.getMemo = async () => ({ memo: remoteMemo });
    api.createMemoEditSession = async () => ({ editSession: { id: "edit-1", baseRevision: 1, baseContentHash: remoteMemo.contentHash } });
    api.updateMemo = async (_memoId, payload) => ({ memo: { ...remoteMemo, ...payload, contentHash: "patched", revision: 2 } });

    try {
      const result = await syncQueuedChanges({ scope });
      expect(result.synced).toBe(1);
      expect((await getLocalMemo(scope, memo.id))?.contentMarkdown).toContain(remoteResource.url);
      expect((await listLocalResources(scope)).resources[0]?.id).toBe(remoteResource.id);
      expect(await localDb.syncQueue.count()).toBe(0);
    } finally {
      api.uploadMemoResource = original.uploadMemoResource;
      api.getMemo = original.getMemo;
      api.createMemoEditSession = original.createMemoEditSession;
      api.updateMemo = original.updateMemo;
      globalThis.caches = previousCaches;
      if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: previousOnline });
    }
  });
});
