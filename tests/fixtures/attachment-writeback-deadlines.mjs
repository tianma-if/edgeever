// Use the real file watcher and replacement protocol. Only the clock and HTTP
// peer are simulated, so a three-minute transfer can run in the unit suite.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "node:test";
import { createAttachmentWritebackManager, replaceAttachmentResource } from "../../apps/desktop/src/main/attachment-writeback.mjs";

const scenario = process.argv[2];
const root = await mkdtemp(join(tmpdir(), "edgeever-deadline-"));
const folder = join(root, "open-one");
const filename = "budget.xls";
const edited = Buffer.alloc(38 * 1024 * 1024, 7);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const originalHash = hash("original");
const editedHash = hash(edited);
let cloudHash = originalHash;
let loseResponse = scenario === "slow-confirmation";
let stalled = scenario === "stalled-upload";

mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1 });
mock.method(AbortSignal, "timeout", ms => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
  return controller.signal;
});
const transfer = (signal, ms) => {
  mock.timers.tick(ms);
  signal.throwIfAborted();
};
const request = async (path, init) => {
  if (path === "/resources/writeback-capabilities") return Response.json({ preserveFilename: true });
  if (init.method === "GET") {
    transfer(init.signal, 184_000);
    return new Response(edited);
  }
  assert.equal(init.body.get("file").size, edited.length);
  const uploadMs = scenario === "slow-upload" ? 184_000 : 110_000;
  transfer(init.signal, stalled ? 60 * 60_000 : uploadMs);
  if (cloudHash !== init.body.get("expectedContentHash")) return new Response(null, { status: 409 });
  cloudHash = editedHash;
  if (loseResponse) {
    loseResponse = false;
    throw new TypeError("Connection lost after commit");
  }
  return Response.json({ resource: { id: "res_1", sha256: cloudHash, byteSize: edited.length } });
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
  if (scenario !== "slow-upload") {
    assert.equal((await manager.list())[0].status, "error");
    assert.equal(acknowledgements, 0);
    assert.equal(cloudHash, stalled ? originalHash : editedHash);
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
