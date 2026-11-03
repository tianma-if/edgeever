import { afterAll, describe, expect, test } from "bun:test";

// Dexie binds indexedDB when local-db is first imported, so install the fake
// before any test can load it, whatever the test order.
const { IDBKeyRange: FakeIDBKeyRange, indexedDB: fakeIndexedDB } = await import("fake-indexeddb");
const previousIndexedDB = globalThis.indexedDB;
const previousIDBKeyRange = globalThis.IDBKeyRange;
globalThis.indexedDB = fakeIndexedDB;
globalThis.IDBKeyRange = FakeIDBKeyRange;
afterAll(() => {
  globalThis.indexedDB = previousIndexedDB;
  globalThis.IDBKeyRange = previousIDBKeyRange;
});

const {
  classifyDesktopSyncFailure,
  discardDesktopConflicts,
  createDesktopSyncIssueDetails,
  createDesktopSyncDiagnosticText,
  createDesktopSyncSummary,
  isStagedResourceReferenced,
  stagedIdsReferencedByUnsavedContent,
  hasDesktopSyncStateReset,
  mergeMemoIdMappings,
  mergeSyncedMemos,
  normalizeDesktopMemoPayload,
  pauseDesktopSyncForImport,
  orderBootstrapNotebooks,
  orderDesktopSyncChanges,
  resolveDesktopMemoSyncBase,
  resolveDesktopStaleMemoUpdate,
  desktopLocalRevisionWitnessesRemote,
  rewriteStagedResource,
  syncDesktopData,
  shouldAttemptDesktopRecoveryPull,
  shouldPullDesktopChanges,
} = await import("./desktop-sync.ts");
const { api, ApiRequestError } = await import("./api.ts");

