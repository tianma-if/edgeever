import { afterEach, describe, expect, test } from "bun:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const { localDb } = await import("./local-db.ts");
const { api } = await import("./api.ts");
const { createWebRepository } = await import("./repository.ts");
const { createLocalMemo, putLocalMemo } = await import("./local-mirror.ts");

const installTestWindow = ({ hostname = "localhost" } = {}) => {
  const previousWindow = globalThis.window;
  const eventTarget = new EventTarget();
  globalThis.window = Object.assign(eventTarget, {
    location: { hostname, href: `http://${hostname}/` },
  });
  return () => {
    if (previousWindow !== undefined) globalThis.window = previousWindow;
  };
};

afterEach(async () => {
  await localDb.transaction("rw", [localDb.drafts, localDb.templates, localDb.notebooks, localDb.memos, localDb.resources, localDb.revisions, localDb.syncMeta, localDb.syncQueue], async () => {
    await Promise.all([
      localDb.drafts.clear(),
      localDb.templates.clear(),
      localDb.notebooks.clear(),
      localDb.memos.clear(),
      localDb.resources.clear(),
      localDb.revisions.clear(),
      localDb.syncMeta.clear(),
      localDb.syncQueue.clear(),
    ]);
  });
});

describe("web repository offline boundaries", () => {
  test("keeps remote continuation tokens opaque when skipping later-page counts", async () => {
    const scope = "https://demo.edgeever.org|user-1";
    const original = api.listMemos;
    let received;
    api.listMemos = async (params) => { received = params; return { memos: [], nextCursor: null }; };
    try {
      const result = await createWebRepository(scope).listMemos({ cursor: "opaque-continuation", offset: Number.NaN, includeTotal: false });
      expect(received.cursor).toBe("opaque-continuation");
      expect(received.includeTotal).toBe(false);
      expect(result.totalCount).toBeUndefined();
    } finally { api.listMemos = original; }
  });

  test("empty trash records the removed memo ids for conflict cleanup after sync", async () => {
    const restoreWindow = installTestWindow();
    const scope = "https://demo.edgeever.org|user-1";
    const trashed = await createLocalMemo(scope, { notebookId: "nb-1" });
    const active = await createLocalMemo(scope, { notebookId: "nb-1" });
    await putLocalMemo(scope, { ...trashed, isDeleted: true });
    try {
      expect(await createWebRepository(scope).emptyTrash()).toEqual({ ok: true, deleted: 1 });
      await putLocalMemo(scope, { ...active, isDeleted: true });
      expect(await createWebRepository(scope).emptyTrash()).toEqual({ ok: true, deleted: 1 });
      const action = await localDb.syncQueue.get(`action:${scope}:memo.emptyTrash:trash`);
      expect(action?.payload).toEqual({ memoIds: [trashed.id, active.id] });
      expect(await localDb.memos.get([scope, active.id])).toBeUndefined();
    } finally {
      restoreWindow();
    }
  });

  test("reconciles stale template cache entries while preserving queued local edits", async () => {
    const previousOnline = globalThis.navigator?.onLine;
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const restoreWindow = installTestWindow();
    const scope = "https://demo.edgeever.org|user-1";
    const template = (id, name, updatedAt) => ({
      id,
      name,
      description: null,
      title: name,
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "",
      tags: [],
      createdAt: updatedAt,
      updatedAt,
    });
    const stale = template("template-stale", "Stale", "2026-01-01T00:00:00.000Z");
    const edited = template("template-edited", "Local edit", "2026-01-03T00:00:00.000Z");
    const remoteEdited = template("template-edited", "Remote old", "2026-01-02T00:00:00.000Z");
    const remote = template("template-remote", "Remote", "2026-01-04T00:00:00.000Z");
    await localDb.templates.bulkPut([{ ...stale, scope }, { ...edited, scope }]);
    await localDb.syncQueue.put({
      id: `action:${scope}:template.update:${edited.id}`,
      kind: "template.update",
      scope,
      memoId: edited.id,
      status: "pending",
      payload: { templateId: edited.id, name: edited.name },
      attemptCount: 0,
      lastError: null,
      nextAttemptAt: null,
      claimId: null,
      createdAt: edited.updatedAt,
      updatedAt: edited.updatedAt,
    });
    const originalListTemplates = api.listTemplates;
    api.listTemplates = async () => ({ templates: [remote, remoteEdited] });

    try {
      const result = await createWebRepository(scope).listTemplates();
      expect(result.templates.map((item) => item.id)).toEqual([remote.id, edited.id]);
      expect(result.templates.find((item) => item.id === edited.id)?.name).toBe("Local edit");
      expect(await localDb.templates.get([scope, stale.id])).toBeUndefined();
    } finally {
      api.listTemplates = originalListTemplates;
      restoreWindow();
      if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: previousOnline });
    }
  });

  test("saves memo edits locally while deferring remote synchronization", async () => {
    const restoreWindow = installTestWindow();
    let immediateEvents = 0;
    let deferredEvents = 0;
    window.addEventListener("edgeever:sync-queue-changed", () => {
      immediateEvents += 1;
    });
    window.addEventListener("edgeever:sync-queue-deferred", () => {
      deferredEvents += 1;
    });

    try {
      const scope = "https://demo.edgeever.org|user-1";
      const memo = await createLocalMemo(scope, { notebookId: "nb-1" });
      const repository = createWebRepository(scope);
      const contentJson = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Saved locally" }] }],
      };

      const result = await repository.updateMemo(memo, {
        expectedRevision: memo.revision,
        expectedContentHash: memo.contentHash,
        editSessionId: "local-edit",
        title: "",
        contentJson,
        tags: [],
      });

      expect(result.memo.contentText).toBe("Saved locally");
      expect(await localDb.syncQueue.get(`memo.update:${memo.id}`)).toBeDefined();
      expect(deferredEvents).toBe(1);
      expect(immediateEvents).toBe(0);
    } finally {
      restoreWindow();
    }
  });

  test("rolls back the local memo when queuing its sync update fails", async () => {
    const restoreWindow = installTestWindow();
    const scope = "https://demo.edgeever.org|user-1";
    const memo = await createLocalMemo(scope, { notebookId: "nb-1", contentMarkdown: "Original" });
    const failQueueWrite = () => { throw new Error("queue unavailable"); };
    localDb.syncQueue.hook("creating", failQueueWrite);

    try {
      await expect(createWebRepository(scope).updateMemo(memo, {
        expectedRevision: memo.revision,
        expectedContentHash: memo.contentHash,
        editSessionId: "local-edit",
        title: "Changed",
        contentJson: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Changed" }] }],
        },
        tags: [],
      })).rejects.toThrow("queue unavailable");

      expect((await localDb.memos.get([scope, memo.id]))?.contentText).toBe("Original");
      expect(await localDb.syncQueue.get(`memo.update:${memo.id}`)).toBeUndefined();
    } finally {
      localDb.syncQueue.hook("creating").unsubscribe(failQueueWrite);
      restoreWindow();
    }
  });

  test("uses the remote detail when the local database is blocked and navigator falsely reports offline", async () => {
    const previousOnline = globalThis.navigator?.onLine;
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: false });
    const scope = "https://demo.edgeever.org|user-1";
    const remoteMemo = {
      id: "memo-blocked",
      notebookId: "nb-1",
      title: "Remote detail",
      excerpt: "Remote excerpt",
      tags: [],
      isPinned: false,
      isArchived: false,
      isDeleted: false,
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "remote",
      contentText: "remote",
      contentHash: "remote",
      sourceMemoIds: [],
    };
    const originalLocalGet = localDb.memos.get;
    const originalLocalPut = localDb.memos.put;
    const originalApiGetMemo = api.getMemo;
    localDb.memos.get = async () => new Promise(() => {});
    localDb.memos.put = async () => new Promise(() => {});
    api.getMemo = async () => ({ memo: remoteMemo });

    try {
      const repository = createWebRepository(scope);
      const startedAt = Date.now();
      expect((await repository.getMemo("memo-blocked")).memo.title).toBe("Remote detail");
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      localDb.memos.get = originalLocalGet;
      localDb.memos.put = originalLocalPut;
      api.getMemo = originalApiGetMemo;
      if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: previousOnline });
    }
  });

  test("returns cached detail immediately and refreshes it in the background", async () => {
    const previousOnline = globalThis.navigator?.onLine;
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const restoreWindow = installTestWindow();
    const scope = "https://demo.edgeever.org|user-1";
    const localMemo = {
      id: "memo-1",
      notebookId: "nb-1",
      title: "Cached title",
      excerpt: "Cached excerpt",
      tags: [],
      isPinned: false,
      isArchived: false,
      isDeleted: false,
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "cached",
      contentText: "cached",
      contentHash: "cached",
      sourceMemoIds: [],
      mergeSourceCount: 0,
      mergedIntoMemoId: null,
    };
    const remoteMemo = { ...localMemo, title: "Remote title", contentMarkdown: "remote", contentText: "remote", revision: 2 };
    await localDb.memos.put({ ...localMemo, scope });
    const originalGetMemo = api.getMemo;
    api.getMemo = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { memo: remoteMemo };
    };

    try {
      const repository = createWebRepository(scope);
      expect((await repository.getMemo("memo-1")).memo.title).toBe("Cached title");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await localDb.memos.get([scope, "memo-1"])).title).toBe("Remote title");
    } finally {
      api.getMemo = originalGetMemo;
      restoreWindow();
      if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: previousOnline });
    }
  });

  test("does not overwrite a newer local autosave with a stale remote detail", async () => {
    const previousOnline = globalThis.navigator?.onLine;
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const restoreWindow = installTestWindow();
    let refreshEvents = 0;
    window.addEventListener("edgeever:memo-detail-refreshed", () => {
      refreshEvents += 1;
    });

    const scope = "https://demo.edgeever.org|user-1";
    const localMemo = {
      id: "memo-stale-remote",
      notebookId: "nb-1",
      title: "Local autosave",
      excerpt: "local",
      tags: [],
      isPinned: false,
      isArchived: false,
      isDeleted: false,
      revision: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T12:00:01.000Z",
      deletedAt: null,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "local" }] }] },
      contentMarkdown: "local",
      contentText: "local",
      contentHash: "local-hash",
      sourceMemoIds: [],
      mergeSourceCount: 0,
      mergedIntoMemoId: null,
    };
    // Same revision, older updatedAt — the classic "server has not received the autosave yet" case.
    const remoteMemo = {
      ...localMemo,
      title: "Stale remote",
      excerpt: "remote",
      updatedAt: "2026-01-02T12:00:00.000Z",
      contentMarkdown: "remote",
      contentText: "remote",
      contentHash: "remote-hash",
    };
    await localDb.memos.put({ ...localMemo, scope });
    await localDb.syncQueue.put({
      id: `memo.update:${localMemo.id}`,
      kind: "memo.update",
      scope,
      memoId: localMemo.id,
      status: "pending",
      payload: {
        memoId: localMemo.id,
        expectedRevision: 3,
        expectedContentHash: "local-hash",
        editSessionId: "edit-1",
        title: "Local autosave",
        contentJson: localMemo.contentJson,
        tags: [],
      },
      attemptCount: 0,
      lastError: null,
      nextAttemptAt: null,
      claimId: null,
      createdAt: localMemo.updatedAt,
      updatedAt: localMemo.updatedAt,
    });

    const originalGetMemo = api.getMemo;
    api.getMemo = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { memo: remoteMemo };
    };

    try {
      const repository = createWebRepository(scope);
      expect((await repository.getMemo(localMemo.id)).memo.title).toBe("Local autosave");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await localDb.memos.get([scope, localMemo.id])).title).toBe("Local autosave");
      expect(refreshEvents).toBe(0);
    } finally {
      api.getMemo = originalGetMemo;
      restoreWindow();
      if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: previousOnline });
    }
  });

  test("does not prefer a stale remote that wins the local/remote race", async () => {
    const previousOnline = globalThis.navigator?.onLine;
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
    const restoreWindow = installTestWindow();

    const scope = "https://demo.edgeever.org|user-1";
    const localMemo = {
      id: "memo-race",
      notebookId: "nb-1",
      title: "Local wins",
      excerpt: "local",
      tags: [],
      isPinned: false,
      isArchived: false,
      isDeleted: false,
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T12:00:01.000Z",
      deletedAt: null,
      contentJson: { type: "doc", content: [] },
      contentMarkdown: "local",
      contentText: "local",
      contentHash: "local",
      sourceMemoIds: [],
      mergeSourceCount: 0,
      mergedIntoMemoId: null,
    };
    const remoteMemo = {
      ...localMemo,
      title: "Stale remote race",
      updatedAt: "2026-01-02T12:00:00.000Z",
      contentMarkdown: "remote",
      contentText: "remote",
    };
    await localDb.memos.put({ ...localMemo, scope });

    const originalGetMemo = api.getMemo;
    const originalLocalGet = localDb.memos.get;
    api.getMemo = async () => ({ memo: remoteMemo });
    // Delay local read so remote wins Promise.race.
    localDb.memos.get = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return originalLocalGet.apply(localDb.memos, args);
    };

    try {
      const repository = createWebRepository(scope);
      const result = await repository.getMemo(localMemo.id);
      expect(result.memo.title).toBe("Local wins");
      localDb.memos.get = originalLocalGet;
      expect((await localDb.memos.get([scope, localMemo.id])).title).toBe("Local wins");
    } finally {
      api.getMemo = originalGetMemo;
      localDb.memos.get = originalLocalGet;
      restoreWindow();
      if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: previousOnline });
    }
  });

  test("returns empty initialized collections without cloud fallbacks", async () => {
    const previousOnline = globalThis.navigator?.onLine;
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: false });
    // Non-loopback host so navigator.onLine=false is treated as offline.
    const restoreWindow = installTestWindow({ hostname: "demo.edgeever.org" });
    const scope = "https://demo.edgeever.org|user-1";
    await localDb.syncMeta.put({ scope, key: "identity", value: "sync-1", updatedAt: new Date().toISOString() });
    const original = {
      listTags: api.listTags,
      listTemplates: api.listTemplates,
      listResources: api.listResources,
      listNotebooks: api.listNotebooks,
    };
    api.listTags = async () => { throw new Error("cloud fallback"); };
    api.listTemplates = async () => { throw new Error("cloud fallback"); };
    api.listResources = async () => { throw new Error("cloud fallback"); };
    api.listNotebooks = async () => { throw new Error("cloud fallback"); };

    try {
      const repository = createWebRepository(scope);
      expect(await repository.listTags()).toEqual({ tags: [] });
      expect(await repository.listTemplates()).toEqual({ templates: [] });
      expect(await repository.listResources()).toEqual({ resources: [], summary: { totalCount: 0, totalBytes: 0, imageCount: 0, attachmentCount: 0 } });
      expect((await repository.listNotebooks()).notebooks).toEqual([]);
    } finally {
      api.listTags = original.listTags;
      api.listTemplates = original.listTemplates;
      api.listResources = original.listResources;
      api.listNotebooks = original.listNotebooks;
      restoreWindow();
      if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: previousOnline });
    }
  });
});

