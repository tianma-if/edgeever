import { afterEach, expect, test } from "bun:test";
import { compressImageForUpload } from "./image-compression.ts";

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
afterEach(() => {
  if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
  else delete globalThis.Worker;
});

const source = () => new File([new Uint8Array(1024)], "截图.png", { type: "image/png", lastModified: 123 });
const mockWorker = (blob) => {
  const state = { terminated: false, message: null };
  globalThis.Worker = class {
    postMessage(message) {
      state.message = message;
      queueMicrotask(() => this.onmessage({ data: { blob } }));
    }
    terminate() { state.terminated = true; }
  };
  return state;
};

test("uses background compression and releases the worker while preserving metadata", async () => {
  const state = mockWorker(new Blob(["webp"], { type: "image/webp" }));
  const file = source();
  const result = await compressImageForUpload(file);
  expect(result.compressed).toBe(true);
  expect(result.file.name).toBe("截图.webp");
  expect(result.file.lastModified).toBe(123);
  expect(result.file.type).toBe("image/webp");
  expect(state.message).toMatchObject({ file, maxEdge: 2560, quality: 0.82 });
  expect(state.terminated).toBe(true);
});

test("keeps the original when encoding increases the file size or returns another format", async () => {
  for (const blob of [new Blob([new Uint8Array(2048)], { type: "image/webp" }), new Blob(["png"], { type: "image/png" }), null]) {
    const state = mockWorker(blob);
    const file = source();
    expect((await compressImageForUpload(file)).file).toBe(file);
    expect(state.terminated).toBe(true);
  }
});

test("does not decode unsupported images or attachments", async () => {
  globalThis.Worker = class { constructor() { throw new Error("must not start"); } };
  const file = new File(["gif"], "animation.gif", { type: "image/gif" });
  expect((await compressImageForUpload(file)).file).toBe(file);
});

test("retains the original when both worker and canvas are unavailable", async () => {
  globalThis.Worker = class { constructor() { throw new Error("unavailable"); } };
  const file = source();
  expect((await compressImageForUpload(file)).file).toBe(file);
});

test("terminates the worker when posting fails and retains a usable original", async () => {
  let terminated = false;
  globalThis.Worker = class {
    postMessage() { throw new Error("cannot clone"); }
    terminate() { terminated = true; }
  };
  const file = source();
  expect((await compressImageForUpload(file)).file).toBe(file);
  expect(terminated).toBe(true);
});
