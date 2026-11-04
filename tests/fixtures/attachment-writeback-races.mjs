import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scenario = process.argv[2];
const realLstat = fs.lstat;
const realRename = fs.rename;
const realRm = fs.rm;
let beforeLstat, renameFile, removeFile;
fs.lstat = async (...args) => { await beforeLstat?.(...args); return realLstat(...args); };
fs.rename = (...args) => renameFile ? renameFile(...args) : realRename(...args);
fs.rm = (...args) => removeFile ? removeFile(...args) : realRm(...args);
syncBuiltinESMExports();
const { createAttachmentWritebackManager } = await import("../../apps/desktop/src/main/attachment-writeback.mjs");
const root = await fs.mkdtemp(join(tmpdir(), "edgeever-writeback-races-"));
const folder = join(root, "open-one");
const path = join(folder, "a.xlsx");
const metadata = join(folder, ".edgeever-writeback.json");
const hash = value => createHash("sha256").update(value).digest("hex");
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
let now = 0, attempts = 0, offline = false, scope = "account-a", cloud = "original";
const options = {
  getContext: () => ({ key: scope, directory: root }), now: () => now,
  resolveResourceId: async () => "res_1", onSaved: async () => {},
  replace: async input => {
    attempts++;
    if (scenario === "abort" && attempts === 1) throw new DOMException("Request timed out", "AbortError");
    if (offline) throw Object.assign(new Error("Offline"), { code: "unavailable", retryable: true });
    // The real helper reconciles a lost local acknowledgement via GET + a
    // conditional no-op PUT; the real-API integration covers that transport.
    if (scenario !== "acknowledgement-commit-failure" || Buffer.from(input.bytes).toString() !== cloud) {
      assert.equal(input.expectedContentHash, hash(cloud));
    }
    cloud = Buffer.from(input.bytes).toString();
    return { id: "res_1", byteSize: input.bytes.length, sha256: hash(cloud) };
  },
};
let manager = createAttachmentWritebackManager(options);
try {
  await fs.mkdir(folder); await fs.writeFile(path, cloud);
  await manager.track({ folder, url: "edgeever-resource://resource/res_1", filename: "a.xlsx", mimeType: "application/test" });
  await fs.writeFile(path, "edit"); await manager.tick(); now += 2000;
  if (scenario === "abort" || scenario === "replace-during-snapshot") {
    let reads = 0;
    if (scenario === "replace-during-snapshot") beforeLstat = async value => {
      if (value === path && ++reads === 2) await fs.rename(path, join(folder, "office-intermediate"));
    };
    await manager.tick(); beforeLstat = null;
    if (scenario === "replace-during-snapshot") await fs.rename(join(folder, "office-intermediate"), path);
    now += 60_000; await manager.tick(); now += 2000; await manager.tick();
    assert.equal(cloud, "edit", "saving must resume after a transient request/file failure");
    assert.equal((await manager.list())[0].status, "saved");
  } else if (scenario === "retry-persistence") {
    offline = true; await manager.tick(); offline = false;
    const held = deferred(), release = deferred(); let first = true;
    renameFile = async (from, to) => {
      if (to === metadata && first) { first = false; held.resolve(); await release.promise; }
      else if (to === metadata) {
        // The old implementation commits the newer acknowledgement before the
        // delayed retry. Ordered persistence cannot enter this branch yet.
        const result = await realRename(from, to); release.resolve(); return result;
      }
      return realRename(from, to);
    };
    const retrying = manager.retry("open-one"); await held.promise;
    const timer = setTimeout(release.resolve, 100);
    try { await Promise.all([retrying, manager.tick()]); } finally { clearTimeout(timer); release.resolve(); }
    renameFile = null;
    const record = JSON.parse(await fs.readFile(metadata, "utf8"));
    assert.equal(record.status, "saved", "an older retry must not replace the success acknowledgement");
    assert.equal(record.pendingHash, null);
    manager.suspend(); manager = createAttachmentWritebackManager(options); now += 60_000;
    await manager.tick(); assert.equal((await manager.list())[0].status, "saved");
  } else if (scenario === "scope-during-acknowledgement") {
    const held = deferred(), release = deferred(); let first = true;
    renameFile = async (from, to) => {
      if (to === metadata && first && JSON.parse(await fs.readFile(from, "utf8")).status === "saved") {
        first = false; held.resolve(); await release.promise;
      }
      return realRename(from, to);
    };
    const saving = manager.tick(); await held.promise;
    // A credential refresh changes context but restores the same account dir.
    scope = "account-a-new-session";
    const listing = manager.list();
    const timer = setTimeout(release.resolve, 100);
    void listing.then(release.resolve);
    try { await Promise.all([saving, listing]); } finally { clearTimeout(timer); release.resolve(); }
    renameFile = null; now += 60_000; await manager.tick();
    assert.equal((await manager.list())[0].status, "saved", "context restore must read the completed acknowledgement");
    assert.equal(cloud, "edit");
  } else if (scenario === "acknowledgement-commit-failure") {
    let first = true;
    renameFile = async (from, to) => {
      if (to === metadata && first && JSON.parse(await fs.readFile(from, "utf8")).status === "saved") {
        first = false; throw Object.assign(new Error("Acknowledgement still locked"), { code: "EBUSY" });
      }
      return realRename(from, to);
    };
    await manager.tick();
    assert.equal(cloud, "edit");
    const interrupted = JSON.parse(await fs.readFile(metadata, "utf8"));
    assert.equal(interrupted.baseHash, hash("original"));
    assert.equal(interrupted.pendingHash, hash("edit"), "retain the pending snapshot until its acknowledgement is durable");
    now += 60_000; await manager.tick();
    assert.equal(attempts, 2); assert.equal((await manager.list())[0].status, "saved");
  } else if (scenario === "pending-lock") {
    let first = true;
    beforeLstat = value => {
      if (value === join(folder, ".edgeever-writeback.pending") && first) {
        first = false; throw Object.assign(new Error("Pending snapshot still locked"), { code: "EBUSY" });
      }
    };
    await manager.tick(); now += 60_000; await manager.tick();
    assert.equal(cloud, "edit"); assert.equal((await manager.list())[0].status, "saved");
  } else if (scenario === "cleanup-after-acknowledgement") {
    removeFile = (value, ...args) => {
      if (value === join(folder, ".edgeever-writeback.pending")) throw Object.assign(new Error("Snapshot still locked"), { code: "EBUSY" });
      return realRm(value, ...args);
    };
    await manager.tick();
    assert.equal(cloud, "edit");
    assert.equal((await manager.list())[0].status, "saved", "cleanup must not roll back a durable success acknowledgement");
  } else throw new Error(`Unknown scenario: ${scenario}`);
} finally { await fs.rm(root, { recursive: true, force: true }); }