describe("guarded plugin saves in the Web repository", () => {
  test("checks the local snapshot inside the transaction even when the cloud revision has not advanced", async () => {
    const restoreWindow = installTestWindow();
    try {
      const scope = "guarded-plugins";
      const memo = await createLocalMemo(scope, { notebookId: "nb", contentMarkdown: "Original" });
      const repository = createWebRepository(scope);
      const input = text => ({ expectedRevision: memo.revision, expectedContentHash: memo.contentHash, editSessionId: "plugin", title: "", tags: [],
        contentMarkdown: text, contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } });
      const result = await Promise.allSettled([
        repository.updateMemo(memo, input("First"), { guardLocalSnapshot: true }),
        repository.updateMemo(memo, input("Second"), { guardLocalSnapshot: true }),
      ]);
      expect(result.map(item => item.status)).toEqual(["fulfilled", "rejected"]);
      expect(result[1].reason).toMatchObject({ code: "NOTE_CONFLICT" });
      expect((await localDb.memos.get([scope, memo.id])).contentMarkdown).toBe("First");
      expect((await localDb.syncQueue.get(`memo.update:${memo.id}`)).payload.contentMarkdown).toBe("First");
    } finally { restoreWindow(); }
  });

  test("preserves conflict contents and queue diagnostics until explicitly resolved", async () => {
    const restoreWindow = installTestWindow();
    try {
      const scope = "guarded-plugins";
      const memo = await createLocalMemo(scope, { notebookId: "nb", contentMarkdown: "Local conflict" });
      const conflict = { id: `memo.update:${memo.id}`, memoId: memo.id, scope, kind: "memo.update", status: "conflict", payload: { contentMarkdown: "Local conflict" },
        attemptCount: 1, lastError: "Remote edit", lastErrorCode: "revision_conflict", claimId: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
      await localDb.syncQueue.put(conflict);
      await expect(createWebRepository(scope).updateMemo(memo, {
        expectedRevision: memo.revision, expectedContentHash: memo.contentHash, editSessionId: "plugin", title: "Changed", contentJson: memo.contentJson, tags: [],
      }, { guardLocalSnapshot: true })).rejects.toMatchObject({ code: "NOTE_CONFLICT" });
      expect(await localDb.syncQueue.get(conflict.id)).toEqual(conflict);
      expect((await localDb.memos.get([scope, memo.id])).contentMarkdown).toBe("Local conflict");
    } finally { restoreWindow(); }
  });
});

