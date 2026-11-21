import { expect, test } from "bun:test";
import { importDesktopShare } from "./desktop-share-import.ts";
import { SYNC_QUEUE_CHANGED_EVENT } from "./sync-events.ts";

const withImport = async (run) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const calls = [];
  const memo = { id: "local_share", revision: 0, contentHash: "empty", title: null, tags: [] };
  globalThis.window = {
    dispatchEvent: (event) => { calls.push(event.type); return true; },
    edgeeverDesktop: {
      isAvailable: true,
      readWeChatImportMedia: async (_id, mediaId) => {
        calls.push(["read", mediaId]);
        return { bytes: Uint8Array.of(1, 2, 3) };
      },
      finishWeChatImport: async (id, ok) => { calls.push(["ack", id, ok]); },
      beginStagedResource: async () => ({ id: "stage1", partSize: 8 }),
      appendStagedResource: async () => {},
      completeStagedResource: async () => ({ id: "stage1" }),
      sidecarRequest: async (method, params) => { calls.push([method, params]); return { ok: true }; },
    },
  };
  const options = {
    notebookId: "inbox",
    repository: {
      createMemo: async () => ({ memo }),
      uploadMemoResource: async () => { throw new Error("offline"); },
      listResources: async () => ({ resources: [] }),
      updateMemo: async (created, input) => ({ memo: { ...created, ...input } }),
    },
    imageCompressionEnabled: false,
    onPending: (payload) => calls.push(["pending", payload.importId]),
    onStart: (kind) => calls.push(["start", kind]),
    onImported: async (saved) => { calls.push(["reveal", saved]); },
    onFailure: (kind, failure) => calls.push(["failure", kind, failure]),
    onFinish: (kind) => calls.push(["finish", kind]),
  };
  try {
    await run(options, calls);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
};

test("defers a startup file and acknowledges it after the staged attachment is saved", async () => withImport(async (options, calls) => {
  const payload = { ok: true, kind: "file", importId: "share", filename: "report.pdf" };
  await importDesktopShare(payload, { ...options, notebookId: null });
  expect(calls).toEqual([["pending", "share"]]);
  await importDesktopShare(payload, options);
  expect(calls.slice(1, 4)).toEqual([["start", "file"], ["read", "file"], ["ack", "share", true]]);
  expect(calls[4][1]).toMatchObject({ editSessionId: "share:local_share", title: "report" });
  expect(calls[4][1].contentMarkdown).toContain("edgeever-staged://stage1");
  expect(calls.slice(5)).toEqual([SYNC_QUEUE_CHANGED_EVENT, ["finish", "file"]]);
}));

test("fails a chat with a missing attachment and leaves it available for retry", async () => withImport(async (options, calls) => {
  const payload = { ok: true, importId: "chat", markdown: "![photo](edgeever-wechat-media://photo)" };
  await importDesktopShare(payload, options);
  expect(calls).toEqual([
    ["start", "wechat"],
    ["memo.delete", { memoId: "local_share", permanent: true, cancelPendingCreate: true }],
    SYNC_QUEUE_CHANGED_EVENT,
    ["ack", "chat", false],
    ["failure", "wechat", { type: "save", importId: "chat" }],
    SYNC_QUEUE_CHANGED_EVENT,
    ["finish", "wechat"],
  ]);
  await importDesktopShare({ ...payload, media: [{ id: "photo", filename: "photo.png", mimeType: "image/png", byteSize: 3 }] }, options);
  expect(calls.slice(7, 10)).toEqual([["start", "wechat"], ["read", "photo"], ["ack", "chat", true]]);
  expect(calls[10][1].contentMarkdown).toContain("edgeever-staged://stage1");
  expect(calls.slice(11)).toEqual([SYNC_QUEUE_CHANGED_EVENT, ["finish", "wechat"]]);
}));
