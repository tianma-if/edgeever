import { expect, test } from "bun:test";
import { NoteImportController } from "./controller";

test("viewing a finished result preserves task mappings until explicit dismissal", async () => {
  await import("fake-indexeddb/auto");
  const { BrowserImportIndex } = await import("./browser-index");
  const { BrowserImportReader } = await import("./browser-reader");
  const previousWorker = globalThis.Worker;
  class IdleWorker {
    postMessage(message) {
      if (message.method !== "abort") queueMicrotask(() => this.onmessage({ data: { requestId: message.requestId } }));
    }
    terminate() {}
  }
  globalThis.Worker = IdleWorker;
  const id = crypto.randomUUID(), index = new BrowserImportIndex(id);
  const reader = new BrowserImportReader(id, "obsidian", index, () => {});
  const result = { key: "note-0", path: "note.md", memo: { id: "memo-id", notebookId: "folder-id" }, urls: {}, complete: false, error: "incomplete" };
  const controller = new NoteImportController(null, "http://import.test", () => "Owner", async () => {});
  try {
    await index.put("result", result.key, result);
    await index.put("folderResult", "folder:Folder", { id: "folder-id" });
    controller.reader = reader;
    controller.update({ phase: "finished", open: true, summary: { id, notes: 1, errors: 0 }, results: [result], resultCount: 1 });
    controller.hide();
    expect(controller.getSnapshot()).toMatchObject({ phase: "finished", open: false, results: [result], resultCount: 1 });
    controller.open();
    expect(controller.getSnapshot()).toMatchObject({ phase: "finished", open: true });
    expect(controller.reader).toBe(reader);
    expect(await index.get("result", result.key)).toEqual(result);
    expect(await index.get("folderResult", "folder:Folder")).toEqual({ id: "folder-id" });
    controller.dismiss();
    await reader.close();
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", results: [] });
    expect(await index.count("result")).toBe(0);
  } finally {
    controller.dispose();
    await reader.close();
    globalThis.Worker = previousWorker;
  }
});

for (const [kind, field] of [["notebook", "folders"], ["issue", "issues"], ["result", "results"]]) {
  test(`concurrent ${kind} pages are appended only once`, async () => {
    const controller = new NoteImportController(null, "http://import.test", () => "Owner", async () => {});
    const resolves = [];
    controller.reader = { index: { page: () => new Promise(done => resolves.push(done)) }, abort() {}, async close() {} };
    const first = controller.more(kind), second = controller.more(kind);
    resolves[1]([{ key: "page-item" }]); await second;
    resolves[0]([{ key: "page-item" }]); await first;
    expect(controller.getSnapshot()[field]).toEqual([{ key: "page-item" }]);
    controller.dispose();
  });

  test(`late ${kind} pages cannot repopulate a dismissed task`, async () => {
    const controller = new NoteImportController(null, "http://import.test", () => "Owner", async () => {});
    let resolve;
    const page = new Promise(done => { resolve = done; });
    controller.reader = { index: { page: () => page }, abort() {}, async close() {} };
    controller.update({ open: true, phase: "ready" });
    const pending = controller.more(kind);
    controller.dismiss();
    resolve([{ key: "old-task" }]);
    await pending;
    expect(controller.getSnapshot()[field]).toEqual([]);
    expect(controller.getSnapshot().phase).toBe("idle");
    controller.dispose();
  });
}

test("a dismissed scan cannot publish its delayed preflight pages", async () => {
  await import("fake-indexeddb/auto");
  const { BrowserImportIndex } = await import("./browser-index");
  const previousWorker = globalThis.Worker, previousPage = BrowserImportIndex.prototype.page;
  let started, resolve;
  const reading = new Promise(done => { started = done; });
  const page = new Promise(done => { resolve = done; });
  class ScanWorker {
    postMessage(message) {
      if (message.method === "abort") return;
      queueMicrotask(() => this.onmessage({ data: { requestId: message.requestId, result: message.method === "scan" ? { notes: 1, notebooks: 1, resources: 0, errors: 0, warnings: 0 } : undefined } }));
    }
    terminate() {}
  }
  globalThis.Worker = ScanWorker;
  BrowserImportIndex.prototype.page = function (kind) { if (kind === "notebook") { started(); return page; } return Promise.resolve([]); };
  const controller = new NoteImportController(null, "http://import.test", () => "Owner", async () => {});
  try {
    controller.select([{ path: "note.md", file: new File(["body"], "note.md") }]);
    await reading;
    const reader = controller.reader;
    controller.dismiss();
    resolve([{ key: "old-folder", name: "Old", parentKey: null }]);
    await controller.work;
    await reader.close();
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", open: false, folders: [], issues: [] });
  } finally {
    controller.dispose();
    BrowserImportIndex.prototype.page = previousPage;
    globalThis.Worker = previousWorker;
  }
});

for (const stage of ["initialization", "preview"]) test(`scan cancellation during ${stage} cannot publish late results`, async () => {
  await import("fake-indexeddb/auto");
  const { BrowserImportIndex } = await import("./browser-index");
  const previousWorker = globalThis.Worker, previousPage = BrowserImportIndex.prototype.page;
  const calls = [], terminated = [];
  let started, resolve, first = true;
  const reading = new Promise(done => { started = done; });
  const page = new Promise(done => { resolve = done; });
  class ScanWorker {
    number = calls.length;
    postMessage(message) {
      calls.push(message.method);
      if (message.method === "abort") return;
      queueMicrotask(() => this.onmessage({ data: { requestId: message.requestId, result: message.method === "scan" ? { notes: 1, notebooks: 1, resources: 0, errors: 0, warnings: 0 } : undefined } }));
    }
    terminate() { terminated.push(this.number); }
  }
  globalThis.Worker = ScanWorker;
  BrowserImportIndex.prototype.page = function (kind) {
    if (kind !== "notebook") return Promise.resolve([]);
    if (stage === "preview" && first) { first = false; started(); return page; }
    return Promise.resolve([{ key: "new-folder", name: "New", parentKey: null }]);
  };
  const controller = new NoteImportController(null, "http://import.test", () => "Owner", async () => {});
  const files = [{ path: "note.md", file: new File(["body"], "note.md") }];
  try {
    controller.update({ open: true });
    controller.select(files);
    if (stage === "preview") await reading;
    const oldReader = controller.reader;
    controller.cancel();
    const cleanup = controller.work;
    expect(controller.getSnapshot()).toMatchObject({ phase: "idle", open: true });
    if (stage === "initialization") {
      await cleanup;
      expect(calls).not.toContain("scan");
    } else {
      controller.select(files);
      resolve([{ key: "old-folder", name: "Old", parentKey: null }]);
      await Promise.all([cleanup, controller.work]);
      expect(controller.getSnapshot()).toMatchObject({ phase: "ready", folders: [{ key: "new-folder" }] });
      expect(controller.reader).not.toBe(oldReader);
      expect(terminated).toHaveLength(1);
    }
  } finally {
    resolve([]);
    controller.dispose();
    await controller.work;
    await controller.reader?.close();
    globalThis.Worker = previousWorker;
    BrowserImportIndex.prototype.page = previousPage;
  }
});