describe("note duplication in the Web repository", () => {
  test("copies on the server and keeps the copy in the local mirror", async () => {
    const restoreWindow = installTestWindow();
    const duplicate = api.duplicateMemo;
    const calls = [];
    const scope = "https://demo.edgeever.org|user-1";
    const copy = { ...(await createLocalMemo(scope, { notebookId: "nb-1" })), id: "memo_copy", title: "Plan (copy)" };
    api.duplicateMemo = async (memoId, input) => {
      calls.push({ memoId, input });
      return { memo: copy };
    };
    try {
      const result = await createWebRepository(scope).duplicateMemo("memo_plan", { title: "Plan (copy)" });

      expect(calls).toEqual([{ memoId: "memo_plan", input: { title: "Plan (copy)" } }]);
      expect(result.memo).toEqual(copy);
      const { getLocalMemo } = await import("./local-mirror.ts");
      expect((await getLocalMemo(scope, "memo_copy"))?.title).toBe("Plan (copy)");
    } finally {
      api.duplicateMemo = duplicate;
      restoreWindow();
    }
  });

  test("never copies a note in an unresolved sync conflict", async () => {
    const restoreWindow = installTestWindow();
    const duplicate = api.duplicateMemo;
    const calls = [];
    api.duplicateMemo = async (memoId) => {
      calls.push(memoId);
      return { memo: { id: "memo_copy" } };
    };
    const scope = "https://demo.edgeever.org|user-1";
    try {
      await localDb.syncQueue.put({
        id: "memo.update:memo_conflicted",
        kind: "memo.update",
        scope,
        memoId: "memo_conflicted",
        status: "conflict",
        payload: { memoId: "memo_conflicted" },
        attemptCount: 1,
        lastError: "Memo was updated elsewhere",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nextAttemptAt: null,
      });

      await expect(createWebRepository(scope).duplicateMemo("memo_conflicted", { title: "Copy" }))
        .rejects.toThrow("memo_duplicate_pending_changes");
      expect(calls).toEqual([]);
    } finally {
      api.duplicateMemo = duplicate;
      restoreWindow();
    }
  });

  test("never copies a note whose local edits could not be synchronized", async () => {
    const restoreWindow = installTestWindow();
    const duplicate = api.duplicateMemo;
    const calls = [];
    api.duplicateMemo = async (memoId) => {
      calls.push(memoId);
      return { memo: { id: "memo_copy" } };
    };
    const scope = "https://demo.edgeever.org|user-1";
    try {
      const memo = await createLocalMemo(scope, { notebookId: "nb-1" });
      const repository = createWebRepository(scope);
      await repository.updateMemo(memo, {
        expectedRevision: memo.revision,
        expectedContentHash: memo.contentHash,
        editSessionId: "local-edit",
        title: "Edited offline",
        contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Unsynced" }] }] },
        tags: [],
      });

      await expect(repository.duplicateMemo(memo.id, { title: "Copy" })).rejects.toThrow("memo_duplicate_pending_changes");
      expect(calls).toEqual([]);
    } finally {
      api.duplicateMemo = duplicate;
      restoreWindow();
    }
  });
});

const SCOPE = "https://demo.edgeever.org|user-1";

const stubApi = (overrides) => {
  const original = {};
  for (const [key, value] of Object.entries(overrides)) {
    original[key] = api[key];
    api[key] = value;
  }
  return () => Object.assign(api, original);
};

// Offline requires navigator.onLine=false on a non-loopback host.
const installNetwork = ({ online }) => {
  const previousOnline = globalThis.navigator?.onLine;
  if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: online });
  const restoreWindow = installTestWindow({ hostname: online ? "localhost" : "demo.edgeever.org" });
  return () => {
    restoreWindow();
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: previousOnline });
  };
};

