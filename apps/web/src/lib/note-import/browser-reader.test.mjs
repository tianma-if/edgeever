import { expect, test } from "bun:test";
import { MemoryImportIndex } from "@edgeever/shared/note-import";
import { BrowserImportReader } from "./browser-reader";

test("worker failure rejects pending work and still permits task cleanup", async () => {
  const original = globalThis.Worker;
  let worker;
  class FailedWorker {
    constructor() { worker = this; }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FailedWorker;
  try {
    const index = new MemoryImportIndex();
    await index.put("chunk", "temporary", new Uint8Array(1));
    const reader = new BrowserImportReader(crypto.randomUUID(), "evernote", index, () => {});
    const scan = reader.scan([]);
    worker.onerror({ message: "Worker failed" });
    await expect(scan).rejects.toThrow("Worker failed");
    const closed = await Promise.race([reader.close().then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]);
    expect(closed).toBe(true);
    expect(worker.terminated).toBe(true);
    expect(await index.count("chunk")).toBe(0);
  } finally { globalThis.Worker = original; }
});

test("a closing Worker rejects new RPC instead of leaving it pending", async () => {
  const original = globalThis.Worker;
  let worker;
  class ClosingWorker {
    constructor() { worker = this; this.messages = []; }
    postMessage(message) { this.messages.push(message); }
    terminate() {}
  }
  globalThis.Worker = ClosingWorker;
  try {
    const reader = new BrowserImportReader(crypto.randomUUID(), "evernote", new MemoryImportIndex(), () => {});
    const closing = reader.close();
    const request = worker.messages.find(message => message.method === "close");
    const result = await Promise.race([reader.reset().then(() => "accepted", error => error.message), new Promise(resolve => setTimeout(() => resolve("pending"), 100))]);
    worker.onmessage({ data: { requestId: request.requestId } });
    await closing;
    expect(result).toBe("importClosed");
  } finally { globalThis.Worker = original; }
});
