import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MemoDetail, MemoEditSession } from "@edgeever/shared";
import type { MemoUpdateSyncPayload } from "../apps/web/src/lib/local-db";

const { localDb } = await import("../apps/web/src/lib/local-db");
const {
  discardWebMemoConflict,
  getMemoCreateQueueId,
  getMemoUpdateQueueId,
  isMemoUpdateAlreadyApplied,
  queueMemoCreate,
  queueMemoUpdate,
  syncQueuedChanges,
} = await import("../apps/web/src/lib/sync-queue");
const { formatLocalDraftClipboardText } = await import("../apps/web/src/lib/memo-save-conflict");
const originalFetch = globalThis.fetch;

const payload = (title: string, revision = 0): MemoUpdateSyncPayload => ({
  memoId: "memo_sync_test",
  expectedRevision: revision,
  expectedContentHash: `hash-${revision}`,
  editSessionId: "original-session",
  title,
  contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: title }] }] },
  tags: [],
});

const memo = (title: string, revision = 1): MemoDetail => ({
  id: "memo_sync_test",
  notebookId: "nb_inbox",
  title,
  excerpt: title,
  tags: [],
  isPinned: false,
  isArchived: false,
  isDeleted: false,
  revision,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:01.000Z",
  deletedAt: null,
  contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: title }] }] },
  contentMarkdown: title,
  contentText: title,
  contentHash: `hash-${revision}`,
  sourceMemoIds: [],
  mergeSourceCount: 0,
  mergedIntoMemoId: null,
});