const installFakeCaches = () => {
  const previous = globalThis.caches;
  const store = new Map();
  const cache = {
    put: async (url, response) => { store.set(String(url), await response.blob()); },
    match: async (url) => (store.has(String(url)) ? new Response(store.get(String(url))) : undefined),
    delete: async (url) => store.delete(String(url)),
  };
  globalThis.caches = { open: async () => cache };
  return {
    store,
    restore: () => {
      if (previous === undefined) delete globalThis.caches;
      else globalThis.caches = previous;
    },
  };
};

const notebookFixture = (id, overrides = {}) => ({
  id,
  parentId: null,
  name: id,
  slug: null,
  icon: null,
  color: null,
  sortOrder: 0,
  memoCount: 0,
  lastMemoUpdatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const templateFixture = (id, overrides = {}) => ({
  id,
  name: id,
  description: null,
  title: `${id} title`,
  contentJson: { type: "doc", content: [] },
  contentMarkdown: `${id} body`,
  tags: ["from-template"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const resourceFixture = (id, overrides = {}) => ({
  id,
  memoId: "memo-1",
  originalMemoId: null,
  kind: "attachment",
  mimeType: "text/plain",
  filename: `${id}.txt`,
  byteSize: 4,
  sha256: null,
  width: null,
  height: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  url: `/api/v1/resources/${id}/blob`,
  memoTitle: null,
  memoExcerpt: null,
  memoDeleted: false,
  ...overrides,
});

const remoteMemoFixture = (id, overrides = {}) => ({
  id,
  notebookId: "nb-1",
  title: "Remote",
  excerpt: "remote",
  tags: [],
  isPinned: false,
  isArchived: false,
  isDeleted: false,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  contentJson: { type: "doc", content: [] },
  contentMarkdown: "remote",
  contentText: "remote",
  contentHash: "remote",
  sourceMemoIds: [],
  mergeSourceCount: 0,
  mergedIntoMemoId: null,
  ...overrides,
});

const queuedAction = (kind, entityId) => localDb.syncQueue.get(`action:${SCOPE}:${kind}:${entityId}`);
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("web repository notebooks", () => {
  test("loads notebooks from the server on a cold mirror without resurrecting a pending delete", async () => {
    const restoreNetwork = installNetwork({ online: true });
    await localDb.syncQueue.put({
      id: `action:${SCOPE}:notebook.delete:nb-deleted`, kind: "notebook.delete", scope: SCOPE, memoId: "nb-deleted", status: "pending",
      payload: { notebookId: "nb-deleted", notebookIds: ["nb-deleted"] }, attemptCount: 0, lastError: null, nextAttemptAt: null,
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
    });
    const restoreApi = stubApi({ listNotebooks: async () => ({ notebooks: [notebookFixture("nb-kept"), notebookFixture("nb-deleted")] }) });
    try {
      const result = await createWebRepository(SCOPE).listNotebooks();
      expect(result.notebooks.map((notebook) => notebook.id)).toEqual(["nb-kept", "nb-deleted"]);
      expect(await localDb.notebooks.get([SCOPE, "nb-kept"])).toBeDefined();
      expect(await localDb.notebooks.get([SCOPE, "nb-deleted"])).toBeUndefined();
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("ignores a slower background notebook refresh that was superseded by a newer one", async () => {
    const restoreNetwork = installNetwork({ online: true });
    await localDb.notebooks.put({ ...notebookFixture("nb-local"), scope: SCOPE });
    const responses = [
      async () => { await tick(40); return { notebooks: [notebookFixture("nb-stale")] }; },
      async () => ({ notebooks: [notebookFixture("nb-fresh")] }),
    ];
    const restoreApi = stubApi({ listNotebooks: () => responses.shift()() });
    try {
      const repository = createWebRepository(SCOPE);
      expect((await repository.listNotebooks()).notebooks.map((notebook) => notebook.id)).toEqual(["nb-local"]);
      await repository.listNotebooks();
      await tick(80);
      const stored = (await localDb.notebooks.where("scope").equals(SCOPE).toArray()).map((notebook) => notebook.id);
      expect(stored).toEqual(["nb-fresh"]);
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("returns local notebooks offline without contacting the server", async () => {
    const restoreNetwork = installNetwork({ online: false });
    await localDb.notebooks.put({ ...notebookFixture("nb-local"), scope: SCOPE });
    let calls = 0;
    const restoreApi = stubApi({ listNotebooks: async () => { calls += 1; return { notebooks: [] }; } });
    try {
      expect((await createWebRepository(SCOPE).listNotebooks()).notebooks.map((notebook) => notebook.id)).toEqual(["nb-local"]);
      await tick();
      expect(calls).toBe(0);
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("queues notebook creation under its temporary id and announces the queue change", async () => {
    const restoreNetwork = installNetwork({ online: true });
    let events = 0;
    window.addEventListener("edgeever:sync-queue-changed", () => { events += 1; });
    try {
      const { notebook } = await createWebRepository(SCOPE).createNotebook({ name: "  Projects  ", parentId: null });
      expect(notebook.id.startsWith("local_")).toBe(true);
      expect(notebook.name).toBe("Projects");
      expect((await queuedAction("notebook.create", notebook.id))?.payload).toEqual({ name: "  Projects  ", parentId: null, temporaryId: notebook.id });
      expect(events).toBe(1);
    } finally {
      restoreNetwork();
    }
  });

  test("updates a mirrored notebook locally and queues the change", async () => {
    const restoreNetwork = installNetwork({ online: true });
    await localDb.notebooks.put({ ...notebookFixture("nb-1"), scope: SCOPE });
    const restoreApi = stubApi({ updateNotebook: async () => { throw new Error("must not call the server"); } });
    try {
      const result = await createWebRepository(SCOPE).updateNotebook("nb-1", { name: "Renamed" });
      expect(result.notebook.name).toBe("Renamed");
      expect((await queuedAction("notebook.update", "nb-1"))?.payload).toEqual({ notebookId: "nb-1", name: "Renamed" });
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("updates an unmirrored notebook on the server when online and refuses offline", async () => {
    let restoreNetwork = installNetwork({ online: true });
    const restoreApi = stubApi({ updateNotebook: async (id, input) => ({ notebook: notebookFixture(id, input) }) });
    try {
      const result = await createWebRepository(SCOPE).updateNotebook("nb-remote", { name: "Server" });
      expect(result.notebook.name).toBe("Server");
      expect((await localDb.notebooks.get([SCOPE, "nb-remote"]))?.name).toBe("Server");
      expect(await queuedAction("notebook.update", "nb-remote")).toBeUndefined();
      restoreNetwork();
      restoreNetwork = installNetwork({ online: false });
      await expect(createWebRepository(SCOPE).updateNotebook("nb-missing", { name: "x" })).rejects.toThrow("Notebook is not available in the local mirror");
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("deletes an empty notebook tree leaves-first and refuses a notebook that still has notes", async () => {
    const restoreNetwork = installNetwork({ online: true });
    await localDb.notebooks.bulkPut([
      { ...notebookFixture("nb-parent"), scope: SCOPE },
      { ...notebookFixture("nb-child", { parentId: "nb-parent" }), scope: SCOPE },
      { ...notebookFixture("nb-full"), scope: SCOPE },
    ]);
    await createLocalMemo(SCOPE, { notebookId: "nb-full" });
    try {
      const repository = createWebRepository(SCOPE);
      expect(await repository.deleteNotebook("nb-parent")).toEqual({ ok: true });
      expect((await queuedAction("notebook.delete", "nb-parent"))?.payload).toEqual({ notebookId: "nb-parent", notebookIds: ["nb-child", "nb-parent"] });
      expect(await localDb.notebooks.get([SCOPE, "nb-child"])).toBeUndefined();

      await expect(repository.deleteNotebook("nb-full")).rejects.toThrow("notebook_not_empty");
      expect(await queuedAction("notebook.delete", "nb-full")).toBeUndefined();
      expect(await localDb.notebooks.get([SCOPE, "nb-full"])).toBeDefined();
    } finally {
      restoreNetwork();
    }
  });

  test("restores a notebook only with a connection and mirrors the result", async () => {
    let restoreNetwork = installNetwork({ online: false });
    const restoreApi = stubApi({ restoreNotebook: async (id) => ({ notebook: notebookFixture(id, { name: "Restored" }) }) });
    try {
      await expect(createWebRepository(SCOPE).restoreNotebook("nb-1")).rejects.toThrow("Notebook restore requires a connection");
      restoreNetwork();
      restoreNetwork = installNetwork({ online: true });
      expect((await createWebRepository(SCOPE).restoreNotebook("nb-1")).notebook.name).toBe("Restored");
      expect((await localDb.notebooks.get([SCOPE, "nb-1"]))?.name).toBe("Restored");
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });
});

describe("web repository templates", () => {
  test("falls back to the local templates when the server list fails", async () => {
    const restoreNetwork = installNetwork({ online: true });
    await localDb.templates.put({ ...templateFixture("template-local"), scope: SCOPE });
    const restoreApi = stubApi({ listTemplates: async () => { throw new Error("network down"); } });
    try {
      expect((await createWebRepository(SCOPE).listTemplates()).templates.map((template) => template.id)).toEqual(["template-local"]);
      expect(await localDb.templates.get([SCOPE, "template-local"])).toBeDefined();
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("hides a remote template whose deletion is still queued", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const repository = createWebRepository(SCOPE);
    await localDb.templates.put({ ...templateFixture("template-gone"), scope: SCOPE });
    await repository.deleteTemplate("template-gone");
    const restoreApi = stubApi({ listTemplates: async () => ({ templates: [templateFixture("template-gone"), templateFixture("template-kept")] }) });
    try {
      expect((await repository.listTemplates()).templates.map((template) => template.id)).toEqual(["template-kept"]);
      expect((await queuedAction("template.delete", "template-gone"))?.payload).toEqual({ templateId: "template-gone" });
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("creates and updates templates locally with queued sync actions", async () => {
    const restoreNetwork = installNetwork({ online: true });
    try {
      const repository = createWebRepository(SCOPE);
      const { template } = await repository.createTemplate({ name: "Daily", contentMarkdown: "# Day" });
      expect((await queuedAction("template.create", template.id))?.payload).toEqual({ name: "Daily", contentMarkdown: "# Day", temporaryId: template.id });
      const updated = await repository.updateTemplate(template.id, { name: "Daily log" });
      expect(updated.template.name).toBe("Daily log");
      expect(updated.template.contentMarkdown).toBe("# Day");
      expect((await queuedAction("template.update", template.id))?.payload).toEqual({ templateId: template.id, name: "Daily log" });
    } finally {
      restoreNetwork();
    }
  });

  test("updates an unmirrored template on the server online and refuses offline", async () => {
    let restoreNetwork = installNetwork({ online: true });
    const restoreApi = stubApi({ updateTemplate: async (id, input) => ({ template: templateFixture(id, input) }) });
    try {
      expect((await createWebRepository(SCOPE).updateTemplate("template-remote", { name: "Server" })).template.name).toBe("Server");
      expect((await localDb.templates.get([SCOPE, "template-remote"]))?.name).toBe("Server");
      restoreNetwork();
      restoreNetwork = installNetwork({ online: false });
      await expect(createWebRepository(SCOPE).updateTemplate("template-missing", { name: "x" })).rejects.toThrow("Template is not available in the local mirror");
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("creates a note from a mirrored template and queues its creation", async () => {
    const restoreNetwork = installNetwork({ online: true });
    await localDb.templates.put({ ...templateFixture("template-1"), scope: SCOPE });
    const restoreApi = stubApi({ useTemplate: async () => { throw new Error("must not call the server"); } });
    try {
      const { memo } = await createWebRepository(SCOPE).useTemplate("template-1", "nb-1");
      expect(memo.title).toBe("template-1 title");
      expect(memo.tags).toEqual(["from-template"]);
      const queued = await localDb.syncQueue.get(`memo.create:${memo.id}`);
      expect(queued?.payload).toMatchObject({ temporaryId: memo.id, notebookId: "nb-1", contentMarkdown: "template-1 body" });
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("uses an unmirrored template on the server online and refuses offline", async () => {
    let restoreNetwork = installNetwork({ online: true });
    const calls = [];
    const restoreApi = stubApi({ useTemplate: async (...args) => { calls.push(args); return { memo: remoteMemoFixture("memo-from-template") }; } });
    try {
      expect((await createWebRepository(SCOPE).useTemplate("template-remote", "nb-1", "pl-PL")).memo.id).toBe("memo-from-template");
      expect(calls).toEqual([["template-remote", "nb-1", "pl-PL"]]);
      expect(await localDb.memos.get([SCOPE, "memo-from-template"])).toBeDefined();
      restoreNetwork();
      restoreNetwork = installNetwork({ online: false });
      await expect(createWebRepository(SCOPE).useTemplate("template-missing", "nb-1")).rejects.toThrow("Template is not available offline");
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });
});

describe("web repository resources", () => {
  test("stores an offline upload locally and queues it for later upload", async () => {
    const restoreNetwork = installNetwork({ online: false });
    const fakeCaches = installFakeCaches();
    let uploads = 0;
    const restoreApi = stubApi({ uploadMemoResource: async () => { uploads += 1; } });
    try {
      const file = new File(["data"], "notes.txt", { type: "text/plain" });
      const { resource } = await createWebRepository(SCOPE).uploadMemoResource("memo-1", file);
      expect(resource.id.startsWith("local_resource_")).toBe(true);
      expect(uploads).toBe(0);
      const queued = await queuedAction("resource.create", resource.id);
      expect(queued?.memoId).toBe("memo-1");
      expect(queued?.payload).toEqual({ resourceId: resource.id, memoId: "memo-1", filename: "notes.txt", mimeType: resource.mimeType, url: resource.url });

      const blob = await createWebRepository(SCOPE).readResource(resource.id);
      expect(await blob.text()).toBe("data");
    } finally {
      restoreApi();
      fakeCaches.restore();
      restoreNetwork();
    }
  });

  test("uploads online and mirrors the server resource", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const restoreApi = stubApi({ uploadMemoResource: async () => ({ resource: resourceFixture("res-1", { memoTitle: undefined }) }) });
    try {
      await createWebRepository(SCOPE).uploadMemoResource("memo-1", new File(["x"], "a.txt"));
      expect(await localDb.resources.get([SCOPE, "res-1"])).toMatchObject({ id: "res-1", memoTitle: null, memoDeleted: false });
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("reports offline reads of resources that were never cached", async () => {
    const restoreNetwork = installNetwork({ online: false });
    const fakeCaches = installFakeCaches();
    await localDb.resources.put({ ...resourceFixture("res-uncached"), scope: SCOPE });
    try {
      const repository = createWebRepository(SCOPE);
      await expect(repository.readResource("res-unknown")).rejects.toThrow("The resource is not available offline.");
      await expect(repository.readResource("res-uncached")).rejects.toThrow("The resource is not available offline.");
    } finally {
      fakeCaches.restore();
      restoreNetwork();
    }
  });

  test("reads unmirrored resources from the blob endpoint even when caching fails", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const previousCaches = globalThis.caches;
    delete globalThis.caches;
    const urls = [];
    const restoreApi = stubApi({ getResourceResponse: async (url, init) => { urls.push([url, init]); return new Response("bytes"); } });
    try {
      const blob = await createWebRepository(SCOPE).readResource("res/1");
      expect(await blob.text()).toBe("bytes");
      expect(urls).toEqual([["/api/v1/resources/res%2F1/blob", { cache: "no-store" }]]);
    } finally {
      restoreApi();
      if (previousCaches !== undefined) globalThis.caches = previousCaches;
      restoreNetwork();
    }
  });

  test("refuses to update, rename or delete an attachment that has not been synced", async () => {
    let restoreNetwork = installNetwork({ online: true });
    const restoreApi = stubApi({
      updateResourceContent: async () => { throw new Error("must not call the server"); },
      renameResource: async () => { throw new Error("must not call the server"); },
      deleteResource: async () => { throw new Error("must not call the server"); },
    });
    try {
      const repository = createWebRepository(SCOPE);
      await expect(repository.updateResource("local_resource_1", new File(["x"], "a.txt"), "hash")).rejects.toThrow("Attachments can only be updated after they are synced.");
      await expect(repository.renameResource("local_resource_1", "b.txt")).rejects.toThrow("Attachments can only be renamed after they are synced.");
      await expect(repository.deleteResource("local_resource_1")).rejects.toThrow("Attachments can only be deleted after they are synced.");
      restoreNetwork();
      restoreNetwork = installNetwork({ online: false });
      await expect(repository.updateResource("res-1", new File(["x"], "a.txt"), "hash")).rejects.toThrow("Attachments can only be updated after they are synced.");
      await expect(repository.renameResource("res-1", "b.txt")).rejects.toThrow("Attachments can only be renamed after they are synced.");
      await expect(repository.deleteResource("res-1")).rejects.toThrow("Attachments can only be deleted after they are synced.");
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("keeps note metadata when replacing the contents of a synced attachment", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const fakeCaches = installFakeCaches();
    await localDb.resources.put({ ...resourceFixture("res-1", { memoTitle: "Plan", memoExcerpt: "excerpt", memoDeleted: true }), scope: SCOPE });
    const calls = [];
    const restoreApi = stubApi({
      updateResourceContent: async (id, file, hash) => {
        calls.push([id, file.name, hash]);
        return { resource: resourceFixture(id, { byteSize: 9, sha256: "new", memoTitle: undefined, memoExcerpt: undefined, memoDeleted: undefined }) };
      },
    });
    try {
      await createWebRepository(SCOPE).updateResource("res-1", new File(["new bytes"], "a.txt", { type: "text/plain" }), "old-hash");
      expect(calls).toEqual([["res-1", "a.txt", "old-hash"]]);
      expect(await localDb.resources.get([SCOPE, "res-1"])).toMatchObject({ byteSize: 9, memoTitle: "Plan", memoExcerpt: "excerpt", memoDeleted: true });
      expect(fakeCaches.store.size).toBe(1);
    } finally {
      restoreApi();
      fakeCaches.restore();
      restoreNetwork();
    }
  });

  test("loads resources from the server on a cold mirror and refreshes them in the background later", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const lists = [
      { resources: [resourceFixture("res-1")], summary: { totalCount: 1, totalBytes: 4, imageCount: 0, attachmentCount: 1 } },
      { resources: [resourceFixture("res-2")], summary: { totalCount: 1, totalBytes: 4, imageCount: 0, attachmentCount: 1 } },
    ];
    const restoreApi = stubApi({ listResources: async () => lists.shift() });
    try {
      const repository = createWebRepository(SCOPE);
      expect((await repository.listResources()).resources.map((resource) => resource.id)).toEqual(["res-1"]);
      await localDb.resources.put({ ...resourceFixture("local_resource_pending"), scope: SCOPE });
      const cached = await repository.listResources();
      expect(cached.resources.map((resource) => resource.id).sort()).toEqual(["local_resource_pending", "res-1"]);
      await tick(10);
      const stored = (await localDb.resources.where("scope").equals(SCOPE).toArray()).map((resource) => resource.id).sort();
      expect(stored).toEqual(["local_resource_pending", "res-2"]);
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("renames and deletes synced attachments on the server and in the mirror", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const fakeCaches = installFakeCaches();
    await localDb.resources.put({ ...resourceFixture("res-1"), scope: SCOPE });
    const restoreApi = stubApi({
      renameResource: async (id) => ({ resource: resourceFixture(id, { filename: "" }) }),
      deleteResource: async () => ({ ok: true }),
    });
    try {
      const repository = createWebRepository(SCOPE);
      await repository.renameResource("res-1", "fallback.txt");
      expect((await localDb.resources.get([SCOPE, "res-1"]))?.filename).toBe("fallback.txt");
      expect(await repository.deleteResource("res-1")).toEqual({ ok: true });
      expect(await localDb.resources.get([SCOPE, "res-1"])).toBeUndefined();
    } finally {
      restoreApi();
      fakeCaches.restore();
      restoreNetwork();
    }
  });
});

describe("web repository tags and batch note actions", () => {
  test("lists tags from the mirror and only asks the server on an empty online mirror", async () => {
    const restoreNetwork = installNetwork({ online: true });
    let calls = 0;
    const restoreApi = stubApi({ listTags: async () => { calls += 1; return { tags: [{ name: "remote", memoCount: 1, updatedAt: null }] }; } });
    try {
      const repository = createWebRepository(SCOPE);
      expect((await repository.listTags()).tags.map((tag) => tag.name)).toEqual(["remote"]);
      await createLocalMemo(SCOPE, { notebookId: "nb-1", tags: ["local"] });
      expect((await repository.listTags()).tags.map((tag) => tag.name)).toEqual(["local"]);
      expect(calls).toBe(1);
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("applies tag renames and deletions locally and queues them", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const memo = await createLocalMemo(SCOPE, { notebookId: "nb-1", tags: ["old", "keep"] });
    try {
      const repository = createWebRepository(SCOPE);
      expect(await repository.renameTag("old", "new")).toEqual({ ok: true, updated: 1 });
      expect((await localDb.memos.get([SCOPE, memo.id]))?.tags).toEqual(["new", "keep"]);
      expect((await queuedAction("tag.rename", "old"))?.payload).toEqual({ tag: "old", name: "new" });
      expect(await repository.deleteTag("keep")).toEqual({ ok: true, updated: 1 });
      expect((await localDb.memos.get([SCOPE, memo.id]))?.tags).toEqual(["new"]);
      expect((await queuedAction("tag.delete", "keep"))?.payload).toEqual({ tag: "keep" });
    } finally {
      restoreNetwork();
    }
  });

  test("moves, pins and deletes notes in batches with one queued action each", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const first = await createLocalMemo(SCOPE, { notebookId: "nb-1" });
    const second = await createLocalMemo(SCOPE, { notebookId: "nb-1" });
    const memoIds = [first.id, second.id];
    const entityId = memoIds.join(",");
    try {
      const repository = createWebRepository(SCOPE);
      expect(await repository.moveMemos({ memoIds, notebookId: "nb-2" })).toEqual({ ok: true, moved: 2 });
      expect((await queuedAction("memo.moveBatch", entityId))?.payload).toEqual({ memoIds, notebookId: "nb-2" });
      expect(await repository.pinMemos({ memoIds, isPinned: true })).toEqual({ ok: true, updated: 2 });
      expect((await queuedAction("memo.pinBatch", entityId))?.payload).toEqual({ memoIds, isPinned: true });
      expect(await repository.deleteMemos({ memoIds, permanent: true })).toEqual({ ok: true, deleted: 2 });
      expect((await queuedAction("memo.deleteBatch", entityId))?.payload).toEqual({ memoIds, permanent: true });
      expect(await localDb.memos.where("scope").equals(SCOPE).count()).toBe(0);
    } finally {
      restoreNetwork();
    }
  });

  test("merges mirrored notes locally and queues the merge", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const first = await createLocalMemo(SCOPE, { notebookId: "nb-1", contentMarkdown: "First" });
    const second = await createLocalMemo(SCOPE, { notebookId: "nb-1", contentMarkdown: "Second" });
    const restoreApi = stubApi({ mergeMemos: async () => { throw new Error("must not call the server"); } });
    try {
      const { memo } = await createWebRepository(SCOPE).mergeMemos({ memoIds: [first.id, second.id], title: "Merged" });
      expect(memo.sourceMemoIds).toEqual([first.id, second.id]);
      expect((await queuedAction("memo.merge", memo.id))?.payload).toEqual({ memoIds: [first.id, second.id], title: "Merged", temporaryId: memo.id });
      expect((await localDb.memos.get([SCOPE, first.id]))?.mergedIntoMemoId).toBe(memo.id);
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("merges unmirrored notes on the server online and refuses offline", async () => {
    let restoreNetwork = installNetwork({ online: true });
    const restoreApi = stubApi({ mergeMemos: async () => ({ memo: remoteMemoFixture("memo-merged") }) });
    try {
      expect((await createWebRepository(SCOPE).mergeMemos({ memoIds: ["a", "b"] })).memo.id).toBe("memo-merged");
      restoreNetwork();
      restoreNetwork = installNetwork({ online: false });
      await expect(createWebRepository(SCOPE).mergeMemos({ memoIds: ["a", "b"] })).rejects.toThrow("Memos are not available in the local mirror");
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("refuses to duplicate a note offline", async () => {
    const restoreNetwork = installNetwork({ online: false });
    try {
      await expect(createWebRepository(SCOPE).duplicateMemo("memo-1")).rejects.toThrow("memo_duplicate_offline");
    } finally {
      restoreNetwork();
    }
  });
});

describe("web repository note reads and writes", () => {
  test("maps list parameters onto the server query on a cold mirror", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const received = [];
    const restoreApi = stubApi({ listMemos: async (params) => { received.push(params); return { memos: [], nextCursor: null }; } });
    try {
      const repository = createWebRepository(SCOPE);
      await repository.listMemos({ notebookId: "nb-1", notebookIds: ["nb-1", "nb-child"], offset: 40, limit: 20, q: "plan", sort: "updated" });
      await repository.listMemos({ notebookId: "nb-1", notebookIds: ["nb-1"], offset: 0 });
      expect(received[0]).toMatchObject({ notebookId: "nb-1", includeDescendants: true, cursor: "40", limit: 20, q: "plan", sort: "updated" });
      expect(received[1]).toMatchObject({ includeDescendants: false, cursor: null });
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("lists notes from the mirror once it holds data", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const memo = await createLocalMemo(SCOPE, { notebookId: "nb-1", contentMarkdown: "Local" });
    const restoreApi = stubApi({ listMemos: async () => { throw new Error("must not call the server"); } });
    try {
      const result = await createWebRepository(SCOPE).listMemos({ limit: 10 });
      expect(result.memos.map((item) => item.id)).toEqual([memo.id]);
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("reads a remapped temporary note id through its server id", async () => {
    const restoreNetwork = installNetwork({ online: true });
    await localDb.idMappings.put({ scope: SCOPE, temporaryId: "local_temp", remoteId: "memo-server", createdAt: "2026-01-01" });
    const requested = [];
    const restoreApi = stubApi({ getMemo: async (id) => { requested.push(id); return { memo: remoteMemoFixture(id) }; } });
    try {
      expect((await createWebRepository(SCOPE).getMemo("local_temp")).memo.id).toBe("memo-server");
      expect(requested).toEqual(["memo-server"]);
    } finally {
      await localDb.idMappings.clear();
      restoreApi();
      restoreNetwork();
    }
  });

  test("surfaces the server error when no local copy exists", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const restoreApi = stubApi({ getMemo: async () => { throw new Error("memo_not_found"); } });
    try {
      await expect(createWebRepository(SCOPE).getMemo("memo-missing")).rejects.toThrow("memo_not_found");
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("falls back to the local copy when the server read fails", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const memo = await createLocalMemo(SCOPE, { notebookId: "nb-1", contentMarkdown: "Local only" });
    const restoreApi = stubApi({ getMemo: async () => { throw new Error("network down"); } });
    try {
      expect((await createWebRepository(SCOPE).getMemo(memo.id)).memo.contentMarkdown).toBe("Local only");
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("ignores a trashed local copy unless deleted notes were requested", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const memo = await createLocalMemo(SCOPE, { notebookId: "nb-1", contentMarkdown: "Trashed" });
    await putLocalMemo(SCOPE, { ...memo, isDeleted: true });
    const restoreApi = stubApi({
      getMemo: async (id) => {
        await tick(20);
        return { memo: remoteMemoFixture(id, { title: "Server copy", updatedAt: "2000-01-01T00:00:00.000Z" }) };
      },
    });
    try {
      const repository = createWebRepository(SCOPE);
      expect((await repository.getMemo(memo.id, true)).memo.contentMarkdown).toBe("Trashed");
      expect((await repository.getMemo(memo.id)).memo.title).toBe("Server copy");
      // The server copy is cached in the background; let that write finish so
      // it cannot land after the mirror is cleared for the next test.
      const cachedTitle = async () => (await localDb.memos.toArray()).find((item) => item.id === memo.id)?.title;
      for (let attempt = 0; attempt < 50 && (await cachedTitle()) !== "Server copy"; attempt += 1) {
        await tick(5);
      }
      expect(await cachedTitle()).toBe("Server copy");
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("creates notes locally and announces the queue change asynchronously", async () => {
    const restoreNetwork = installNetwork({ online: true });
    let events = 0;
    window.setTimeout = globalThis.setTimeout.bind(globalThis);
    window.addEventListener("edgeever:sync-queue-changed", () => { events += 1; });
    try {
      const { memo } = await createWebRepository(SCOPE).createMemo({ notebookId: "nb-1", contentMarkdown: "New" });
      expect((await localDb.syncQueue.get(`memo.create:${memo.id}`))?.payload).toMatchObject({ temporaryId: memo.id, notebookId: "nb-1", title: "", tags: [] });
      expect(events).toBe(0);
      await tick(5);
      expect(events).toBe(1);
    } finally {
      restoreNetwork();
    }
  });

  test("adopting the cloud copy replaces the local note and drops the queued update", async () => {
    const restoreNetwork = installNetwork({ online: true });
    await localDb.memos.put({ ...remoteMemoFixture("memo-1", { title: "Local conflict" }), scope: SCOPE });
    await localDb.syncQueue.put({
      id: "memo.update:memo-1", kind: "memo.update", scope: SCOPE, memoId: "memo-1", status: "conflict", payload: { memoId: "memo-1" },
      attemptCount: 1, lastError: "conflict", nextAttemptAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01",
    });
    const restoreApi = stubApi({ getMemo: async (id) => ({ memo: remoteMemoFixture(id, { title: "Cloud" }) }) });
    try {
      expect((await createWebRepository(SCOPE).adoptCloudMemo("memo-1")).memo.title).toBe("Cloud");
      expect((await localDb.memos.get([SCOPE, "memo-1"]))?.title).toBe("Cloud");
      expect(await localDb.syncQueue.get("memo.update:memo-1")).toBeUndefined();
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("trashes and restores notes locally with queued sync actions", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const memo = await createLocalMemo(SCOPE, { notebookId: "nb-1" });
    try {
      const repository = createWebRepository(SCOPE);
      expect(await repository.deleteMemo(memo.id)).toEqual({ ok: true });
      expect((await localDb.memos.get([SCOPE, memo.id]))?.isDeleted).toBe(true);
      expect((await localDb.syncQueue.get(`memo.delete:${memo.id}`))?.payload).toEqual({ memoId: memo.id, permanent: false });
      const restored = await repository.restoreMemo(memo.id);
      expect(restored.memo.isDeleted).toBe(false);
      expect(restored.queued).toBe(true);
      expect((await localDb.syncQueue.get(`memo.restore:${memo.id}`))?.payload).toEqual({ memoId: memo.id });
    } finally {
      restoreNetwork();
    }
  });

  test("reports a restore of a note missing from the mirror", async () => {
    const restoreNetwork = installNetwork({ online: true });
    try {
      await expect(createWebRepository(SCOPE).restoreMemo("memo-missing")).rejects.toThrow("Memo is not available in the local mirror");
    } finally {
      restoreNetwork();
    }
  });

  test("loads revisions from the server on a cold mirror and from the mirror afterwards", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const revision = { id: "rev-1", memoId: "memo-1", revision: 1, title: "Old", contentMarkdown: "Old body", tags: [], createdAt: "2026-01-01T00:00:00.000Z" };
    let calls = 0;
    const restoreApi = stubApi({ listMemoRevisions: async () => { calls += 1; return { revisions: [revision] }; } });
    try {
      const repository = createWebRepository(SCOPE);
      expect((await repository.listMemoRevisions("memo-1")).revisions).toEqual([revision]);
      expect((await repository.listMemoRevisions("memo-1")).revisions).toEqual([revision]);
      await tick();
      expect(calls).toBe(2);
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("restores a mirrored revision locally against the current note revision", async () => {
    const restoreNetwork = installNetwork({ online: true });
    const memo = await createLocalMemo(SCOPE, { notebookId: "nb-1", contentMarkdown: "Current" });
    await localDb.revisions.put({ scope: SCOPE, id: "rev-1", memoId: memo.id, revision: 1, title: null, contentMarkdown: "Earlier", tags: ["old"], createdAt: "2026-01-01T00:00:00.000Z" });
    const restoreApi = stubApi({ restoreMemoRevision: async () => { throw new Error("must not call the server"); } });
    try {
      const result = await createWebRepository(SCOPE).restoreMemoRevision(memo.id, "rev-1");
      expect(result.memo.contentMarkdown).toBe("Earlier");
      expect(result.memo.tags).toEqual(["old"]);
      expect((await localDb.syncQueue.get(`memo.update:${memo.id}`))?.payload).toMatchObject({
        memoId: memo.id,
        expectedRevision: memo.revision,
        expectedContentHash: memo.contentHash,
        editSessionId: "offline-revision:rev-1",
        title: "",
        contentMarkdown: "Earlier",
      });
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });

  test("restores an unmirrored revision on the server online and refuses offline", async () => {
    let restoreNetwork = installNetwork({ online: true });
    const restoreApi = stubApi({ restoreMemoRevision: async (memoId) => ({ memo: remoteMemoFixture(memoId, { title: "Restored" }) }) });
    try {
      expect((await createWebRepository(SCOPE).restoreMemoRevision("memo-1", "rev-x")).memo.title).toBe("Restored");
      restoreNetwork();
      restoreNetwork = installNetwork({ online: false });
      await expect(createWebRepository(SCOPE).restoreMemoRevision("memo-1", "rev-x")).rejects.toThrow("Revision is not available offline");
    } finally {
      restoreApi();
      restoreNetwork();
    }
  });
});

describe("repository selection", () => {
  test("uses the desktop sidecar when the desktop bridge is available and the local mirror otherwise", async () => {
    const { createRepository } = await import("./repository.ts");
    const restoreNetwork = installNetwork({ online: false });
    const requests = [];
    try {
      window.edgeeverDesktop = {
        isAvailable: true,
        sidecarRequest: async (method) => { requests.push(method); return { notebooks: [notebookFixture("nb-desktop")] }; },
      };
      expect((await createRepository(SCOPE).listNotebooks()).notebooks.map((notebook) => notebook.id)).toEqual(["nb-desktop"]);
      expect(requests).toEqual(["notebook.list"]);

      window.edgeeverDesktop = undefined;
      await localDb.notebooks.put({ ...notebookFixture("nb-web"), scope: SCOPE });
      expect((await createRepository(SCOPE).listNotebooks()).notebooks.map((notebook) => notebook.id)).toEqual(["nb-web"]);
      expect(requests).toEqual(["notebook.list"]);
    } finally {
      restoreNetwork();
    }
  });
});
