import { afterEach, describe, expect, test } from "bun:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const { localDb } = await import("./local-db.ts");
const { api } = await import("./api.ts");
const { createLocalDataScope, createLocalMemo, getLocalMemo, putLocalMemo, createLocalResource, listLocalResources } = await import("./local-mirror.ts");
const { discardWebConflicts, queueLocalAction, syncQueuedChanges } = await import("./sync-queue.ts");

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