const session = (revision = 0): MemoEditSession => ({
  id: `edit-${revision}`,
  memoId: "memo_sync_test",
  baseRevision: revision,
  baseContentHash: `hash-${revision}`,
  expiresAt: "2026-08-15T00:00:00.000Z",
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(async () => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  await localDb.transaction("rw", localDb.drafts, localDb.syncQueue, localDb.memos, async () => {
    await localDb.drafts.clear();
    await localDb.syncQueue.clear();
    await localDb.memos.clear();
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("web sync queue concurrency", () => {
  test("recognizes a legacy queued snapshot that is already fully stored on the server", async () => {
    await queueMemoUpdate(payload("already saved"));
    const queued = await localDb.syncQueue.get(getMemoUpdateQueueId("memo_sync_test"));

    expect(queued).toBeDefined();
    expect(isMemoUpdateAlreadyApplied(memo("already saved"), queued!)).toBe(true);
    expect(isMemoUpdateAlreadyApplied(memo("already saved", 0), queued!)).toBe(false);
    expect(isMemoUpdateAlreadyApplied(memo("different remote text"), queued!)).toBe(false);
  });

  test("coalesces simultaneous sync runs so one queued save is sent only once", async () => {
    await queueMemoUpdate(payload("latest text"));
    let requestCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestCount += 1;
      const url = String(input);
      if (url.endsWith("/edit-sessions")) {
        return jsonResponse({ editSession: session() });
      }
      return jsonResponse({ memo: memo("latest text") });
    }) as typeof fetch;

    const [first, second] = await Promise.all([syncQueuedChanges(), syncQueuedChanges()]);

    expect(requestCount).toBe(2);
    expect(first).toEqual({ attempted: 1, synced: 1, failed: 0, conflicted: 0 });
    expect(second).toEqual(first);
    expect(await localDb.syncQueue.count()).toBe(0);
  });

  test("does not delete a newer draft queued while an older request is in flight", async () => {
    await queueMemoUpdate(payload("older text"));
    let releaseUpdate!: () => void;
    let updateStarted!: () => void;
    const updateStartedPromise = new Promise<void>((resolve) => {
      updateStarted = resolve;
    });
    const releaseUpdatePromise = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/edit-sessions")) {
        return jsonResponse({ editSession: session() });
      }
      updateStarted();
      await releaseUpdatePromise;
      return jsonResponse({ memo: memo("older text") });
    }) as typeof fetch;

    const runningSync = syncQueuedChanges();
    await updateStartedPromise;
    await queueMemoUpdate(payload("newer text"));
    releaseUpdate();
    const result = await runningSync;

    const queued = await localDb.syncQueue.get(getMemoUpdateQueueId("memo_sync_test"));
    expect(result).toEqual({ attempted: 1, synced: 1, failed: 0, conflicted: 0 });
    expect(queued?.status).toBe("pending");
    expect(queued?.payload.title).toBe("newer text");
    expect(queued?.payload.expectedRevision).toBe(1);
    expect(queued?.payload.expectedContentHash).toBe("hash-1");
  });

  test("queues a draft saved while memo creation is in flight after remapping its id", async () => {
    const scope = "test-scope";
    const temporaryId = "local_create_race";
    const remoteMemo = { ...memo("", 1), id: "memo_created", title: null };
    const draftTitle = "written during create";
    const draftContent = payload(draftTitle).contentJson;
    await queueMemoCreate(scope, {
      temporaryId,
      notebookId: "nb_inbox",
      title: "",
      contentMarkdown: "",
      tags: [],
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    });
    await localDb.drafts.put({
      memoId: temporaryId,
      title: draftTitle,
      contentJson: draftContent,
      tagsText: "",
      updatedAt: "2026-07-15T00:00:02.000Z",
    });

    const requests: Array<{ method: string; url: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ method, url });
      if (method === "POST" && url.endsWith("/api/v1/memos")) {
        return jsonResponse({ memo: remoteMemo }, 201);
      }
      if (url.endsWith("/edit-sessions")) {
        return jsonResponse({ editSession: { ...session(1), memoId: remoteMemo.id } });
      }
      return jsonResponse({ memo: { ...remoteMemo, title: draftTitle, contentJson: draftContent, revision: 2, contentHash: "hash-2" } });
    }) as typeof fetch;

    const createResult = await syncQueuedChanges({ scope });
    const queuedUpdate = await localDb.syncQueue.get(getMemoUpdateQueueId(remoteMemo.id));

    expect(createResult).toEqual({ attempted: 1, synced: 1, failed: 0, conflicted: 0 });
    expect(await localDb.syncQueue.get(getMemoCreateQueueId(temporaryId))).toBeUndefined();
    expect(await localDb.drafts.get(temporaryId)).toBeUndefined();
    expect(await localDb.drafts.get(remoteMemo.id)).toMatchObject({ title: draftTitle, contentJson: draftContent });
    expect(queuedUpdate).toMatchObject({
      kind: "memo.update",
      scope,
      memoId: remoteMemo.id,
      status: "pending",
      payload: {
        expectedRevision: 1,
        expectedContentHash: "hash-1",
        title: draftTitle,
        contentJson: draftContent,
      },
    });

    const updateResult = await syncQueuedChanges({ scope });
    expect(updateResult).toEqual({ attempted: 1, synced: 1, failed: 0, conflicted: 0 });
    expect(requests.some(({ method, url }) => method === "PATCH" && url.endsWith(`/api/v1/memos/${remoteMemo.id}`))).toBe(true);
    expect(await localDb.syncQueue.get(getMemoUpdateQueueId(remoteMemo.id))).toBeUndefined();
  });

  test("keeps a genuine server revision mismatch as a conflict", async () => {
    await queueMemoUpdate(payload("offline edit"));
    globalThis.fetch = (async () => jsonResponse({ editSession: session(1) })) as typeof fetch;

    const result = await syncQueuedChanges();
    const queued = await localDb.syncQueue.get(getMemoUpdateQueueId("memo_sync_test"));

    expect(result).toEqual({ attempted: 1, synced: 0, failed: 0, conflicted: 1 });
    expect(queued?.status).toBe("conflict");
    expect(queued?.payload.title).toBe("offline edit");
  });

  test("discardWebMemoConflict replaces local draft with the cloud memo", async () => {
    const scope = "test-scope";
    await queueMemoUpdate(payload("local conflicted edit"), scope);
    await localDb.syncQueue.update(getMemoUpdateQueueId("memo_sync_test"), { status: "conflict" });
    await localDb.drafts.put({
      memoId: "memo_sync_test",
      title: "local conflicted edit",
      tagsText: "",
      contentJson: payload("local conflicted edit").contentJson,
      updatedAt: "2026-07-15T00:00:02.000Z",
    });

    const cloud = memo("cloud wins", 3);
    globalThis.fetch = (async () => jsonResponse({ memo: cloud })) as typeof fetch;

    const adopted = await discardWebMemoConflict(scope, "memo_sync_test");

    expect(adopted).toEqual(cloud);
    expect(await localDb.syncQueue.get(getMemoUpdateQueueId("memo_sync_test"))).toBeUndefined();
    expect(await localDb.drafts.get("memo_sync_test")).toBeUndefined();
    expect(await localDb.memos.get([scope, "memo_sync_test"])).toMatchObject({
      title: "cloud wins",
      revision: 3,
      scope,
    });
  });
});

describe("local draft clipboard formatting", () => {
  test("includes title, tags, and body", () => {
    expect(
      formatLocalDraftClipboardText({
        title: "Welcome",
        tags: ["overview", "demo"],
        contentMarkdown: "Hello world\n",
      }),
    ).toBe("# Welcome\n#overview #demo\n\nHello world");
  });
});
