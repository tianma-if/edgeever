// Use the real file watcher and replacement protocol. Only the clock and HTTP
// peer are simulated, so a three-minute transfer can run in the unit suite.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "node:test";
import { createAttachmentWritebackManager, replaceAttachmentResource } from "../../apps/desktop/src/main/attachment-writeback.mjs";
import { uploadAttachmentSnapshot } from "../../apps/desktop/src/main/attachment-upload.mjs";

const scenario = process.argv[2];
const root = await mkdtemp(join(tmpdir(), "edgeever-deadline-"));
const folder = join(root, "open-one");
const filename = "budget.xls";
const edited = Buffer.alloc(38 * 1024 * 1024, 7);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const originalHash = hash("original");
const editedHash = hash(edited);
let cloudHash = originalHash;
let loseResponse = scenario.endsWith("confirmation");
let stalled = scenario.startsWith("stalled-");

mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1 });
mock.method(AbortSignal, "timeout", ms => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
  return controller.signal;
});
const transfer = (signal, ms) => {
  mock.timers.tick(ms);
  signal.throwIfAborted();
};
const chunkBytes = 1024 * 1024;
const request = async (path, init, _assertCurrent, reportProgress) => {
  if (path === "/resources/writeback-capabilities") return Response.json({ preserveFilename: true });
  if (init.method === "GET") {
    let offset = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        if (offset === edited.length) return controller.close();
        transfer(init.signal, stalled ? 121_000 : 16_000);
        controller.enqueue(edited.subarray(offset, offset + chunkBytes));
        offset += chunkBytes;
      },
    }));
  }
  assert.equal(init.body.get("file").size, edited.length);
  const client = new EventEmitter();
  let uploaded = 0;
  client.getUploadProgress = () => ({ current: uploaded });
  client.abort = () => {};
  client.end = () => {
    // Only the native counter advances. Local buffering by end() is not progress.
    while (uploaded < edited.length) {
      const slow = scenario === "slow-upload" || (scenario === "variable-upload" && uploaded >= edited.length / 2);
      mock.timers.tick(slow ? 16_000 : 4_000);
      if (init.signal.aborted) return;
      uploaded += chunkBytes;
      if (stalled && scenario === "stalled-upload" && uploaded === chunkBytes) {
        mock.timers.tick(1000); // Let the native progress sample reach the watchdog.
        mock.timers.tick(120_001);
        if (init.signal.aborted) return;
      }
    }
    const matches = cloudHash === init.body.get("expectedContentHash");
    if (matches) {
      cloudHash = editedHash;
      if (loseResponse) {
        loseResponse = false;
        client.emit("error", new TypeError("Connection lost after commit"));
        return;
      }
    }
    const data = matches ? { resource: { id: "res_1", sha256: cloudHash, byteSize: edited.length } } : {};
    const incoming = Readable.from([Buffer.from(JSON.stringify(data))]);
    incoming.statusCode = matches ? 200 : 409;
    incoming.headers = {};
    client.emit("response", incoming);
  };
  return uploadAttachmentSnapshot({ request: () => client }, `http://local.test${path}`, init, reportProgress);
};
let acknowledgements = 0;
const manager = createAttachmentWritebackManager({
  getContext: () => ({ key: "account", directory: root }),
  resolveResourceId: async () => "res_1",
  replace: input => replaceAttachmentResource(request, input),
  onSaved: async ({ bytes }) => {
    assert.equal(hash(bytes), cloudHash);
    acknowledgements++;
  },
});
try {
  await mkdir(folder);
  const path = join(folder, filename);
  await writeFile(path, "original");
  await manager.track({ folder, url: "edgeever-resource://resource/res_1", filename });
  await writeFile(path, edited);
  await manager.tick();
  mock.timers.tick(2000);
  await manager.tick();
  if (scenario.endsWith("confirmation") || stalled) {
    assert.equal((await manager.list())[0].status, "error");
    assert.equal(acknowledgements, 0);
    assert.equal(cloudHash, scenario === "stalled-upload" ? originalHash : editedHash);
    if (scenario === "stalled-confirmation") {
      mock.timers.tick(31_000);
      await manager.tick();
      assert.equal((await manager.list())[0].status, "error");
      assert.equal(acknowledgements, 0);
    }
    stalled = false;
    mock.timers.tick(31_000);
    await manager.tick();
  }
  assert.equal((await manager.list())[0].status, "saved");
  assert.equal(acknowledgements, 1);
} finally {
  mock.restoreAll();
  mock.timers.reset();
  await rm(root, { recursive: true, force: true });
}
