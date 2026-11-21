import { afterEach, expect, test } from "bun:test";
import { importDesktopScreenshot } from "./desktop-screenshot-import.ts";
import { SYNC_QUEUE_CHANGED_EVENT } from "./sync-events.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
});

const setupImport = () => {
  const events = [];
  const calls = [];
  const imported = [];
  const failures = [];
  globalThis.window = {
    dispatchEvent: (event) => { events.push(event.type); return true; },
    edgeeverDesktop: {
      isAvailable: true,
      beginStagedResource: async () => { throw new Error("staging unavailable"); },
      sidecarRequest: async (method, params) => {
        calls.push({ method, params });
        return { ok: true };
      },
    },
  };
  const memo = { id: "local_memo", revision: 1, contentHash: "empty", title: "Capture", tags: [], contentMarkdown: "" };
  const repository = {
    createMemo: async ({ notebookId }) => {
      calls.push({ method: "create", notebookId });
      return { memo };
    },
    listResources: async () => ({ resources: [] }),
    uploadMemoResource: async () => ({ resource: { url: "/api/v1/resources/capture/blob", filename: "screenshot.png" } }),
    updateMemo: async (created, input) => ({ memo: { ...created, ...input, revision: 2 } }),
  };
  const payload = {
    captureId: crypto.randomUUID(),
    name: "screenshot.png",
    type: "image/png",
    title: " Capture ",
    bytes: Uint8Array.of(137, 80, 78, 71),
  };
  const options = {
    resolveNotebookId: async () => "inbox",
    repository,
    imageCompressionEnabled: false,
    onStart: () => {},
    onImported: async (saved) => { imported.push(saved); },
    onFailure: (reason) => failures.push(reason),
  };
  return { calls, events, failures, imported, options, payload };
};

test("waits for the startup notebook list, imports once and resumes sync after revealing the note", async () => {
  const { calls, events, failures, imported, options, payload } = setupImport();
  const notebook = Promise.withResolvers();
  options.resolveNotebookId = () => notebook.promise;
  const onImported = options.onImported;
  const eventsAtReveal = [];
  options.onImported = async (memo) => {
    eventsAtReveal.push(...events);
    await onImported(memo);
  };

  const opening = importDesktopScreenshot(payload, options);
  await importDesktopScreenshot(payload, options);
  expect(calls).toEqual([]);
  notebook.resolve("inbox");
  await opening;
  await importDesktopScreenshot(payload, options);

  expect(calls).toEqual([{ method: "create", notebookId: "inbox" }]);
  expect(failures).toEqual([]);
  expect(imported).toHaveLength(1);
  expect(imported[0].contentMarkdown).toContain("edgeever-resource://resource/capture");
  expect(eventsAtReveal).toEqual([]);
  expect(events).toEqual([SYNC_QUEUE_CHANGED_EVENT]);
});

test("cancels the pending create, resumes sync and allows the same capture to retry", async () => {
  const { calls, events, failures, imported, options, payload } = setupImport();
  const upload = options.repository.uploadMemoResource;
  options.repository.uploadMemoResource = async () => { throw new Error("upload unavailable"); };

  await importDesktopScreenshot(payload, options);

  expect(calls).toEqual([
    { method: "create", notebookId: "inbox" },
    { method: "memo.delete", params: { memoId: "local_memo", permanent: true, cancelPendingCreate: true } },
  ]);
  expect(failures).toEqual(["save-failed"]);
  expect(imported).toEqual([]);
  expect(events).toEqual([SYNC_QUEUE_CHANGED_EVENT, SYNC_QUEUE_CHANGED_EVENT]);

  options.repository.uploadMemoResource = upload;
  await importDesktopScreenshot(payload, options);
  expect(imported).toHaveLength(1);
  expect(events).toHaveLength(3);
});