test("desktop notebook create announces its durable id after sidecar acknowledgment", async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  const originalCreateNotebook = api.createNotebook;
  const events = [];
  const calls = [];
  let outboxReads = 0;
  const item = { id: 4, version: 1, kind: "notebook.create", entityId: "nb_local_1", payload: { name: "测试" } };
  globalThis.window = {
    dispatchEvent: (event) => { events.push(event); return true; },
    edgeeverDesktop: {
      isAvailable: true,
      listStagedResources: async () => [],
      listStagedResourceAliases: async () => [],
      sidecarRequest: async (method, params) => {
        calls.push(method);
        if (method === "sync.outbox.list") {
          if (params.limit === 200) return { items: [] };
          outboxReads += 1;
          return { items: outboxReads === 1 ? [] : [item] };
        }
        if (method === "sync.status") return { pending: 1, syncing: 0 };
        return { ok: true };
      },
    },
  };
  globalThis.navigator = { onLine: true };
  api.createNotebook = async () => ({ notebook: { id: "nb_remote_1", name: "测试", parentId: null } });
  try {
    const result = await syncDesktopData();
    expect(result.failed).toBe(0);
    expect(calls).toContain("sync.outbox.ack");
    expect(events.find((event) => event.type === "edgeever:notebook-id-remapped")?.detail).toEqual({
      temporaryId: "nb_local_1",
      remoteId: "nb_remote_1",
    });
    expect(calls.indexOf("sync.outbox.ack")).toBeLessThan(calls.indexOf("sync.status"));
  } finally {
    api.createNotebook = originalCreateNotebook;
    globalThis.navigator = previousNavigator;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("desktop creates notebooks before notes and rereads remapped queue versions", async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  const originalCreateNotebook = api.createNotebook;
  const originalCreateMemo = api.createMemo;
  const calls = [];
  const createdPayloads = [];
  const contentJson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "body 2" }] }] };
  let queue = [
    { id: 1, version: 1, kind: "notebook.create", entityId: "nb_local_parent", payload: { name: "对对对" } },
    ...[2, 3].map((id) => ({ id, version: 1, kind: "memo.create", entityId: `memo_local_${id}`, payload: { notebookId: "nb_local_parent", contentMarkdown: `body ${id}`, ...(id === 2 ? { contentJson } : {}) } })),
  ];
  globalThis.window = {
    dispatchEvent: () => true,
    edgeeverDesktop: {
      isAvailable: true,
      listStagedResources: async () => [],
      listStagedResourceAliases: async () => [],
      sidecarRequest: async (method, params) => {
        if (method === "sync.outbox.list") return { items: queue.map((item) => ({ ...item, payload: { ...item.payload } })) };
        if (method === "sync.status") return { pending: 1, syncing: 0 };
        if (method === "sync.outbox.ack") {
          const current = queue.find((item) => item.id === params.id);
          expect(params.version).toBe(current.version);
          queue = queue.filter((item) => item.id !== params.id);
          if (params.remoteNotebook) {
            queue = queue.map((item) => ({ ...item, version: item.version + 1, payload: { ...item.payload, notebookId: "nb_cloud" } }));
          }
        }
        if (method === "sync.outbox.fail") throw new Error("No dependency should fail");
        return { ok: true };
      },
    },
  };
  globalThis.navigator = { onLine: true };
  api.createNotebook = async () => {
    calls.push("notebook");
    return { notebook: { id: "nb_cloud", name: "对对对", parentId: null } };
  };
  api.createMemo = async (payload) => {
    expect(payload.notebookId).toBe("nb_cloud");
    createdPayloads.push(payload);
    calls.push(payload.contentMarkdown);
    return { memo: { id: `memo_cloud_${calls.length}`, contentMarkdown: payload.contentMarkdown, contentJson: { type: "doc", content: [] } } };
  };
  try {
    const result = await syncDesktopData();
    expect(result.failed).toBe(0);
    expect(result.synced).toBe(3);
    expect(calls).toEqual(["notebook", "body 2", "body 3"]);
    expect(createdPayloads[0].contentJson).toEqual(contentJson);
    expect(createdPayloads[1].contentJson).toBeUndefined();
    expect(queue).toEqual([]);
  } finally {
    api.createNotebook = originalCreateNotebook;
    api.createMemo = originalCreateMemo;
    globalThis.navigator = previousNavigator;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("desktop leaves dependent notes pending when their notebook upload fails", async () => {
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  const originalCreateNotebook = api.createNotebook;
  const originalCreateMemo = api.createMemo;
  const failures = [];
  let notebookEligible = true;
  const notebook = { id: 1, version: 1, attemptCount: 0, kind: "notebook.create", entityId: "nb_local_failed", payload: { name: "Pending" } };
  const note = { id: 2, version: 1, kind: "memo.create", entityId: "memo_local_waiting", payload: { notebookId: notebook.entityId } };
  globalThis.window = {
    dispatchEvent: () => true,
    edgeeverDesktop: {
      isAvailable: true,
      listStagedResources: async () => [],
      listStagedResourceAliases: async () => [],
      sidecarRequest: async (method, params) => {
        if (method === "sync.outbox.list") return { items: notebookEligible ? [notebook, note] : [note] };
        if (method === "sync.status") return { pending: 1, syncing: 0, error: 1 };
        if (method === "sync.outbox.fail") { failures.push(params.id); notebookEligible = false; }
        return { ok: true };
      },
    },
  };
  globalThis.navigator = { onLine: true };
  api.createNotebook = async () => { throw new TypeError("Network unavailable"); };
  api.createMemo = async () => { throw new Error("Dependent notes must wait"); };
  try {
    const result = await syncDesktopData();
    expect(result.failed).toBe(1);
    expect(result.attempted).toBe(1);
    expect(failures).toEqual([notebook.id]);
  } finally {
    api.createNotebook = originalCreateNotebook;
    api.createMemo = originalCreateMemo;
    globalThis.navigator = previousNavigator;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("desktop explicit discard clears a conflict whose cloud note is gone", async () => {
  const previousWindow = globalThis.window;
  const originalGetMemo = api.getMemo;
  const calls = [];
  globalThis.window = {
    edgeeverDesktop: {
      isAvailable: true,
      sidecarRequest: async (method, params) => {
        calls.push({ method, params });
        if (method === "sync.outbox.list") return { items: [{ id: 7, version: 2, kind: "memo.update", entityId: "memo-gone", status: "conflict" }] };
        return { ok: true };
      },
    },
  };
  api.getMemo = async () => { throw new ApiRequestError("Not found", 404, "not_found"); };
  try {
    expect(await discardDesktopConflicts()).toBe(1);
    expect(calls.map((call) => call.method)).toEqual(["sync.outbox.list", "sync.outbox.discard"]);
    expect(calls[1].params).toEqual({ id: 7, version: 2 });
  } finally {
    api.getMemo = originalGetMemo;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

describe("desktop staged resource sync", () => {
  test("holds cloud sync until an imported screenshot is saved", async () => {
    const originalWindow = globalThis.window;
    const events = [];
    globalThis.window = { dispatchEvent: (event) => { events.push(event.type); return true; } };
    try {
      const release = await pauseDesktopSyncForImport();
      const result = await syncDesktopData();
      expect(result.attempted).toBe(0);
      expect(events).not.toContain("edgeever:sync-queue-changed");
      release();
      release();
      expect(events.filter((event) => event === "edgeever:sync-queue-changed")).toHaveLength(1);
    } finally {
      if (originalWindow !== undefined) globalThis.window = originalWindow;
    }
  });

  test("rewrites placeholders in memo JSON and markdown", () => {
    const rewrites = [{ memoId: "memo-1", placeholder: "edgeever-staged://stage-1", url: "/api/v1/resources/resource-1/blob" }];
    const value = {
      contentJson: { type: "doc", content: [{ type: "image", attrs: { src: "edgeever-staged://stage-1" } }] },
      contentMarkdown: "![photo](edgeever-staged://stage-1)",
    };

    expect(rewriteStagedResource(value, rewrites)).toEqual({
      contentJson: { type: "doc", content: [{ type: "image", attrs: { src: "/api/v1/resources/resource-1/blob" } }] },
      contentMarkdown: "![photo](/api/v1/resources/resource-1/blob)",
    });
  });

  test("never sends desktop-only PDF URLs to the cloud", () => {
    expect(normalizeDesktopMemoPayload({
      contentJson: {
        type: "doc",
        content: [{ type: "pdfAttachment", attrs: { url: "edgeever-resource://resource/res_pdf" } }],
      },
      contentMarkdown: "[Attachment: report.pdf](edgeever-resource://resource/res_pdf)",
    })).toMatchObject({
      contentJson: {
        content: [{ attrs: { url: "/api/v1/resources/res_pdf/blob" } }],
      },
      contentMarkdown: "[Attachment: report.pdf](/api/v1/resources/res_pdf/blob)",
    });
  });

  test("does not consume a staged image before a saved memo update references it", () => {
    const stagedId = "stage-1";

    expect(isStagedResourceReferenced([], stagedId)).toBe(false);
    expect(isStagedResourceReferenced([
      { contentJson: { type: "doc", content: [{ type: "image", attrs: { src: `edgeever-staged://${stagedId}` } }] } },
    ], stagedId)).toBe(true);
  });

  test("does not confuse one staged image id with a longer id that shares its prefix", () => {
    expect(isStagedResourceReferenced([
      { contentMarkdown: "![photo](edgeever-staged://stage-10)" },
    ], "stage-1")).toBe(false);
    expect(isStagedResourceReferenced([
      { contentMarkdown: "![photo](edgeever-staged://stage-1)" },
    ], "stage-1")).toBe(true);
  });

  test("keeps staged bytes while an editor draft or visible image still uses the old URL", () => {
    const rewrites = [{ memoId: "memo-1", placeholder: "edgeever-staged://stage-1", url: "/api/v1/resources/res-1/blob" }];
    expect(stagedIdsReferencedByUnsavedContent(rewrites, [
      { contentJson: { type: "doc", content: [{ type: "image", attrs: { src: "edgeever-staged://stage-1" } }] } },
    ])).toEqual(new Set(["stage-1"]));
    expect(stagedIdsReferencedByUnsavedContent(rewrites, ["edgeever-staged://stage-1"])).toEqual(new Set(["stage-1"]));
    expect(stagedIdsReferencedByUnsavedContent(rewrites, ["edgeever-staged://stage-10"])).toEqual(new Set());
  });

  test("retains a temporary id mapping when a later sync phase fails", () => {
    const retained = mergeMemoIdMappings(new Map(), new Map([["memo_local_1", "memo_remote_1"]]));

    expect(retained.get("memo_local_1")).toBe("memo_remote_1");
  });

  test("keeps the latest acknowledged memo base across sync phases", () => {
    const created = { id: "memo_remote_1", revision: 0 };
    const updated = { id: "memo_remote_1", revision: 1 };
    const retained = mergeSyncedMemos(
      new Map([[created.id, created]]),
      new Map([[updated.id, updated]]),
    );

    expect(retained.get("memo_remote_1")).toEqual(updated);
  });
});

describe("desktop bootstrap sync", () => {
  test("rebuilds when the server cursor rewinds or its identity changes", () => {
    const local = { cursor: 42, syncIdentity: "workspace-a" };
    expect(hasDesktopSyncStateReset(local, { serverCursor: 7, syncIdentity: "workspace-a" })).toBe(true);
    expect(hasDesktopSyncStateReset(local, { serverCursor: 42, syncIdentity: "workspace-b" })).toBe(true);
    expect(hasDesktopSyncStateReset(local, { serverCursor: 64, syncIdentity: "workspace-a" })).toBe(false);
  });

  test("orders parent notebooks before their children", () => {
    const child = { id: "child", parentId: "parent", name: "Child" };
    const parent = { id: "parent", parentId: null, name: "Parent" };
    const grandchild = { id: "grandchild", parentId: "child", name: "Grandchild" };

    expect(orderBootstrapNotebooks([grandchild, child, parent]).map((notebook) => notebook.id)).toEqual([
      "parent",
      "child",
      "grandchild",
    ]);
  });

  test("applies notebook upserts before memos in an incremental change page", () => {
    const memo = { entityType: "memo", entityId: "memo-1", operation: "upsert", notebook: null };
    const child = {
      entityType: "notebook",
      entityId: "child",
      operation: "upsert",
      notebook: { id: "child", parentId: "parent" },
    };
    const parent = {
      entityType: "notebook",
      entityId: "parent",
      operation: "upsert",
      notebook: { id: "parent", parentId: null },
    };
    const deleted = { entityType: "notebook", entityId: "gone", operation: "delete", notebook: null };

    expect(orderDesktopSyncChanges([memo, child, deleted, parent]).map((change) => change.entityId)).toEqual([
      "parent",
      "child",
      "gone",
      "memo-1",
    ]);
  });
});

describe("desktop memo sync base", () => {
  test("repairs a legacy local autosave revision that is ahead of the cloud", () => {
    expect(resolveDesktopMemoSyncBase(
      { revision: 3, contentHash: "cloud-3" },
      { expectedRevision: 9, expectedContentHash: "local-autosave-9" },
    )).toEqual({ expectedRevision: 3, expectedContentHash: "cloud-3" });
  });

  test("keeps a genuinely stale base so the server update remains protected", () => {
    expect(resolveDesktopMemoSyncBase(
      { revision: 9, contentHash: "cloud-9" },
      { expectedRevision: 3, expectedContentHash: "cloud-3" },
    )).toEqual({ expectedRevision: 3, expectedContentHash: "cloud-3" });
  });

  test("acks a lost save when the cloud already has the queued payload", () => {
    expect(resolveDesktopStaleMemoUpdate({
      current: { revision: 10, contentHash: "hash-a" },
      expected: { expectedRevision: 9, expectedContentHash: "hash-before" },
      payload: { title: "", tags: [], contentMarkdown: "一期验收通过。", contentJson: { type: "doc" } },
      remote: { title: "无标题笔记", tags: [], contentMarkdown: "一期验收通过。", contentHash: "hash-a", contentJson: { type: "doc" } },
      localRevisions: [],
    })).toBe("ack");
  });

  test("rebases a later local draft when a sidecar snapshot already contains the cloud body", () => {
    const remote = {
      title: "无标题笔记",
      tags: [],
      contentMarkdown: "一期验收通过。",
      contentHash: "hash-a",
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
    };

    expect(desktopLocalRevisionWitnessesRemote([
      {
        id: "revision_local_1",
        revision: 9,
        contentHash: "sidecar-a",
        contentMarkdown: "一期验收通过。",
        contentJson: remote.contentJson,
      },
    ], remote, 9)).toBe(true);

    expect(resolveDesktopStaleMemoUpdate({
      current: { revision: 10, contentHash: "hash-a" },
      expected: { expectedRevision: 9, expectedContentHash: "hash-before" },
      payload: { title: "", tags: [], contentMarkdown: "一期验收通过。然后继续写。", contentJson: { type: "doc" } },
      remote,
      localRevisions: [{
        id: "revision_local_1",
        revision: 9,
        contentHash: "sidecar-a",
        contentMarkdown: "一期验收通过。",
        contentJson: remote.contentJson,
      }],
    })).toBe("rebase");
  });

  test("does not treat an older local snapshot or a remote-cached revision as proof", () => {
    const remote = {
      title: "无标题笔记",
      tags: [],
      contentMarkdown: "别人改过的正文",
      contentHash: "hash-other",
      contentJson: { type: "doc" },
    };

    expect(desktopLocalRevisionWitnessesRemote([
      {
        id: "revision_local_old",
        revision: 3,
        contentHash: "hash-other",
        contentMarkdown: "别人改过的正文",
        contentJson: remote.contentJson,
      },
      {
        id: "rev_remote_cached",
        revision: 10,
        contentHash: "hash-other",
        contentMarkdown: "别人改过的正文",
        contentJson: remote.contentJson,
      },
    ], remote, 9)).toBe(false);

    expect(resolveDesktopStaleMemoUpdate({
      current: { revision: 10, contentHash: "hash-other" },
      expected: { expectedRevision: 9, expectedContentHash: "hash-before" },
      payload: { title: "", tags: [], contentMarkdown: "本地还在写的草稿", contentJson: { type: "doc" } },
      remote,
      localRevisions: [{
        id: "revision_local_9",
        revision: 9,
        contentHash: "sidecar-local",
        contentMarkdown: "本地还在写的草稿",
        contentJson: { type: "doc" },
      }],
    })).toBe("conflict");
  });
});

describe("desktop sync failure handling", () => {
  test("stops retrying a missing memo update and keeps transient failures retryable", () => {
    expect(classifyDesktopSyncFailure(
      { kind: "memo.update" },
      new ApiRequestError("Memo not found", 404, "not_found"),
    )).toEqual({ conflict: false, retryable: false, errorCode: "memo_not_found" });

    expect(classifyDesktopSyncFailure(
      { kind: "memo.update" },
      new ApiRequestError("Temporarily unavailable", 503),
    )).toEqual({ conflict: false, retryable: true, errorCode: "http_503" });
  });

  test("copies diagnostics without exposing entity ids or payload content", () => {
    const diagnostic = createDesktopSyncDiagnosticText([{
      id: 7,
      kind: "memo.update",
      entityId: "private-memo-id",
      payload: { contentMarkdown: "private note body" },
      attemptCount: 3,
      version: 1,
      status: "error",
      lastError: "Memo memo_private123 not found at https://private.example.test/api",
      lastErrorCode: "memo_not_found",
      retryable: false,
    }]);

    expect(diagnostic).toContain("memo_not_found");
    expect(diagnostic).toContain('"totalItemCount": 1');
    expect(diagnostic).not.toContain('"id": 7');
    expect(diagnostic).not.toContain("private-memo-id");
    expect(diagnostic).not.toContain("private note body");
    expect(diagnostic).not.toContain("memo_private123");
    expect(diagnostic).not.toContain("private.example.test");
  });

  test("keeps a global failure visible in both the summary and details", () => {
    const globalIssue = {
      phase: "pull_remote_changes",
      message: "Request failed at https://private.example.test/api/v1/sync/changes",
      errorCode: "http_500",
      occurredAt: "2026-09-05T00:00:00.000Z",
    };

    expect(createDesktopSyncSummary({ pending: 0, syncing: 0, conflict: 0, error: 0 }, globalIssue)).toEqual({
      total: 1,
      pending: 0,
      syncing: 0,
      conflict: 0,
      error: 1,
    });
    expect(createDesktopSyncIssueDetails([], globalIssue)).toEqual({ globalIssue, items: [] });
    expect(createDesktopSyncDiagnosticText([], globalIssue)).toContain("pull_remote_changes");
    expect(createDesktopSyncDiagnosticText([], globalIssue)).not.toContain("private.example.test");
  });

  test("bounds diagnostics for a prefilled GitHub Issue URL", () => {
    const items = Array.from({ length: 200 }, (_, id) => ({
      id,
      kind: "memo.update",
      entityId: `memo_private_${id}`,
      payload: { contentMarkdown: "private note body" },
      attemptCount: 99_999,
      version: 1,
      status: "error",
      lastError: "Temporary failure ".repeat(40),
      lastErrorCode: "network_error",
      retryable: true,
    }));
    const diagnostic = createDesktopSyncDiagnosticText(items);

    expect(diagnostic).toContain('"totalItemCount": 200');
    expect(diagnostic).toContain('"includedItemCount": 5');
    expect(encodeURIComponent(diagnostic).length).toBeLessThan(6_000);
  });

  test("allows remote pulls while durable errors are handled separately", () => {
    expect(shouldPullDesktopChanges({ pending: 0, syncing: 0, error: 1, conflict: 1 }, true)).toBe(true);
    expect(shouldPullDesktopChanges({ pending: 1, syncing: 0, error: 0, conflict: 0 }, true)).toBe(false);
    expect(shouldPullDesktopChanges({ pending: 0, syncing: 0, error: 0, conflict: 0 }, false)).toBe(false);
  });

  test("attempts a recovery pull only when no local upload can be overwritten", () => {
    expect(shouldAttemptDesktopRecoveryPull("sync_staged_resources", { pending: 0, syncing: 0 }, true)).toBe(true);
    expect(shouldAttemptDesktopRecoveryPull("sync_staged_resources", { pending: 1, syncing: 0 }, true)).toBe(false);
    expect(shouldAttemptDesktopRecoveryPull("sync_staged_resources", { pending: 0, syncing: 1 }, true)).toBe(false);
    expect(shouldAttemptDesktopRecoveryPull("pull_remote_changes", { pending: 0, syncing: 0 }, true)).toBe(false);
    expect(shouldAttemptDesktopRecoveryPull("finalize_resource_remap", { pending: 0, syncing: 0 }, true)).toBe(false);
    expect(shouldAttemptDesktopRecoveryPull("sync_staged_resources", { pending: 0, syncing: 0 }, false)).toBe(false);
  });
});

const {
  discardDesktopMemoConflict,
  discardDesktopSyncIssue,
  getDesktopSyncIssues,
  getDesktopSyncSummary,
  recoverDesktopMemoUpdate,
  retryDesktopSyncIssue,
} = await import("./desktop-sync.ts");

// A stateful fake of the desktop sidecar outbox. Acknowledged and failed items
// leave the queue, as they would once the sidecar schedules their next attempt.
const runWithDesktopSidecar = async (options, run) => {
  const {
    queue: initialQueue = [],
    status = null,
    localMemos = {},
    revisions = null,
    staged = [],
    aliases = [],
    bridge = {},
    online = true,
    api: apiOverrides = {},
  } = options;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  const originalApi = {};
  for (const [key, value] of Object.entries(apiOverrides)) {
    originalApi[key] = api[key];
    api[key] = value;
  }
  const state = { queue: initialQueue.map((item) => ({ attemptCount: 0, status: "pending", ...item })), calls: [], acks: [], failures: [], applied: [], events: [], removedStaged: [], aliasesRecorded: [] };
  const handle = async (method, params) => {
    state.calls.push({ method, params });
    switch (method) {
      case "sync.outbox.list": return { items: state.queue.map((item) => ({ ...item, payload: { ...item.payload } })) };
      case "sync.outbox.ack": state.acks.push(params); state.queue = state.queue.filter((item) => item.id !== params.id); return { ok: true };
      case "sync.outbox.fail": state.failures.push(params); state.queue = state.queue.filter((item) => item.id !== params.id); return { ok: true };
      case "sync.status": return status ? status(state) : { pending: state.queue.length, syncing: 0, conflict: 0, error: 0, cursor: 5, syncIdentity: "workspace-a" };
      case "sync.apply": state.applied.push(...params.changes); return { ok: true };
      case "memo.get": {
        const memo = localMemos[params.memoId];
        if (!memo) throw new Error(`memo_not_found: ${params.memoId}`);
        return { memo: typeof memo === "function" ? memo(state) : memo };
      }
      case "memo.revisions":
        if (!revisions) throw new Error("Unknown sidecar method: memo.revisions");
        return { revisions };
      default: return { ok: true };
    }
  };
  globalThis.window = {
    dispatchEvent: (event) => { state.events.push(event.type); return true; },
    edgeeverDesktop: {
      isAvailable: true,
      listStagedResources: async () => staged,
      listStagedResourceAliases: async () => aliases,
      readStagedResourcePart: async () => new Uint8Array([1, 2, 3]),
      recordStagedResourceAlias: async (id, url) => { state.aliasesRecorded.push([id, url]); },
      removeStagedResource: async (id) => { state.removedStaged.push(id); },
      sidecarRequest: handle,
      ...bridge,
    },
  };
  globalThis.navigator = { onLine: online };
  try {
    await run(state);
  } finally {
    Object.assign(api, originalApi);
    globalThis.navigator = previousNavigator;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
};

const settledStatus = () => ({ pending: 0, syncing: 0, conflict: 0, error: 0, cursor: 5, syncIdentity: "workspace-a" });
const quietPull = { syncChanges: async () => ({ changes: [], cursor: 5, hasMore: false }) };
const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("desktop outbox replay", () => {
  test("replays every supported action against the server and acknowledges it", async () => {
    const serverCalls = [];
    const record = (name, result = { ok: true }) => async (...args) => { serverCalls.push([name, ...args]); return result; };
    const queue = [
      { id: 1, version: 1, kind: "memo.delete", entityId: "memo-1", payload: { memoId: "memo-1", permanent: true } },
      { id: 2, version: 1, kind: "memo.deleteBatch", entityId: "memo-2", payload: { memoIds: ["memo-2", 7], permanent: false } },
      { id: 3, version: 1, kind: "memo.emptyTrash", entityId: "trash", payload: {} },
      { id: 4, version: 1, kind: "memo.pinBatch", entityId: "memo-3", payload: { memoIds: ["memo-3", "memo-4"], isPinned: true } },
      { id: 5, version: 1, kind: "memo.merge", entityId: "memo-merged", payload: { memoIds: ["memo-5", "memo-6"], notebookId: "nb-1", title: "Merged" } },
      { id: 6, version: 1, kind: "notebook.update", entityId: "nb-1", payload: { notebookId: "nb-1", name: "Renamed", parentId: 5, sortOrder: 2, icon: null, color: "red", iconInverted: true, isBold: false, colorTarget: "both" } },
      { id: 7, version: 1, kind: "notebook.delete", entityId: "nb-2", payload: { notebookIds: ["nb-child", "nb-2"] } },
      { id: 8, version: 1, kind: "notebook.restore", entityId: "nb-3", payload: {} },
      { id: 9, version: 1, kind: "template.create", entityId: "tpl-local", payload: { name: "T", tags: ["a", 1] } },
      { id: 10, version: 1, kind: "template.update", entityId: "tpl-1", payload: { name: "U", contentMarkdown: "body" } },
      { id: 11, version: 1, kind: "template.delete", entityId: "tpl-2", payload: {} },
      { id: 12, version: 1, kind: "tag.rename", entityId: "old", payload: { tag: "old", name: "new" } },
      { id: 13, version: 1, kind: "tag.delete", entityId: "gone", payload: {} },
      { id: 14, version: 1, kind: "memo.move", entityId: "memo-7", payload: { memoIds: ["memo-7"], notebookId: "nb-4" } },
      { id: 15, version: 1, kind: "memo.restore", entityId: "memo-8", payload: {} },
    ];
    const merged = { id: "memo-merged-cloud", contentJson: { type: "doc", content: [] }, contentMarkdown: "" };
    await runWithDesktopSidecar({
      queue,
      status: () => ({ pending: 1, syncing: 0, conflict: 0, error: 0, cursor: 5, syncIdentity: "workspace-a" }),
      api: {
        deleteMemo: record("deleteMemo"),
        deleteMemos: record("deleteMemos"),
        emptyTrash: record("emptyTrash"),
        updateMemo: record("updateMemo"),
        mergeMemos: record("mergeMemos", { memo: merged }),
        updateNotebook: record("updateNotebook", { notebook: { id: "nb-1", name: "Renamed", parentId: null } }),
        deleteNotebook: record("deleteNotebook"),
        restoreNotebook: record("restoreNotebook", { notebook: { id: "nb-3", name: "Back", parentId: null } }),
        createTemplate: record("createTemplate", { template: { id: "tpl-cloud" } }),
        updateTemplate: record("updateTemplate", { template: { id: "tpl-1" } }),
        deleteTemplate: record("deleteTemplate"),
        renameTag: record("renameTag"),
        deleteTag: record("deleteTag"),
        moveMemos: record("moveMemos"),
        restoreMemo: record("restoreMemo"),
      },
    }, async (state) => {
      const result = await syncDesktopData();
      expect(result).toMatchObject({ attempted: 15, synced: 15, failed: 0, conflicted: 0 });
      expect(state.failures).toEqual([]);
      expect(state.acks.map((ack) => ack.id)).toEqual(queue.map((item) => item.id));
      expect(serverCalls).toEqual([
        ["deleteMemo", "memo-1", { permanent: true }],
        ["deleteMemos", { memoIds: ["memo-2"], permanent: false }],
        ["emptyTrash"],
        ["updateMemo", "memo-3", { isPinned: true }],
        ["updateMemo", "memo-4", { isPinned: true }],
        ["mergeMemos", { memoIds: ["memo-5", "memo-6"], notebookId: "nb-1", title: "Merged" }],
        ["updateNotebook", "nb-1", { name: "Renamed", parentId: null, sortOrder: 2, icon: null, color: "red", textColor: undefined, iconInverted: true, rowInverted: undefined, isBold: false, colorTarget: "both" }],
        ["deleteNotebook", "nb-child"],
        ["deleteNotebook", "nb-2"],
        ["restoreNotebook", "nb-3"],
        ["createTemplate", { name: "T", description: null, title: null, contentMarkdown: "", tags: ["a"] }],
        ["updateTemplate", "tpl-1", { name: "U", description: null, title: null, contentMarkdown: "body", tags: [] }],
        ["deleteTemplate", "tpl-2"],
        ["renameTag", "old", "new"],
        ["deleteTag", "gone"],
        ["moveMemos", { memoIds: ["memo-7"], notebookId: "nb-4" }],
        ["restoreMemo", "memo-8"],
      ]);
      expect(state.acks.find((ack) => ack.id === 5).remoteMemo).toEqual(merged);
      expect(state.acks.find((ack) => ack.id === 9).remoteTemplate).toEqual({ id: "tpl-cloud" });
      expect(state.applied.filter((change) => change.entityType === "notebook").map((change) => change.entityId)).toEqual(["nb-1", "nb-3"]);
      expect(state.events).toContain("edgeever:memo-sync-acknowledged");
      expect(state.calls.some((call) => call.method === "sync.cursor.set")).toBe(false);
    });
  });

  test("keeps an unsupported action as a permanent, non-retryable error", async () => {
    await runWithDesktopSidecar({
      queue: [{ id: 1, version: 2, kind: "memo.archive", entityId: "memo-1", payload: {} }],
      api: quietPull,
    }, async (state) => {
      const result = await syncDesktopData();
      expect(result).toMatchObject({ attempted: 1, synced: 0, failed: 1 });
      expect(state.failures).toEqual([{
        id: 1, version: 2, error: "Unsupported desktop sync operation: memo.archive", errorCode: "unexpected_sync_error", conflict: false, retryable: false, nextAttemptAt: null,
      }]);
    });
  });

  test("schedules network and server failures for retry but not client errors", async () => {
    const failures = {
      "memo-net": new TypeError("Failed to fetch"),
      "memo-busy": new ApiRequestError("Busy", 429),
      "memo-bad": new ApiRequestError("Bad request", 400, "invalid_input"),
    };
    await runWithDesktopSidecar({
      queue: Object.keys(failures).map((memoId, index) => ({ id: index + 1, version: 1, attemptCount: 2, kind: "memo.delete", entityId: memoId, payload: {} })),
      api: { deleteMemo: async (memoId) => { throw failures[memoId]; }, ...quietPull },
    }, async (state) => {
      const result = await syncDesktopData();
      expect(result).toMatchObject({ attempted: 3, failed: 3, conflicted: 0 });
      expect(state.failures.map(({ id, errorCode, retryable, conflict }) => ({ id, errorCode, retryable, conflict }))).toEqual([
        { id: 1, errorCode: "network_error", retryable: true, conflict: false },
        { id: 2, errorCode: "http_429", retryable: true, conflict: false },
        { id: 3, errorCode: "invalid_input", retryable: false, conflict: false },
      ]);
      expect(typeof state.failures[0].nextAttemptAt).toBe("string");
      expect(state.failures[2].nextAttemptAt).toBeNull();
    });
  });

  test("waits for local notebook and note ids before replaying dependent actions", async () => {
    let deletes = 0;
    await runWithDesktopSidecar({
      queue: [
        { id: 1, version: 1, kind: "notebook.update", entityId: "nb-1", payload: { notebookId: "nb-1", parentId: "nb_local_parent" } },
        { id: 2, version: 1, kind: "memo.delete", entityId: "memo_local_1", payload: {} },
        { id: 3, version: 1, kind: "memo.restore", entityId: "memo-2", payload: { memoId: "memo_local_2" } },
      ],
      api: { deleteMemo: async () => { deletes += 1; }, restoreMemo: async () => { deletes += 1; } },
    }, async (state) => {
      const result = await syncDesktopData();
      expect(result.attempted).toBe(0);
      expect(deletes).toBe(0);
      expect(state.acks).toEqual([]);
      expect(state.failures).toEqual([]);
      expect(state.queue).toHaveLength(3);
    });
  });

  test("returns an empty result without touching the sidecar while offline", async () => {
    await runWithDesktopSidecar({ online: false, queue: [{ id: 1, version: 1, kind: "memo.delete", entityId: "memo-1", payload: {} }] }, async (state) => {
      expect(await syncDesktopData()).toMatchObject({ attempted: 0, synced: 0, failed: 0, conflicted: 0 });
      expect(state.calls).toEqual([]);
    });
  });

  test("shares one running synchronization between concurrent callers", async () => {
    let releaseDelete;
    await runWithDesktopSidecar({
      queue: [{ id: 1, version: 1, kind: "memo.delete", entityId: "memo-1", payload: {} }],
      api: { deleteMemo: () => new Promise((resolve) => { releaseDelete = resolve; }), ...quietPull },
    }, async () => {
      const first = syncDesktopData();
      const second = syncDesktopData();
      expect(second).toBe(first);
      let pauseResolved = false;
      const pause = pauseDesktopSyncForImport().then((release) => { pauseResolved = true; return release; });
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(pauseResolved).toBe(false);
      releaseDelete({ ok: true });
      expect((await first).synced).toBe(1);
      (await pause)();
      expect(pauseResolved).toBe(true);
    });
  });
});

describe("desktop memo update replay", () => {
  const updateItem = (payload) => ({ id: 1, version: 3, kind: "memo.update", entityId: "memo-1", payload: { memoId: "memo-1", title: "Draft", tags: [], contentMarkdown: "Local draft", contentJson: doc("Local draft"), ...payload } });
  const editSession = (baseRevision, baseContentHash) => async () => ({ editSession: { id: "session-1", baseRevision, baseContentHash } });
  const remote = (overrides = {}) => ({ id: "memo-1", title: "Draft", tags: [], revision: 10, contentHash: "cloud-10", contentMarkdown: "Someone else", contentJson: doc("Someone else"), ...overrides });

  test("sends a draft whose base is still current and stores the acknowledged note", async () => {
    const updates = [];
    const saved = remote({ revision: 4, contentHash: "cloud-4", contentMarkdown: "Local draft" });
    await runWithDesktopSidecar({
      queue: [updateItem({ expectedRevision: 3, expectedContentHash: "cloud-3", contentMarkdown: "![a](edgeever-resource://resource/res-1)" })],
      api: { createMemoEditSession: editSession(3, "cloud-3"), updateMemo: async (memoId, input) => { updates.push([memoId, input]); return { memo: saved }; }, ...quietPull },
    }, async (state) => {
      const result = await syncDesktopData();
      expect(result.synced).toBe(1);
      expect(result.syncedMemos.get("memo-1")).toEqual(saved);
      expect(updates[0][1]).toMatchObject({ expectedRevision: 3, expectedContentHash: "cloud-3", editSessionId: "session-1", contentMarkdown: "![a](/api/v1/resources/res-1/blob)" });
      expect(state.acks[0]).toMatchObject({ id: 1, version: 3, remoteMemo: saved });
    });
  });

  test("acknowledges a lost save without sending it again when the cloud already holds the draft", async () => {
    let updates = 0;
    const cloud = remote({ contentMarkdown: "Local draft", contentJson: doc("Local draft") });
    await runWithDesktopSidecar({
      queue: [updateItem({ expectedRevision: 9, expectedContentHash: "cloud-9" })],
      api: { createMemoEditSession: editSession(10, "cloud-10"), getMemo: async () => ({ memo: cloud }), updateMemo: async () => { updates += 1; }, ...quietPull },
    }, async (state) => {
      expect((await syncDesktopData()).synced).toBe(1);
      expect(updates).toBe(0);
      expect(state.acks[0].remoteMemo).toEqual(cloud);
    });
  });

  test("rebases onto the cloud revision when a local snapshot proves this device wrote it", async () => {
    const updates = [];
    const cloud = remote({ contentMarkdown: "Earlier local text", contentHash: "cloud-10" });
    await runWithDesktopSidecar({
      queue: [updateItem({ expectedRevision: 9, expectedContentHash: "cloud-9" })],
      revisions: [{ id: "revision_local_1", revision: 9, contentHash: "sidecar-x", contentMarkdown: "Earlier local text" }],
      api: {
        createMemoEditSession: editSession(10, "cloud-10"),
        getMemo: async () => ({ memo: cloud }),
        updateMemo: async (memoId, input) => { updates.push(input); return { memo: remote({ revision: 11 }) }; },
        ...quietPull,
      },
    }, async (state) => {
      expect((await syncDesktopData()).synced).toBe(1);
      expect(updates[0]).toMatchObject({ expectedRevision: 10, expectedContentHash: "cloud-10" });
      expect(state.failures).toEqual([]);
    });
  });

  test("keeps a draft as a conflict when the cloud changed elsewhere and local history is unavailable", async () => {
    let updates = 0;
    await runWithDesktopSidecar({
      queue: [updateItem({ expectedRevision: 9, expectedContentHash: "cloud-9" })],
      status: () => ({ pending: 0, syncing: 0, conflict: 1, error: 0, cursor: 5, syncIdentity: "workspace-a" }),
      api: { createMemoEditSession: editSession(10, "cloud-10"), getMemo: async () => ({ memo: remote() }), updateMemo: async () => { updates += 1; }, ...quietPull },
    }, async (state) => {
      const result = await syncDesktopData();
      expect(result).toMatchObject({ conflicted: 1, failed: 0, synced: 0 });
      expect(updates).toBe(0);
      expect(state.failures[0]).toMatchObject({ id: 1, conflict: true, retryable: false, errorCode: "revision_conflict", nextAttemptAt: null });
      expect(state.calls.filter((call) => call.method === "sync.apply")).toEqual([]);
    });
  });

  test("stops retrying a draft whose cloud note no longer exists", async () => {
    await runWithDesktopSidecar({
      queue: [updateItem({ expectedRevision: 3, expectedContentHash: "cloud-3" })],
      api: { createMemoEditSession: async () => { throw new ApiRequestError("Not found", 404, "not_found"); }, ...quietPull },
    }, async (state) => {
      await syncDesktopData();
      expect(state.failures[0]).toMatchObject({ errorCode: "memo_not_found", retryable: false, conflict: false });
    });
  });
});

describe("desktop remote pulls", () => {
  test("bootstraps an uninitialized mirror page by page with the first page's cursor", async () => {
    const pages = [
      { notebooks: [{ id: "child", parentId: "parent" }, { id: "parent", parentId: null }], memos: [{ id: "memo-1" }], snapshotCursor: 40, syncIdentity: "workspace-a", nextAfterId: "memo-1" },
      { notebooks: [], memos: [{ id: "memo-2" }], snapshotCursor: 99, syncIdentity: "workspace-z", nextAfterId: null },
    ];
    const requested = [];
    await runWithDesktopSidecar({
      status: () => ({ ...settledStatus(), cursor: 0, syncIdentity: null }),
      api: { syncBootstrap: async (params) => { requested.push(params); return pages.shift(); } },
    }, async (state) => {
      await syncDesktopData();
      expect(requested).toEqual([{ afterId: null, limit: 200 }, { afterId: "memo-1", limit: 200 }]);
      expect(state.calls.find((call) => call.method === "sync.bootstrap.prepare").params).toEqual({});
      expect(state.applied.map((change) => change.entityId)).toEqual(["parent", "child", "memo-1", "memo-2"]);
      expect(state.calls.find((call) => call.method === "sync.cursor.set").params).toEqual({ cursor: 40, syncIdentity: "workspace-a" });
    });
  });

  test("applies incremental change pages until the server has no more", async () => {
    const pages = [
      { changes: [{ entityType: "memo", entityId: "memo-1", operation: "upsert" }], cursor: 6, hasMore: true, serverCursor: 7, syncIdentity: "workspace-a" },
      { changes: [{ entityType: "memo", entityId: "memo-2", operation: "delete" }], cursor: 7, hasMore: false, serverCursor: 7, syncIdentity: "workspace-a" },
    ];
    const cursors = [];
    await runWithDesktopSidecar({
      status: settledStatus,
      api: { syncChanges: async ({ cursor }) => { cursors.push(cursor); return pages.shift(); } },
    }, async (state) => {
      await syncDesktopData();
      expect(cursors).toEqual([5, 6]);
      expect(state.applied.map((change) => change.entityId)).toEqual(["memo-1", "memo-2"]);
      expect(state.calls.find((call) => call.method === "sync.cursor.set").params).toEqual({ cursor: 7, syncIdentity: "workspace-a" });
    });
  });

  test("rebuilds the mirror when the server workspace was reset", async () => {
    await runWithDesktopSidecar({
      status: settledStatus,
      api: {
        syncChanges: async () => ({ changes: [], cursor: 0, hasMore: false, serverCursor: 1, syncIdentity: "workspace-b" }),
        syncBootstrap: async () => ({ notebooks: [], memos: [], snapshotCursor: 1, syncIdentity: "workspace-b", nextAfterId: null }),
      },
    }, async (state) => {
      await syncDesktopData();
      expect(state.calls.find((call) => call.method === "sync.bootstrap.prepare").params).toEqual({ reset: true });
      expect(state.applied).toEqual([]);
      expect(state.calls.find((call) => call.method === "sync.cursor.set").params).toEqual({ cursor: 1, syncIdentity: "workspace-b" });
    });
  });

  test("rebuilds the mirror when a later change page reveals a rewound cursor", async () => {
    const pages = [
      { changes: [{ entityType: "memo", entityId: "memo-1", operation: "upsert" }], cursor: 9, hasMore: true, serverCursor: 9 },
      { changes: [], cursor: 0, hasMore: false, serverCursor: 2 },
    ];
    let bootstraps = 0;
    await runWithDesktopSidecar({
      status: settledStatus,
      api: {
        syncChanges: async () => pages.shift(),
        syncBootstrap: async () => { bootstraps += 1; return { notebooks: [], memos: [], snapshotCursor: 2, syncIdentity: "workspace-a", nextAfterId: null }; },
      },
    }, async (state) => {
      await syncDesktopData();
      expect(bootstraps).toBe(1);
      expect(state.calls.filter((call) => call.method === "sync.cursor.set").map((call) => call.params)).toEqual([{ cursor: 2, syncIdentity: "workspace-a" }]);
    });
  });
});

describe("desktop sync failure recovery", () => {
  test("records a failed resource phase, still pulls remote changes and clears the issue after a clean sync", async () => {
    let pulls = 0;
    let stagedFails = true;
    const previousConsoleError = console.error;
    console.error = () => {};
    try {
      await runWithDesktopSidecar({
        status: settledStatus,
        bridge: { listStagedResources: async () => { if (stagedFails) throw new Error("staging directory unavailable"); return []; } },
        api: { syncChanges: async () => { pulls += 1; return { changes: [], cursor: 5, hasMore: false }; } },
      }, async () => {
        expect((await syncDesktopData()).failed).toBe(1);
        expect(pulls).toBe(1);
        expect(await getDesktopSyncSummary()).toEqual({ total: 1, pending: 0, syncing: 0, conflict: 0, error: 1 });
        expect((await getDesktopSyncIssues()).globalIssue).toMatchObject({ phase: "sync_staged_resources", message: "staging directory unavailable", errorCode: null });

        stagedFails = false;
        expect((await syncDesktopData()).failed).toBe(0);
        expect((await getDesktopSyncIssues()).globalIssue).toBeNull();
      });
    } finally {
      console.error = previousConsoleError;
    }
  });

  test("does not retry a failed pull and reports its HTTP status", async () => {
    let pulls = 0;
    const logged = [];
    const previousConsoleError = console.error;
    console.error = (...args) => { logged.push(args[0]); };
    try {
      await runWithDesktopSidecar({
        status: settledStatus,
        api: { syncChanges: async () => { pulls += 1; throw new ApiRequestError("Server error", 500); } },
      }, async () => {
        expect((await syncDesktopData()).failed).toBe(1);
        expect(pulls).toBe(1);
        expect((await getDesktopSyncIssues()).globalIssue).toMatchObject({ phase: "pull_remote_changes", errorCode: "http_500" });
        expect(logged).toEqual(["[desktop-sync] Sync failed"]);
      });
    } finally {
      console.error = previousConsoleError;
    }
  });

  test("keeps the id mapping of an acknowledged create when a later phase fails", async () => {
    const previousConsoleError = console.error;
    console.error = () => {};
    try {
      await runWithDesktopSidecar({
        queue: [{ id: 1, version: 1, kind: "memo.create", entityId: "memo_local_1", payload: { notebookId: "nb-1", contentMarkdown: "Hi" } }],
        status: () => ({ pending: 1, syncing: 0, conflict: 0, error: 0, cursor: 5, syncIdentity: "workspace-a" }),
        bridge: { remapStagedResourceMemoIds: async () => { throw new TypeError("bridge reloaded"); } },
        api: { createMemo: async () => ({ memo: { id: "memo-cloud-1", contentJson: { type: "doc", content: [] }, contentMarkdown: "Hi" } }) },
      }, async (state) => {
        const result = await syncDesktopData();
        expect(result.failed).toBe(1);
        expect(result.memoIdMappings.get("memo_local_1")).toBe("memo-cloud-1");
        expect(state.events).toContain("edgeever:memo-id-remapped");
        expect((await getDesktopSyncIssues()).globalIssue).toMatchObject({ phase: "remap_created_resources", errorCode: "network_error" });
      });
    } finally {
      console.error = previousConsoleError;
    }
  });
});

describe("desktop staged resource upload", () => {
  const stagedImage = { id: "stage-1", memoId: "memo-1", name: "shot.png", type: "image/png", size: 3 };
  const stagedUrl = "edgeever-staged://stage-1";
  const uploadedUrl = "/api/v1/resources/res-1/blob";

  test("uploads a saved staged image, rewrites the queued draft and removes the staged copy", async () => {
    const uploads = [];
    const updates = [];
    await runWithDesktopSidecar({
      staged: [stagedImage, { id: "stage-unsaved", memoId: "memo-1", name: "draft.png", type: "image/png", size: 3 }],
      queue: [{ id: 1, version: 1, kind: "memo.update", entityId: "memo-1", payload: { memoId: "memo-1", expectedRevision: 2, expectedContentHash: "cloud-2", title: "", tags: [], contentMarkdown: `![shot](${stagedUrl})`, contentJson: { type: "doc", content: [{ type: "image", attrs: { src: stagedUrl } }] } } }],
      localMemos: { "memo-1": { id: "memo-1", contentMarkdown: `![shot](${uploadedUrl})`, contentJson: { type: "doc", content: [] } } },
      api: {
        uploadMemoResourceParts: async (memoId, source) => {
          uploads.push([memoId, source.filename, source.byteSize, await (await source.readPart(0, 3)).arrayBuffer()]);
          return { resource: { id: "res-1", url: uploadedUrl } };
        },
        createMemoEditSession: async () => ({ editSession: { id: "session", baseRevision: 2, baseContentHash: "cloud-2" } }),
        updateMemo: async (memoId, input) => { updates.push(input); return { memo: { id: memoId, contentJson: input.contentJson, contentMarkdown: input.contentMarkdown } }; },
        ...quietPull,
      },
    }, async (state) => {
      const result = await syncDesktopData();
      expect(result).toMatchObject({ failed: 0, synced: 2, attempted: 3 });
      expect(uploads).toEqual([["memo-1", "shot.png", 3, new Uint8Array([1, 2, 3]).buffer]]);
      expect(state.aliasesRecorded).toEqual([["stage-1", uploadedUrl]]);
      expect(state.calls.find((call) => call.method === "resource.cache").params).toEqual({ resource: { id: "res-1", url: uploadedUrl } });
      expect(updates[0].contentMarkdown).toBe(`![shot](${uploadedUrl})`);
      expect(updates[0].contentJson.content[0].attrs.src).toBe(uploadedUrl);
      expect(state.removedStaged).toEqual(["stage-1"]);
    });
  });

  test("keeps the staged copy and counts a failure when the upload fails", async () => {
    await runWithDesktopSidecar({
      staged: [stagedImage],
      queue: [{ id: 1, version: 1, kind: "template.update", entityId: "tpl-1", payload: { templateId: "tpl-1", contentMarkdown: `![shot](${stagedUrl})` } }],
      status: () => ({ pending: 1, syncing: 0, conflict: 0, error: 0, cursor: 5, syncIdentity: "workspace-a" }),
      api: {
        uploadMemoResourceParts: async () => { throw new TypeError("offline"); },
        updateTemplate: async () => ({ template: { id: "tpl-1" } }),
      },
    }, async (state) => {
      const result = await syncDesktopData();
      expect(result).toMatchObject({ failed: 1, attempted: 2 });
      expect(state.aliasesRecorded).toEqual([]);
      expect(state.removedStaged).toEqual([]);
    });
  });

  test("refuses to consume a staged image when the host cannot record its durable alias", async () => {
    await runWithDesktopSidecar({
      staged: [stagedImage],
      queue: [{ id: 1, version: 1, kind: "template.update", entityId: "tpl-1", payload: { templateId: "tpl-1", contentMarkdown: `![shot](${stagedUrl})` } }],
      status: () => ({ pending: 1, syncing: 0, conflict: 0, error: 0, cursor: 5, syncIdentity: "workspace-a" }),
      bridge: { recordStagedResourceAlias: undefined },
      api: {
        uploadMemoResourceParts: async () => ({ resource: { id: "res-1", url: uploadedUrl } }),
        updateTemplate: async () => ({ template: { id: "tpl-1" } }),
      },
    }, async (state) => {
      expect((await syncDesktopData()).failed).toBe(1);
      expect(state.removedStaged).toEqual([]);
    });
  });

  test("patches a created note that still shows an already uploaded staged image", async () => {
    const updates = [];
    let cloudMarkdown = `![shot](${stagedUrl})`;
    await runWithDesktopSidecar({
      staged: [stagedImage],
      aliases: [{ id: "stage-1", memoId: "memo-1", resourceId: "res-1" }],
      localMemos: { "memo-1": () => ({ id: "memo-1", contentMarkdown: cloudMarkdown, contentJson: { type: "doc", content: [] } }) },
      api: {
        getMemo: async () => ({ memo: { id: "memo-1", title: null, tags: ["a"], contentMarkdown: cloudMarkdown, contentJson: { type: "doc", content: [] } } }),
        createMemoEditSession: async () => ({ editSession: { id: "session", baseRevision: 4, baseContentHash: "cloud-4" } }),
        updateMemo: async (memoId, input) => {
          updates.push(input);
          cloudMarkdown = input.contentMarkdown;
          return { memo: { id: memoId, contentMarkdown: input.contentMarkdown } };
        },
        ...quietPull,
      },
    }, async (state) => {
      const result = await syncDesktopData();
      expect(result.failed).toBe(0);
      expect(updates).toEqual([{ expectedRevision: 4, expectedContentHash: "cloud-4", editSessionId: "session", contentJson: { type: "doc", content: [] }, contentMarkdown: `![shot](${uploadedUrl})`, title: "", tags: ["a"] }]);
      expect(state.applied.map((change) => change.entityId)).toEqual(["memo-1"]);
      expect(state.removedStaged).toEqual(["stage-1"]);
    });
  });

  test("leaves the cloud note alone while a queued local edit will carry the rewritten image", async () => {
    let cloudReads = 0;
    await runWithDesktopSidecar({
      staged: [stagedImage],
      aliases: [{ id: "stage-1", memoId: "memo-1", resourceId: "res-1" }],
      queue: [{ id: 1, version: 1, kind: "memo.update", entityId: "memo-1", payload: { memoId: "memo-1", expectedRevision: 2, expectedContentHash: "h", title: "", tags: [], contentMarkdown: `![shot](${stagedUrl})` } }],
      status: () => ({ pending: 1, syncing: 0, conflict: 0, error: 0, cursor: 5, syncIdentity: "workspace-a" }),
      api: {
        getMemo: async () => { cloudReads += 1; throw new Error("must not read the cloud note"); },
        createMemoEditSession: async () => { throw new TypeError("offline"); },
      },
    }, async (state) => {
      expect((await syncDesktopData()).failed).toBe(1);
      expect(cloudReads).toBe(0);
      expect(state.removedStaged).toEqual([]);
    });
  });
});

describe("desktop sync issue actions", () => {
  test("retries, discards and recovers individual outbox items and announces the change", async () => {
    const item = { id: 3, version: 4, kind: "memo.update", entityId: "memo-1" };
    await runWithDesktopSidecar({}, async (state) => {
      await retryDesktopSyncIssue(item);
      await discardDesktopSyncIssue(item);
      state.calls.length = 0;
      await runRecover(state, item);
      expect(state.events.filter((event) => event === "edgeever:sync-queue-changed")).toHaveLength(3);
    });

    async function runRecover(state, outboxItem) {
      window.edgeeverDesktop.sidecarRequest = async (method, params) => {
        state.calls.push({ method, params });
        return { memo: { id: "memo-recovered" } };
      };
      expect(await recoverDesktopMemoUpdate(outboxItem, "nb-inbox")).toEqual({ id: "memo-recovered" });
      expect(state.calls).toEqual([{ method: "sync.outbox.recoverMemoUpdate", params: { id: 3, version: 4, notebookId: "nb-inbox" } }]);
    }
  });

  test("discarding all conflicts adopts the cloud copy of edited notes and drops other conflicted actions", async () => {
    const cloud = { id: "memo-1", title: "Cloud" };
    await runWithDesktopSidecar({
      queue: [
        { id: 1, version: 2, kind: "memo.update", entityId: "memo-1", status: "conflict", payload: {} },
        { id: 2, version: 1, kind: "notebook.delete", entityId: "nb-1", status: "conflict", payload: {} },
        { id: 3, version: 1, kind: "memo.delete", entityId: "memo-2", status: "pending", payload: {} },
      ],
      api: { getMemo: async () => ({ memo: cloud }) },
    }, async (state) => {
      expect(await discardDesktopConflicts()).toBe(2);
      expect(state.applied).toEqual([{ entityType: "memo", operation: "upsert", entityId: "memo-1", memo: cloud, notebook: null }]);
      expect(state.acks).toEqual([{ id: 1, version: 2, remoteMemo: cloud }]);
      expect(state.calls.filter((call) => call.method === "sync.outbox.discard").map((call) => call.params)).toEqual([{ id: 2 }]);
    });
  });

  test("keeps a conflict when the cloud copy cannot be read for a reason other than deletion", async () => {
    await runWithDesktopSidecar({
      queue: [{ id: 1, version: 2, kind: "memo.update", entityId: "memo-1", status: "conflict", payload: {} }],
      api: { getMemo: async () => { throw new ApiRequestError("Unavailable", 503); } },
    }, async (state) => {
      await expect(discardDesktopConflicts()).rejects.toThrow("Unavailable");
      expect(state.calls.map((call) => call.method)).toEqual(["sync.outbox.list"]);
    });
  });

  test("adopting one note's cloud copy only resolves that note's conflicts", async () => {
    const cloud = { id: "memo-1", title: "Cloud" };
    await runWithDesktopSidecar({
      queue: [
        { id: 1, version: 2, kind: "memo.update", entityId: "memo-1", status: "conflict", payload: {} },
        { id: 2, version: 1, kind: "memo.delete", entityId: "memo-1", status: "conflict", payload: {} },
        { id: 3, version: 1, kind: "memo.update", entityId: "memo-2", status: "conflict", payload: {} },
        { id: 4, version: 1, kind: "memo.update", entityId: "memo-1", status: "pending", payload: {} },
      ],
      api: { getMemo: async () => ({ memo: cloud }) },
    }, async (state) => {
      expect(await discardDesktopMemoConflict("memo-1")).toEqual(cloud);
      expect(state.acks).toEqual([{ id: 1, version: 2, remoteMemo: cloud }]);
      expect(state.calls.filter((call) => call.method === "sync.outbox.discard").map((call) => call.params)).toEqual([{ id: 2 }]);
      expect(state.events).toEqual(["edgeever:sync-queue-changed"]);
    });
  });
});

describe("desktop staged resource cleanup safeguards", () => {
  const stagedImage = { id: "stage-1", memoId: "memo-1", name: "shot.png", type: "image/png", size: 3 };
  const stagedUrl = "edgeever-staged://stage-1";
  const uploadedUrl = "/api/v1/resources/res-1/blob";
  const savedUpdate = { id: 1, version: 1, kind: "memo.update", entityId: "memo-1", payload: { memoId: "memo-1", expectedRevision: 2, expectedContentHash: "cloud-2", title: "", tags: [], contentMarkdown: `![shot](${stagedUrl})` } };
  const uploadApi = (overrides = {}) => ({
    uploadMemoResourceParts: async () => ({ resource: { id: "res-1", url: uploadedUrl } }),
    createMemoEditSession: async () => ({ editSession: { id: "session", baseRevision: 2, baseContentHash: "cloud-2" } }),
    updateMemo: async (memoId, input) => ({ memo: { id: memoId, contentJson: input.contentJson, contentMarkdown: input.contentMarkdown } }),
    ...quietPull,
    ...overrides,
  });

  test("keeps the staged copy when the local note cannot be read or patched", async () => {
    let cloudReads = 0;
    await runWithDesktopSidecar({
      staged: [stagedImage],
      queue: [savedUpdate],
      api: uploadApi({ getMemo: async () => { cloudReads += 1; throw new TypeError("offline"); } }),
    }, async (state) => {
      const result = await syncDesktopData();
      expect(result.failed).toBe(0);
      expect(cloudReads).toBe(1);
      expect(state.removedStaged).toEqual([]);
    });
  });

  test("keeps the staged copy while an open editor still shows its old URL", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = {
      querySelectorAll: (selector) => selector === "textarea"
        ? [{ value: "" }]
        : [{ getAttribute: (name) => (name === "src" ? stagedUrl : null) }],
    };
    try {
      await runWithDesktopSidecar({
        staged: [stagedImage],
        queue: [savedUpdate],
        localMemos: { "memo-1": { id: "memo-1", contentMarkdown: `![shot](${uploadedUrl})`, contentJson: { type: "doc", content: [] } } },
        api: uploadApi(),
      }, async (state) => {
        expect((await syncDesktopData()).failed).toBe(0);
        expect(state.aliasesRecorded).toEqual([["stage-1", uploadedUrl]]);
        expect(state.removedStaged).toEqual([]);
      });
    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    }
  });

  test("logs a failed recovery pull without masking the original failure", async () => {
    const logged = [];
    const previousConsoleError = console.error;
    console.error = (...args) => { logged.push(args[0]); };
    try {
      await runWithDesktopSidecar({
        status: settledStatus,
        bridge: { listStagedResources: async () => { throw new Error("staging directory unavailable"); } },
        api: { syncChanges: async () => { throw new TypeError("offline"); } },
      }, async () => {
        expect((await syncDesktopData()).failed).toBe(1);
        expect(logged).toEqual(["[desktop-sync] Sync failed", "[desktop-sync] Recovery pull failed"]);
        expect((await getDesktopSyncIssues()).globalIssue).toMatchObject({ phase: "sync_staged_resources", message: "staging directory unavailable" });
      });
    } finally {
      console.error = previousConsoleError;
    }
  });
});
